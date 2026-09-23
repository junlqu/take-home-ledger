import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let db;
let base;

// Setup and teardown for the test server and in-memory database
beforeEach(async () => {
  db = openDb(':memory:');
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});

// Ensure database closes after each test
afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

// Helper function to send POST requests to the test server
async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Helper function to send GET requests to the test server
async function get(path) {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
}

/*
 * Helper to generate future timestamps for spend transactions.
 * Spend timestamps must fall after the top-up, which is stamped with server time.
 * at(14, 15) is "2:15pm" on a day in the future relative to now.
 */
const day = Date.now() + 24 * 60 * 60 * 1000;
const at = (h, m) => new Date(day + (h * 60 + m) * 60 * 1000).toISOString();

/*
 * Transaction counter and helper functions for top-up and spend operations.
 */
let txnCounter = 0;
const topUp = (wristband_id, amount) =>
  post('/topup', { wristband_id, amount, terminal_id: 'topup-1', terminal_txn_id: `t${++txnCounter}` });

const spend = (terminal_id, terminal_txn_id, wristband_id, amount, recorded_at) =>
  ({ wristband_id, amount, terminal_id, terminal_txn_id, recorded_at });

/*
 * Test 1: Top-up then check balance
 * Objective: Ensure that a top-up correctly updates the balance
 * and is reflected in the transaction history.
 */
test('top-up then balance', async () => {
  const r = await topUp('wb-1', 5000);
  assert.equal(r.status, 201);
  assert.equal(r.body.balance, 5000);

  const b = await get('/balance/wb-1');
  assert.equal(b.body.balance, 5000);
  assert.equal(b.body.history.length, 1);
});

/*
 * Test 2: Unknown wristband balance
 * Objective: Ensure that requesting the balance of an unknown wristband returns a 404 error.
 */
test('unknown wristband balance is a 404', async () => {
  assert.equal((await get('/balance/missing')).status, 404);
});

/*
 * Test 3: Duplicate top-up retry
 * Objective: Ensure that retrying a top-up with the same terminal_txn_id
 * is applied only once and subsequent retries are marked as duplicates.
 */
test('duplicate top-up retry is applied once', async () => {
  const body = { wristband_id: 'wb-1', amount: 1000, terminal_id: 'topup-1', terminal_txn_id: 'retry-me' };
  assert.equal((await post('/topup', body)).status, 201);
  const retry = await post('/topup', body);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'duplicate');
  assert.equal((await get('/balance/wb-1')).body.balance, 1000);
});

/*
 * Test 4: Duplicate sync
 * Objective: Ensure that re-uploading the same batch of
 * transactions does not alter the balance or history.
 */
test('duplicate sync: re-uploading the same batch changes nothing', async () => {
  await topUp('wb-1', 5000);
  const batch = {
    transactions: [
      spend('pos-A', '1', 'wb-1', 1200, at(14, 0)),
      spend('pos-A', '2', 'wb-1', 800, at(14, 5)),
    ],
  };

  const first = await post('/sync', batch);
  assert.deepEqual(first.body.results.map((r) => r.status), ['accepted', 'accepted']);

  const second = await post('/sync', batch);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.results.map((r) => r.status), ['duplicate', 'duplicate']);

  const b = await get('/balance/wb-1');
  assert.equal(b.body.balance, 3000);
  assert.equal(b.body.history.length, 3);
});

/*
 * Test 5: Reused terminal_txn_id with a different payload
 * Objective: Ensure that reusing a terminal_txn_id with a different payload is rejected.
 */
test('reused terminal_txn_id with a different payload is rejected', async () => {
  await topUp('wb-1', 5000);
  await post('/sync', { transactions: [spend('pos-A', '1', 'wb-1', 100, at(14, 0))] });
  const r = await post('/sync', { transactions: [spend('pos-A', '1', 'wb-1', 999, at(14, 0))] });
  assert.equal(r.body.results[0].status, 'rejected');
  assert.equal((await get('/balance/wb-1')).body.balance, 4900);
});

/*
 * Test 6: Overspend detection with offline terminals
 * Objective: Ensure that when two offline terminals both accept transactions that together exceed the balance,
 * both transactions are recorded and the wristband is flagged for overspending.
 */
test('overspend: two offline terminals both accept, both are recorded and the wristband is flagged', async () => {
  await topUp('wb-1', 1000);

  const b = await post('/sync', { transactions: [spend('pos-B', '1', 'wb-1', 600, at(14, 40))] });
  assert.equal(b.body.results[0].status, 'accepted');
  assert.deepEqual(b.body.flagged_wristbands, []);
  
  const a = await post('/sync', { transactions: [spend('pos-A', '1', 'wb-1', 700, at(14, 15))] });
  assert.equal(a.body.results[0].status, 'accepted');
  assert.deepEqual(a.body.flagged_wristbands, [{ wristband_id: 'wb-1', balance: -300 }]);

  const bal = await get('/balance/wb-1');
  assert.equal(bal.body.balance, -300);
  assert.equal(bal.body.flagged, true);
  // The later-recorded spend is the one that overdrew.
  const overdrawn = bal.body.history.filter((h) => h.overdrawn).map((h) => h.terminal_id);
  assert.deepEqual(overdrawn, ['pos-B']);
});

/*
 * Test 7: Out-of-order arrival of offline transactions
 * Objective: Ensure that the final state is consistent regardless of the order in which offline transactions arrive.
 */
test('out-of-order arrival yields the same final state as in-order arrival', async () => {
  const early = spend('pos-A', '1', 'wb-1', 700, at(14, 15));
  const late = spend('pos-B', '1', 'wb-1', 600, at(14, 40));

  await topUp('wb-1', 1000);
  // The 2:40pm batch arrives first.
  await post('/sync', { transactions: [late] });
  await post('/sync', { transactions: [early] });

  const bal = (await get('/balance/wb-1')).body;
  assert.equal(bal.balance, -300);
  assert.deepEqual(bal.history.map((h) => h.terminal_id), ['topup-1', 'pos-A', 'pos-B']);
  // Still pos-B that overdrew, even though it arrived first.
  assert.deepEqual(bal.history.filter((h) => h.overdrawn).map((h) => h.terminal_id), ['pos-B']);
});

/*
 * Test 8: Malformed entries handling
 * Objective: Ensure that malformed entries are rejected individually while the rest of the batch is applied.
 */
test('malformed entries are rejected individually; the rest of the batch is applied', async () => {
  await topUp('wb-1', 5000);
  const r = await post('/sync', {
    transactions: [
      spend('pos-A', '1', 'wb-1', 500, at(14, 0)),
      spend('pos-A', '2', 'wb-1', -50, at(14, 1)),       // negative amount
      spend('pos-A', '3', 'wb-nope', 100, at(14, 2)),    // unknown wristband
      { wristband_id: 'wb-1', amount: 100, terminal_id: 'pos-A' },    // missing fields
      spend('pos-A', '5', 'wb-1', 250, 'not-a-date'),                 // bad timestamp
      spend('pos-A', '6', 'wb-1', 300, at(14, 5)),
    ],
  });

  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map((x) => x.status),
    ['accepted', 'rejected', 'rejected', 'rejected', 'rejected', 'accepted']);
  // Every rejection says which entry and why, so the terminal can fix or escalate it.
  for (const x of r.body.results.filter((x) => x.status === 'rejected')) {
    assert.equal(typeof x.index, 'number');
    assert.ok(x.reason);
  }
  assert.equal((await get('/balance/wb-1')).body.balance, 4200);
});

/*
 * Test 9: Non-array sync body
 * Objective: Ensure that a non-array sync body results in a 400 error.
 */
test('non-array sync body is a 400', async () => {
  const r = await post('/sync', { transactions: 'nope' });
  assert.equal(r.status, 400);
});

/*
 * Test 10: Ledger immutability
 * Objective: Ensure that ledger rows cannot be updated or deleted, enforcing append-only behavior.
 */
test('ledger rows cannot be updated or deleted', () => {
  db.prepare("INSERT INTO wristbands (id, created_at) VALUES ('wb-x', '2026-01-01')").run();
  db.prepare(`INSERT INTO ledger_entries
    (wristband_id, type, amount, terminal_id, terminal_txn_id, recorded_at, received_at)
    VALUES ('wb-x', 'topup', 100, 't', '1', '2026-01-01', '2026-01-01')`).run();
  assert.throws(() => db.exec('UPDATE ledger_entries SET amount = 1'), /append-only/);
  assert.throws(() => db.exec('DELETE FROM ledger_entries'), /append-only/);
});
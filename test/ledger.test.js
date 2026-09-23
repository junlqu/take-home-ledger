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
 * Transaction counter and helper functions for top-up and spend operations.
 */
let txnCounter = 0;
const topUp = (wristband_id, amount) =>
  post('/topup', { wristband_id, amount, terminal_id: 'topup-1', terminal_txn_id: `t${++txnCounter}` });

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

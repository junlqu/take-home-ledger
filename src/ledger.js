import { transaction } from './db.js';

/* 
 * Transaction outcomes of a terminal sync.
 * The terminal should treat both `accepted` and `duplicate`
 * as "stored, safe to drop locally".
 */
export const Status = {
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  DUPLICATE: 'duplicate',
};

// Checks a string is not empty
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

// Checks a value is a positive integer (>0)
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

/*
 * Checks if the transaction entry is well-formed.
 * Returns an error string, or null if the entry is well-formed.
 * Checks shape only; whether the wristband exists is checked against the DB.
 */
function validateEntry(e, { requireRecordedAt }) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return 'entry must be an object';
  for (const field of ['wristband_id', 'terminal_id', 'terminal_txn_id']) {
    if (!isNonEmptyString(e[field])) return `${field} is required and must be a non-empty string`;
  }
  if (!isPositiveInt(e.amount)) return 'amount must be a positive integer (minor units, e.g. cents)';
  if (requireRecordedAt || e.recorded_at !== undefined) {
    if (!isNonEmptyString(e.recorded_at) || Number.isNaN(Date.parse(e.recorded_at))) {
      return 'recorded_at must be an ISO 8601 timestamp';
    }
  }
  return null;
}

// Prepares SQL statements for the ledger operations
function statements(db) {
  return {
    // Finds a ledger entry by its terminal id and terminal transaction id
    findByKey: db.prepare(
      'SELECT * FROM ledger_entries WHERE terminal_id = ? AND terminal_txn_id = ?'
    ),
    // Finds a wristband by its id
    findWristband: db.prepare('SELECT id FROM wristbands WHERE id = ?'),
    // Inserts a wristband if it does not already exist
    insertWristband: db.prepare(
      'INSERT OR IGNORE INTO wristbands (id, created_at) VALUES (?, ?)'
    ),
    // Inserts a new ledger entry
    insertEntry: db.prepare(`
      INSERT INTO ledger_entries
        (wristband_id, type, amount, terminal_id, terminal_txn_id, recorded_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    // Retrieves all ledger entries for a given wristband
    entriesFor: db.prepare(`
      SELECT id, type, amount, terminal_id, terminal_txn_id, recorded_at, received_at
      FROM ledger_entries
      WHERE wristband_id = ?
      ORDER BY recorded_at, id
    `),
  };
}

/*
 * A retry with the same idempotency key must carry the same payload;
 * otherwise the terminal reused an id and we refuse rather than guess.
 */
function sameEntry(existing, e, type) {
  return (
    existing.type === type &&
    existing.wristband_id === e.wristband_id &&
    existing.amount === e.amount
  );
}

// Main ledger interface
export function createLedger(db) {
  const q = statements(db);

  /*
   * Top up a wristband's balance into the ledger.
   * Ensure the top-up request is valid and properly recorded.
   * Topup terminals are always online, so their clock is synchronized with the server.
   */
  function topUp(body) {
    // Validate the top-up request body before proceeding
    const error = validateEntry(body, { requireRecordedAt: false });
    if (error) return { status: Status.REJECTED, reason: error };

    return transaction(db, () => {
      // Check if a ledger entry with the same terminal_id and terminal_txn_id already exists
      const existing = q.findByKey.get(body.terminal_id, body.terminal_txn_id);
      if (existing) {
        // If an existing entry is found, check if it matches the current top-up request
        if (!sameEntry(existing, body, 'topup')) {
          return { status: Status.REJECTED, reason: 'terminal_txn_id already used for a different transaction' };
        }
        // If the existing entry matches the current request, it is considered a duplicate
        return { status: Status.DUPLICATE, balance: getBalance(body.wristband_id).balance };
      }
      const now = new Date().toISOString();

      // Top-up stations are online, so their clock and the server's are the same event.
      q.insertWristband.run(body.wristband_id, now);
      q.insertEntry.run(body.wristband_id, 'topup', body.amount, body.terminal_id, body.terminal_txn_id, now, now);
      return { status: Status.ACCEPTED, balance: getBalance(body.wristband_id).balance };
    });
  }

  /*
   * Sync the batch into the database.
   * Each entry in the batch is judged on its own: one bad spend does not
   * sink the rest. The whole batch is written in one DB transaction so a
   * crash mid-batch leaves nothing half-applied.
   */
  function sync(batch) {
    const receivedAt = new Date().toISOString();
    return transaction(db, () => {
      const touched = new Set();
      const results = batch.map((e, index) => {
        const ref = { index, terminal_txn_id: e?.terminal_txn_id ?? null };

        // Validate the individual spend entry before processing it
        const error = validateEntry(e, { requireRecordedAt: true });
        if (error) return { ...ref, status: Status.REJECTED, reason: error };

        // Check if a ledger entry with the same terminal_id and terminal_txn_id already exists
        const existing = q.findByKey.get(e.terminal_id, e.terminal_txn_id);
        if (existing) {
          // If an existing entry is found, check if it matches the current spend request
          if (!sameEntry(existing, e, 'spend')) {
            return { ...ref, status: Status.REJECTED, reason: 'terminal_txn_id already used for a different transaction' };
          }
          // If the existing entry matches the current request, it is considered a duplicate
          return { ...ref, status: Status.DUPLICATE };
        }

        // Ensure the wristband exists before recording the spend
        if (!q.findWristband.get(e.wristband_id)) {
          return { ...ref, status: Status.REJECTED, reason: 'unknown wristband_id' };
        }

        // We follow the accept-then-flag approach for offline spends/overspends.
        q.insertEntry.run(e.wristband_id, 'spend', e.amount, e.terminal_id,
          e.terminal_txn_id, new Date(e.recorded_at).toISOString(), receivedAt);
        touched.add(e.wristband_id);
        return { ...ref, status: Status.ACCEPTED };
      });

      // Identify wristbands that have been touched in this batch and are now flagged (e.g., overdrawn).
      const flagged_wristbands = [...touched]
        .map((id) => getBalance(id))
        .filter((b) => b.flagged)
        .map((b) => ({ wristband_id: b.wristband_id, balance: b.balance }));

      return { results, flagged_wristbands };
    });
  }

  /*
   * Replays the wristband's history in recorded_at order (not arrival
   * order), so late-arriving batches land in the right place and the
   * same set of entries always yields the same result.
   */
  function getBalance(wristbandId) {
    if (!q.findWristband.get(wristbandId)) return null;

    let balance = 0;
    const history = q.entriesFor.all(wristbandId).map((row) => {
      balance += row.type === 'topup' ? row.amount : -row.amount;
      return {
        ...row,
        running_balance: balance,
        overdrawn: row.type === 'spend' && balance < 0,
      };
    });

    return {
      wristband_id: wristbandId,
      balance,
      flagged: balance < 0,
      history,
    };
  }

  return { topUp, sync, getBalance };
}

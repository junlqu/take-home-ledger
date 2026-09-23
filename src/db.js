import { DatabaseSync } from 'node:sqlite';

/*
 * The ledger is append-only: every top-up and spend is one row in `ledger_entries`
 * balances are always derived by summing rows.
 * Triggers reject UPDATE/DELETE so history is immutable.
*/
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS wristbands (
    id          TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    balance     INTEGER NOT NULL DEFAULT 0,
    flagged     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT, -- arrival order at the server
    wristband_id     TEXT    NOT NULL REFERENCES wristbands(id),
    type             TEXT    NOT NULL CHECK (type IN ('topup', 'spend')),
    amount           INTEGER NOT NULL CHECK (amount > 0),
    terminal_id      TEXT    NOT NULL,
    terminal_txn_id  TEXT    NOT NULL,
    recorded_at      TEXT    NOT NULL,  -- when the terminal/station recorded it
    received_at      TEXT    NOT NULL,  -- when the server stored it
    UNIQUE (terminal_id, terminal_txn_id)  -- key for retries (idempotency)
  );

  CREATE INDEX IF NOT EXISTS idx_ledger_wristband
    ON ledger_entries (wristband_id, recorded_at, id);

  CREATE TRIGGER IF NOT EXISTS ledger_no_update
    BEFORE UPDATE ON ledger_entries
    BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only');
    END;

  CREATE TRIGGER IF NOT EXISTS ledger_no_delete
    BEFORE DELETE ON ledger_entries
    BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only');
    END;
`;

// Opens SQLite at the specified file path; in-memory by default.
export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Runs fn inside a transaction; rolls back if it throws.
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE'); // Write lock
  try {
    const result = fn();
    db.exec('COMMIT'); // Commit and unlock
    return result;
  } catch (err) {
    db.exec('ROLLBACK'); // Undo changes and unlock
    throw err;
  }
}

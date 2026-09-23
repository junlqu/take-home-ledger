# take-home-ledger

Backend for a festival cashless system: wristband top-ups, offline POS sync, and balances.
The ledger is **append-only**: each top-up and spend is one immutable row, and balances are derived from those rows.

Requires Node >= 22.13 (uses the built-in `node:sqlite`; the only dependency is Express).

```sh
npm install
npm start        # http://localhost:3000
npm test
```

## API

Amounts are integers in minor units (cents).

### `POST /topup`

```json
{ 
  "wristband_id": "wb-123",
  "amount": 5000,
  "terminal_id": "topup-123",
  "terminal_txn_id": "tup-123",
  "recorded_at": "2026-07-01T14:15:00Z"
}
```

Creates the wristband on its first top-up. `201` when applied, `200` with `"status": "duplicate"` on a retry, `400` when invalid.

### `POST /sync`

```json
{  
  "transactions": [
  { 
    "wristband_id": "wb-123",
    "amount": 700,
    "terminal_id": "pos-123",
    "terminal_txn_id": "pos-123",
    "recorded_at": "2026-07-01T14:15:00Z"
  }]
}
```

Returns `200` for any well-formed batch and judges each transaction separately:

```json
{
  "results": [
  {
    "index": 0,
    "terminal_txn_id": "pos-123",
    "status": "accepted"
  }],
  "flagged_wristbands": [
  {
    "wristband_id": "wb-123",
    "balance": -300,
  }]
}
```

`status` is one of `accepted`, `duplicate` (already stored, so it's safe to drop locally) or `rejected` (with a `reason`).

### `GET /balance/:id`

Returns the balance, a `flagged` flag (true when the balance is negative), and the history in `recorded_at` order. Each history row has a `running_balance` and an `overdrawn` marker.

See [DECISIONS.md](DECISIONS.md) for the reasoning behind these rules.

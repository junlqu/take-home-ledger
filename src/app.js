import express from 'express';
import { createLedger, Status } from './ledger.js';

const MAX_BATCH_SIZE = 5000;

export function createApp(db) {
  const ledger = createLedger(db);
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  /*
   * POST /topup
   *   wristband_id: wristband ID
   *   amount: top-up amount (minor units, e.g. cents)
   *   terminal_id: ID of the terminal performing the top-up
   *   terminal_txn_id: unique transaction ID from the terminal
   *   recorded_at: timestamp when the top-up was recorded
   */
  app.post('/topup', (req, res) => {
    const result = ledger.topUp(req.body);
    const code = result.status === Status.ACCEPTED ? 201
      : result.status === Status.DUPLICATE ? 200
      : 400;
    res.status(code).json(result);
  });

  /*
   * POST /sync
   *   terminal_id?: ID of the terminal performing the sync (optional)
   *   transactions: array of transaction objects, each containing:
   *     wristband_id: wristband ID
   *     amount: spend amount (minor units, e.g. cents)
   *     terminal_id: ID of the terminal performing the spend
   *     terminal_txn_id: unique transaction ID from the terminal
   *     recorded_at: timestamp when the spend was recorded
   * Always 200 for a well-formed batch; per-transaction outcomes are in `results`.
   */
  app.post('/sync', (req, res) => {
    const batch = req.body?.transactions;
    if (!Array.isArray(batch)) {
      return res.status(400).json({ error: 'body must be { transactions: [...] }' });
    }
    // Check batch size before processing (to prevent excessively large requests)
    if (batch.length > MAX_BATCH_SIZE) {
      return res.status(413).json({ error: `batch too large (max ${MAX_BATCH_SIZE}); split and retry` });
    }
    res.json(ledger.sync(batch));
  });

  /*
   * GET /balance/:id 
   *   id: ID of the wristband
   * Returns the current balance and full transaction history of the wristband.
   */
  app.get('/balance/:id', (req, res) => {
    const balance = ledger.getBalance(req.params.id);
    if (!balance) return res.status(404).json({ error: 'unknown wristband_id' });
    res.json(balance);
  });

  // Malformed JSON bodies and anything unexpected.
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

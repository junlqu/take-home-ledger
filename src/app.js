import express from 'express';
import { createLedger, Status } from './ledger.js';

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

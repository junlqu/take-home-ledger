import { openDb } from './db.js';
import { createApp } from './app.js';

// Server configuration (set PORT and DB_PATH via environment variables)
const PORT = 3000;
const DB_PATH = 'ledger.db';

const app = createApp(openDb(DB_PATH));
app.listen(PORT, () => {
  console.log(`ledger listening on http://localhost:${PORT} (db: ${DB_PATH})`);
});

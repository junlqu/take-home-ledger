import express from 'express';

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  return app;
}

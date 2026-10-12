import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Config } from './config';

export function createApp(config: Config): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'servigo-api' });
  });

  return app;
}

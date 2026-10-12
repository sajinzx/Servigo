import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Config } from './config';
import { authenticate, type AuthDeps } from './auth/middleware';
import { errorHandler, HttpError } from './http/errors';
import { meRouter, type ProfileRepo } from './routes/me';

export interface AppDeps {
  auth: AuthDeps;
  profiles: ProfileRepo;
}

export function createApp(config: Config, deps?: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'servigo-api' });
  });

  if (deps) {
    const auth = authenticate(deps.auth);
    app.use('/api/me', meRouter(deps.profiles, auth));
  }

  app.use((_req, _res, next) => next(new HttpError(404, 'route not found', 'not_found')));
  app.use(errorHandler);
  return app;
}

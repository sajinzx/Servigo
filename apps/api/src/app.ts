import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Config } from './config';
import { authenticate, type AuthDeps } from './auth/middleware';
import { errorHandler, HttpError } from './http/errors';
import { meRouter, type ProfileRepo } from './routes/me';
import { bookingsRouter, type BookingStore } from './routes/bookings';
import { offersRouter, type OfferStore } from './routes/offers';
import { webhooksRouter } from './routes/webhooks';
import { applicationsRouter } from './routes/applications';
import { adminRouter } from './routes/admin';
import { safetyRouter } from './routes/safety';
import { paymentsRouter, type PaymentsDeps } from './routes/payments';
import { financeRouter } from './routes/finance';
import { quotesRouter } from './routes/quotes';
import { baselineQuoter, mlQuoter, type Quoter } from './domain/quoter';
import type { MlClient } from './ml/client';
import { accessLog, bookingCreateLimiter, globalLimiter, requestId, writeLimiter } from './http/hardening';
import type { Rpc } from './db/rpc';
import type { NotificationStore } from './worker/ports';

export interface AppDeps {
  auth: AuthDeps;
  profiles: ProfileRepo;
  bookings?: BookingStore;
  offers?: OfferStore;
  notifications?: NotificationStore;
  /** generic access to the SQL rules functions (applications, admin, safety) */
  rpc?: Rpc;
  /** 32-byte key that encrypts payout details */
  payoutKey?: Buffer;
  /** UPI payee and Razorpay credentials; payments are disabled for whatever is missing */
  payments?: Omit<PaymentsDeps, 'rpc'>;
  /** ML service client; absent or unreachable means every prediction uses its baseline */
  ml?: MlClient;
  /** returns when the database answers; used by /ready */
  ping?: () => Promise<void>;
  /** set false in tests that hammer one route */
  rateLimit?: boolean;
  /** where access log lines go; defaults to stdout, silent under NODE_ENV=test */
  log?: (line: string) => void;
}

export function createApp(config: Config, deps?: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  if (deps?.log || config.NODE_ENV !== 'test') app.use(accessLog(deps?.log));
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()) }));
  // keep the raw body: webhook signatures are computed over the exact bytes
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  // liveness: the process is up. readiness: it can actually do work.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'servigo-api' });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await deps?.ping?.();
      res.json({ status: 'ready', database: deps?.ping ? 'ok' : 'not configured', ml: deps?.ml?.enabled ? 'configured' : 'off' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'down' });
    }
  });

  if (deps?.rateLimit !== false) {
    app.use('/api', globalLimiter);
  }

  if (deps?.notifications) {
    app.use(
      '/webhooks',
      webhooksRouter(deps.notifications, {
        whatsappAppSecret: config.WHATSAPP_APP_SECRET,
        whatsappVerifyToken: config.WHATSAPP_VERIFY_TOKEN,
        smsWebhookToken: config.SMS_WEBHOOK_TOKEN,
      }),
    );
  }

  if (deps) {
    const auth = authenticate(deps.auth);
    app.use('/api/me', meRouter(deps.profiles, auth));
    const quoter: Quoter = deps.ml?.enabled ? mlQuoter(deps.ml) : baselineQuoter;
    if (deps.bookings) {
      if (deps.rateLimit !== false) app.post('/api/bookings', bookingCreateLimiter);
      app.use('/api/bookings', bookingsRouter(deps.bookings, auth, quoter));
      app.use('/api', quotesRouter(deps.bookings, quoter, deps.ml ?? null, auth));
    }
    if (deps.offers) {
      if (deps.rateLimit !== false) app.use('/api/offers', writeLimiter);
      app.use('/api/offers', offersRouter(deps.offers, auth));
    }
    if (deps.rpc) {
      app.use('/api/admin/finance', financeRouter(deps.rpc, auth));
      app.use('/api/admin', adminRouter(deps.rpc, auth, deps.ml ?? null));
      app.use('/api', paymentsRouter({ rpc: deps.rpc, ...deps.payments }, auth));
      app.use('/api', safetyRouter(deps.rpc, auth));
      if (deps.payoutKey) {
        app.use('/api/applications', applicationsRouter({ rpc: deps.rpc, payoutKey: deps.payoutKey }, auth));
      }
    }
  }

  app.use((_req, _res, next) => next(new HttpError(404, 'route not found', 'not_found')));
  app.use(errorHandler);
  return app;
}

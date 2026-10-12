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
import type { NotificationStore } from './worker/ports';

export interface AppDeps {
  auth: AuthDeps;
  profiles: ProfileRepo;
  bookings?: BookingStore;
  offers?: OfferStore;
  notifications?: NotificationStore;
}

export function createApp(config: Config, deps?: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
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

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'servigo-api' });
  });

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
    if (deps.bookings) {
      app.use('/api/bookings', bookingsRouter(deps.bookings, auth));
    }
    if (deps.offers) {
      app.use('/api/offers', offersRouter(deps.offers, auth));
    }
  }

  app.use((_req, _res, next) => next(new HttpError(404, 'route not found', 'not_found')));
  app.use(errorHandler);
  return app;
}

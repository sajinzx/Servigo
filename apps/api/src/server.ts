import 'dotenv/config';
import { createRemoteJWKSet } from 'jose';
import { createApp, type AppDeps } from './app';
import { loadConfig } from './config';
import { createAdminClient } from './db/supabase';
import { supabaseProfiles } from './repos/profiles';
import { supabaseBookings } from './repos/bookings';
import { supabaseOffers } from './repos/offers';
import { supabaseRpc } from './db/rpc';
import { parseKey } from './domain/secrets';
import { MlClient } from './ml/client';
import { Pool } from 'pg';
import { pgNotificationStore } from './worker/pgNotifications';

/** A missing or malformed key disables workshop applications; it must not stop the whole API. */
function loadPayoutKey(raw: string | undefined): Buffer | undefined {
  if (!raw) return undefined;
  try {
    return parseKey(raw.trim());
  } catch (e) {
    console.error(`PAYOUT_ENCRYPTION_KEY is invalid (${(e as Error).message}); workshop applications are disabled`);
    return undefined;
  }
}

const config = loadConfig();

/** Say what shape each connection setting has, so a bad paste is obvious in the log. No secrets. */
function describeConfig() {
  const host = (raw?: string) => {
    if (!raw) return 'NOT SET';
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    } catch {
      return `NOT A VALID URL (starts with "${raw.slice(0, 12).replace(/[:@/].*/, '')}…", ${raw.length} chars)`;
    }
  };
  const key = (k?: string) =>
    !k ? 'NOT SET' : k.startsWith('sb_secret_') ? 'sb_secret key' : k.startsWith('eyJ') ? 'legacy jwt key' : `unrecognised (${k.length} chars)`;
  console.log(
    `config: supabase=${host(config.SUPABASE_URL)} key=${key(config.SUPABASE_SERVICE_ROLE_KEY)} ` +
      `jwks=${host(config.SUPABASE_JWKS_URL)} database=${host(process.env.DATABASE_URL)} ` +
      `worker=${process.env.RUN_WORKER === 'true'} ml=${config.ML_SERVICE_URL ? 'configured' : 'off'}`,
  );
}
describeConfig();
const db = createAdminClient(config);

let deps: AppDeps | undefined;
if (db) {
  const profiles = supabaseProfiles(db);
  deps = {
    auth: {
      jwtSecret: config.SUPABASE_JWT_SECRET,
      jwks: config.SUPABASE_JWKS_URL ? createRemoteJWKSet(new URL(config.SUPABASE_JWKS_URL)) : undefined,
      lookupRole: (id) => profiles.roleOf(id),
    },
    profiles,
    bookings: supabaseBookings(db),
    offers: supabaseOffers(db),
    ml: new MlClient({
      baseUrl: config.ML_SERVICE_URL,
      apiKey: config.ML_API_KEY,
      onFallback: (path, why) => console.warn(`ml ${path} fell back: ${why}`),
    }),
    rpc: supabaseRpc(db),
    payoutKey: loadPayoutKey(config.PAYOUT_ENCRYPTION_KEY),
    payments: {
      payee: config.UPI_PAYEE_ID ? { vpa: config.UPI_PAYEE_ID, name: config.UPI_PAYEE_NAME } : undefined,
      razorpay:
        config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET
          ? {
              keyId: config.RAZORPAY_KEY_ID,
              keySecret: config.RAZORPAY_KEY_SECRET,
              webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
            }
          : undefined,
    },
    notifications: process.env.DATABASE_URL
      ? pgNotificationStore(new Pool({ connectionString: process.env.DATABASE_URL, max: 3 }))
      : undefined,
  };
} else {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: only /health is available');
}

const app = createApp(config, deps && db ? { ...deps, ping: async () => {
          const r = await db.from('profiles').select('id').limit(1);
          if (r.error) {
            console.error(`readiness: supabase query failed: ${r.error.message}`);
            throw new Error(r.error.message);
          }
        } } : deps);

// one proxy hop (Render) so rate limits see the client's address
app.set('trust proxy', 1);

app.listen(config.PORT, () => {
  console.log(`servigo api listening on :${config.PORT}`);

  // Single-service hosting: run the queue worker inside this process. Jobs are durable, so if the
  // host sleeps the queue simply resumes on wake. Prefer a separate worker service when you can.
  if (process.env.RUN_WORKER === 'true') {
    if (!process.env.DATABASE_URL) {
      console.warn('RUN_WORKER=true but DATABASE_URL is not set; the worker was not started');
    } else {
      import('./worker/main').catch((e) => console.error('worker failed to start', e));
    }
  }
});

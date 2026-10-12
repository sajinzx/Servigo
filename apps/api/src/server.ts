import 'dotenv/config';
import { createApp, type AppDeps } from './app';
import { loadConfig } from './config';
import { createAdminClient } from './db/supabase';
import { supabaseProfiles } from './repos/profiles';
import { supabaseBookings } from './repos/bookings';
import { supabaseOffers } from './repos/offers';
import { supabaseRpc } from './db/rpc';
import { parseKey } from './domain/secrets';
import { Pool } from 'pg';
import { pgNotificationStore } from './worker/pgNotifications';

const config = loadConfig();
const db = createAdminClient(config);

let deps: AppDeps | undefined;
if (db) {
  const profiles = supabaseProfiles(db);
  deps = {
    auth: { jwtSecret: config.SUPABASE_JWT_SECRET, lookupRole: (id) => profiles.roleOf(id) },
    profiles,
    bookings: supabaseBookings(db),
    offers: supabaseOffers(db),
    rpc: supabaseRpc(db),
    payoutKey: config.PAYOUT_ENCRYPTION_KEY ? parseKey(config.PAYOUT_ENCRYPTION_KEY) : undefined,
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

createApp(config, deps).listen(config.PORT, () => {
  console.log(`servigo api listening on :${config.PORT}`);
});

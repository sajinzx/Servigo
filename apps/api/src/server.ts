import 'dotenv/config';
import { createApp, type AppDeps } from './app';
import { loadConfig } from './config';
import { createAdminClient } from './db/supabase';
import { supabaseProfiles } from './repos/profiles';
import { supabaseBookings } from './repos/bookings';

const config = loadConfig();
const db = createAdminClient(config);

let deps: AppDeps | undefined;
if (db) {
  const profiles = supabaseProfiles(db);
  deps = {
    auth: { jwtSecret: config.SUPABASE_JWT_SECRET, lookupRole: (id) => profiles.roleOf(id) },
    profiles,
    bookings: supabaseBookings(db),
  };
} else {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: only /health is available');
}

createApp(config, deps).listen(config.PORT, () => {
  console.log(`servigo api listening on :${config.PORT}`);
});

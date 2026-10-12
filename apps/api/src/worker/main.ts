import 'dotenv/config';
import { Pool } from 'pg';
import { buildHandlers } from './handlers';
import { Notifier } from './notifier';
import { pgNotificationStore } from './pgNotifications';
import { pgQueue } from './pgQueue';
import { runForever } from './runner';
import { emailChannel, pushChannel, smsChannel, whatsappChannel } from './channels';
import type { Channel, ChannelName } from './ports';

const env = process.env;
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required for the worker');
  process.exit(1);
}

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });
const queue = pgQueue(pool);
const store = pgNotificationStore(pool);

// providers are optional: a channel with no credentials simply is not offered,
// and the fallback chain moves on to the next one
const channels: Partial<Record<ChannelName, Channel>> = {};
if (env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN) {
  channels.whatsapp = whatsappChannel({
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
  });
}
if (env.MSG91_AUTH_KEY) {
  channels.sms = smsChannel({
    authKey: env.MSG91_AUTH_KEY,
    templateIds: JSON.parse(env.MSG91_TEMPLATE_IDS ?? '{}'),
  });
}
if (env.RESEND_API_KEY && env.EMAIL_FROM) {
  channels.email = emailChannel({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
}
if (env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
  channels.push = pushChannel({
    projectId: env.FCM_PROJECT_ID,
    clientEmail: env.FCM_CLIENT_EMAIL,
    privateKey: env.FCM_PRIVATE_KEY,
  });
}

const notifier = new Notifier({ store, queue, channels });
const handlers = buildHandlers({ store, queue, notifier });

const abort = new AbortController();
process.on('SIGTERM', () => abort.abort());
process.on('SIGINT', () => abort.abort());

console.log(`worker started; channels: ${Object.keys(channels).join(', ') || 'in-app only'}`);
runForever(queue, handlers, {
  queues: ['realtime', 'notify', 'billing', 'batch'],
  log: (m, x) => console.error(m, x ?? ''),
  signal: abort.signal,
}).then(() => pool.end());

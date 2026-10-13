import type { PGlite } from '@electric-sql/pglite';
import { addUser, createDb } from './harness';
import { pgQueue } from '../../src/worker/pgQueue';
import { pgNotificationStore } from '../../src/worker/pgNotifications';
import { Notifier } from '../../src/worker/notifier';
import { buildHandlers } from '../../src/worker/handlers';
import { runOnce } from '../../src/worker/runner';
import type { Channel, ChannelName, JobQueue } from '../../src/worker/ports';

interface Sent {
  channel: ChannelName;
  to: string | null | undefined;
  template: string;
}

function fakeChannels(failing: ChannelName[] = []) {
  const sent: Sent[] = [];
  const make = (name: ChannelName): Channel => ({
    name,
    async send(msg) {
      if (failing.includes(name)) throw new Error(`${name} provider down`);
      sent.push({ channel: name, to: msg.to.phone ?? msg.to.email ?? msg.to.pushToken, template: msg.template });
      return { providerMsgId: `${name}-${sent.length}` };
    },
  });
  return {
    sent,
    channels: {
      push: make('push'),
      whatsapp: make('whatsapp'),
      sms: make('sms'),
      email: make('email'),
    },
  };
}

interface World {
  db: PGlite;
  customer: string;
  mechanic: string;
  bookingId: string;
  workshop: string;
}

async function world(): Promise<World> {
  const db = await createDb();
  const customer = await addUser(db, { name: 'Asha', phone: '+919840000001', email: 'asha@example.com' });
  const mechanic = await addUser(db, { name: 'Ravi', phone: '+919840000002', email: 'ravi@example.com' });
  await db.query(`update public.profiles set role = 'mechanic', whatsapp_opt_in = true where id = $1`, [mechanic]);
  await db.query(`update public.profiles set whatsapp_opt_in = true where id = $1`, [customer]);
  await db.query(`insert into public.device_tokens (user_id, token) values ($1, 'fcm-token-1')`, [mechanic]);
  const ws = await db.query<{ id: string }>(
    `insert into public.workshops (owner_id, name, phone, city, lat, lng, staff_count)
     values ($1, 'Anna Nagar Auto', '+919840000002', 'Chennai', 13.085, 80.21, 2) returning id`,
    [mechanic],
  );
  const svc = await db.query<{ id: string }>(
    `insert into public.services (code, name, vehicle_kind, category, base_price, base_duration_min)
     values ('CAR_001', 'Car General Service', 'car', 'general', 2500, 180) returning id`,
  );
  const model = await db.query<{ id: string }>(
    `insert into public.vehicle_models (kind, make, model, segment) values ('car','Maruti','Swift','hatchback') returning id`,
  );
  const veh = await db.query<{ id: string }>(
    `insert into public.vehicles (owner_id, registration_no, model_id, year)
     values ($1, 'TN09AB1234', $2, 2019) returning id`,
    [customer, model.rows[0].id],
  );
  const b = await db.query<{ id: string }>(
    `select id from public.create_booking($1, $2, $3, 'workshop', 13.09, 80.21, null, null, 2950, 3500, 180)`,
    [customer, veh.rows[0].id, svc.rows[0].id],
  );
  return { db, customer, mechanic, bookingId: b.rows[0].id, workshop: ws.rows[0].id };
}

const notes = async (db: PGlite, userId?: string) =>
  (
    await db.query<{ channel: string; template: string; status: string; user_id: string }>(
      `select channel, template, status, user_id from public.notifications
        ${userId ? `where user_id = '${userId}'` : ''} order by created_at, channel`,
    )
  ).rows;

const drain = async (db: PGlite, notifier: Notifier, queue: JobQueue, rounds = 5) => {
  const store = pgNotificationStore(db);
  const handlers = buildHandlers({ store, queue, notifier });
  for (let i = 0; i < rounds; i++) {
    const { processed } = await runOnce(queue, handlers, { queues: ['realtime', 'notify'] });
    if (!processed) break;
  }
};

describe('notification worker', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });
  afterEach(async () => {
    await w.db.close();
  });

  it('turns a new booking into an in-app notification for the customer', async () => {
    const queue = pgQueue(w.db);
    const { channels } = fakeChannels();
    await drain(w.db, new Notifier({ store: pgNotificationStore(w.db), queue, channels }), queue);
    const rows = await notes(w.db, w.customer);
    expect(rows).toEqual([
      { channel: 'in_app', template: 'booking_created', status: 'sent', user_id: w.customer },
    ]);
  });

  it('sends nothing twice when the worker dies after sending but before completing', async () => {
    const queue = pgQueue(w.db);
    const { channels, sent } = fakeChannels();
    const notifier = new Notifier({ store: pgNotificationStore(w.db), queue, channels });

    // accepted -> whatsapp to the customer
    await w.db.query('update public.bookings set workshop_id = $2 where id = $1', [w.bookingId, w.workshop]);
    await w.db.query(`select public.transition_booking($1, 'offered', null, 'system')`, [w.bookingId]);
    await w.db.query(`select public.transition_booking($1, 'accepted', $2, 'mechanic')`, [w.bookingId, w.mechanic]);

    // a queue whose complete() "crashes" the process the first time
    let crashed = false;
    const crashy: JobQueue = {
      ...queue,
      async complete(id) {
        if (!crashed) {
          crashed = true;
          throw new Error('worker killed');
        }
        return queue.complete(id);
      },
    };
    const handlers = buildHandlers({ store: pgNotificationStore(w.db), queue: crashy, notifier });
    await runOnce(crashy, handlers, { queues: ['realtime', 'notify'], batchSize: 50 });

    // lock expires, a second worker picks everything up again
    await w.db.query(`update public.outbox set locked_until = now() - interval '1 second', next_run_at = now() where status = 'pending'`);
    await drain(w.db, notifier, queue, 10);

    const whatsapps = sent.filter((s) => s.channel === 'whatsapp' && s.template === 'booking_accepted');
    expect(whatsapps).toHaveLength(1);
    // (dispatch jobs belong to the allocation worker, which this test does not run)
    const pending = await w.db.query(
      `select 1 from public.outbox where status = 'pending' and event_type <> 'dispatch.booking'`,
    );
    expect(pending.rows).toHaveLength(0); // everything was eventually completed
    const dead = await w.db.query(
      `select 1 from public.outbox where status = 'dead' and event_type <> 'dispatch.booking'`,
    );
    expect(dead.rows).toHaveLength(0);
  });

  it('offers a job by push first and falls back to WhatsApp if push fails', async () => {
    const queue = pgQueue(w.db);
    const { channels, sent } = fakeChannels(['push']);
    const notifier = new Notifier({ store: pgNotificationStore(w.db), queue, channels });

    await w.db.query('update public.bookings set workshop_id = $2 where id = $1', [w.bookingId, w.workshop]);
    await w.db.query(
      `insert into public.offers (booking_id, workshop_id, score, rank, expires_at)
       values ($1, $2, 0.8, 1, now() + interval '90 seconds')`,
      [w.bookingId, w.workshop],
    );
    await w.db.query(`select public.transition_booking($1, 'offered', null, 'system')`, [w.bookingId]);
    await drain(w.db, notifier, queue);

    const mine = sent.filter((s) => s.template === 'offer_new');
    expect(mine.map((s) => s.channel)).toEqual(['whatsapp']);
    const rows = await notes(w.db, w.mechanic);
    expect(rows.find((r) => r.channel === 'push')?.status).toBe('failed');
  });

  it('re-sends an unanswered offer on the next channel after 20 seconds', async () => {
    const queue = pgQueue(w.db);
    const { channels, sent } = fakeChannels();
    const notifier = new Notifier({ store: pgNotificationStore(w.db), queue, channels });

    await w.db.query('update public.bookings set workshop_id = $2 where id = $1', [w.bookingId, w.workshop]);
    await w.db.query(
      `insert into public.offers (booking_id, workshop_id, score, rank, expires_at)
       values ($1, $2, 0.8, 1, now() + interval '90 seconds')`,
      [w.bookingId, w.workshop],
    );
    await w.db.query(`select public.transition_booking($1, 'offered', null, 'system')`, [w.bookingId]);
    await drain(w.db, notifier, queue);
    expect(sent.filter((s) => s.template === 'offer_new').map((s) => s.channel)).toEqual(['push']);

    // 20 s pass, offer still unanswered
    await w.db.query(`update public.outbox set next_run_at = now() where status = 'pending'`);
    await drain(w.db, notifier, queue);
    expect(sent.filter((s) => s.template === 'offer_new').map((s) => s.channel)).toEqual(['push', 'whatsapp']);
  });

  it('stops escalating once the offer has been answered', async () => {
    const queue = pgQueue(w.db);
    const { channels, sent } = fakeChannels();
    const notifier = new Notifier({ store: pgNotificationStore(w.db), queue, channels });

    await w.db.query('update public.bookings set workshop_id = $2 where id = $1', [w.bookingId, w.workshop]);
    await w.db.query(
      `insert into public.offers (booking_id, workshop_id, score, rank, expires_at)
       values ($1, $2, 0.8, 1, now() + interval '90 seconds')`,
      [w.bookingId, w.workshop],
    );
    await w.db.query(`select public.transition_booking($1, 'offered', null, 'system')`, [w.bookingId]);
    await drain(w.db, notifier, queue);

    await w.db.query(`update public.offers set response = 'accepted', responded_at = now()`);
    await w.db.query(`update public.outbox set next_run_at = now() where status = 'pending'`);
    await drain(w.db, notifier, queue);
    expect(sent.filter((s) => s.template === 'offer_new').map((s) => s.channel)).toEqual(['push']);
  });

  it('does not send WhatsApp to someone who has not opted in', async () => {
    await w.db.query(`update public.profiles set whatsapp_opt_in = false where id = $1`, [w.customer]);
    const queue = pgQueue(w.db);
    const { channels, sent } = fakeChannels();
    const notifier = new Notifier({ store: pgNotificationStore(w.db), queue, channels });

    await w.db.query('update public.bookings set workshop_id = $2 where id = $1', [w.bookingId, w.workshop]);
    await w.db.query(`select public.transition_booking($1, 'offered', null, 'system')`, [w.bookingId]);
    await w.db.query(`select public.transition_booking($1, 'accepted', $2, 'mechanic')`, [w.bookingId, w.mechanic]);
    await drain(w.db, notifier, queue);
    expect(sent.filter((s) => s.channel === 'whatsapp' && s.template === 'booking_accepted')).toHaveLength(0);
  });

  it('defers non-live messages to 08:00 IST', async () => {
    const queue = pgQueue(w.db);
    const { channels, sent } = fakeChannels();
    // 23:00 IST = 17:30 UTC
    const night = new Date('2026-10-13T17:30:00Z');
    const notifier = new Notifier({ store: pgNotificationStore(w.db), queue, channels, now: () => night });

    await notifier.deliver({
      user_id: w.customer,
      template: 'payment_received',
      vars: { ref: 'BK-1', price: 'Rs 2,950' },
      channels: ['whatsapp'],
      live: false,
      key: 'test:quiet',
    });
    expect(sent).toHaveLength(0);
    const due = await w.db.query<{ next_run_at: string }>(
      `select next_run_at from public.outbox where idempotency_key = 'test:quiet:after-quiet'`,
    );
    expect(new Date(due.rows[0].next_run_at).toISOString()).toBe('2026-10-14T02:30:00.000Z'); // 08:00 IST
  });

  it('retries a job whose channels all failed, then dead-letters it', async () => {
    const queue = pgQueue(w.db);
    const { channels } = fakeChannels(['whatsapp']);
    const notifier = new Notifier({ store: pgNotificationStore(w.db), queue, channels });
    await queue.enqueue({
      queue: 'notify',
      eventType: 'notify.send',
      payload: {
        user_id: w.customer, template: 'booking_no_match', vars: { ref: 'BK-1' },
        channels: ['whatsapp'], live: true, key: 'test:fail',
      },
      key: 'job:fail',
    });
    const handlers = buildHandlers({ store: pgNotificationStore(w.db), queue, notifier });
    for (let i = 0; i < 5; i++) {
      await w.db.query(`update public.outbox set next_run_at = now() where status = 'pending'`);
      await runOnce(queue, handlers, { queues: ['notify'] });
    }
    const r = await w.db.query<{ status: string; last_error: string }>(
      `select status, last_error from public.outbox where idempotency_key = 'job:fail'`,
    );
    expect(r.rows[0].status).toBe('dead');
    expect(r.rows[0].last_error).toMatch(/whatsapp provider down/);
  });
});

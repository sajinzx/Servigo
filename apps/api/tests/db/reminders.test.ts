import { addUser, createDb } from './harness';
import { MlClient } from '../../src/ml/client';
import { pgQueue } from '../../src/worker/pgQueue';
import { reminderHandlers } from '../../src/worker/reminders';
import type { Job } from '../../src/worker/ports';

const job = { id: 1, queue: 'batch', event_type: 'reminders.service_due', payload: {}, idempotency_key: 'k', attempts: 1 } as Job;

describe('service-due reminders', () => {
  it('queues one reminder per vehicle per month for vehicles the model says are due', async () => {
    const db = await createDb();
    const one = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
    const owner = await addUser(db, { name: 'Asha' });
    const model = await one(
      `insert into public.vehicle_models (kind, make, model, segment) values ('car','Maruti','Swift','hatchback') returning id`);
    const due = await one(
      `insert into public.vehicles (owner_id, registration_no, model_id, year, odometer_km, last_service_at)
       values ($1,'TN09AB1111',$2,2020,40000, now() - interval '200 days') returning id`, [owner, model]);
    await db.query(
      `insert into public.vehicles (owner_id, registration_no, model_id, year, odometer_km, last_service_at)
       values ($1,'TN09AB2222',$2,2024,3000, now() - interval '10 days')`, [owner, model]);

    // the fake model says "due" only for the long-unserviced car
    const f = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { days_since_service: number };
      const p = body.days_since_service > 100 ? 0.9 : 0.1;
      return new Response(
        JSON.stringify({ probability_due: p, days_left: p > 0.5 ? 12 : 120, median_days_between_services: 150, model_version: 'v1' }),
      );
    }) as unknown as typeof fetch;
    const ml = new MlClient({ baseUrl: 'http://ml', fetchImpl: f });
    const queue = pgQueue(db);
    const h = reminderHandlers(db, ml, queue)['reminders.service_due'];

    await h(job);
    await h(job); // a rerun the same month must add nothing

    const rows = await db.query<{ vehicle_id: string }>('select vehicle_id from public.service_reminders');
    expect(rows.rows.map((r) => r.vehicle_id)).toEqual([due]);
    const jobs = await db.query<{ payload: { user_id: string; vars: { days: string } } }>(
      `select payload from public.outbox where event_type = 'notify.send'`);
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0].payload.user_id).toBe(owner);
    expect(jobs.rows[0].payload.vars.days).toBe('12');
    await db.close();
  });

  it('sends nothing when the ml service is down', async () => {
    const db = await createDb();
    const owner = await addUser(db, { name: 'Asha' });
    const m = await db.query<{ id: string }>(
      `insert into public.vehicle_models (kind, make, model, segment) values ('car','Maruti','Swift','hatchback') returning id`);
    await db.query(
      `insert into public.vehicles (owner_id, registration_no, model_id, year) values ($1,'TN09AB3333',$2,2019)`,
      [owner, m.rows[0].id]);
    const ml = new MlClient({ baseUrl: 'http://ml', fetchImpl: (async () => new Response('', { status: 500 })) as unknown as typeof fetch });
    await reminderHandlers(db, ml, pgQueue(db))['reminders.service_due'](job);
    const r = await db.query('select 1 from public.service_reminders');
    expect(r.rows).toHaveLength(0);
    await db.close();
  });
});

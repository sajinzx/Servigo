import type { PGlite } from '@electric-sql/pglite';
import { addUser, asUser, createDb } from './harness';

interface W {
  db: PGlite;
  admin: string;
  customer: string;
  mechanic: string;
  workshop: string;
  vehicle: string;
  service: string;
}

async function world(): Promise<W> {
  const db = await createDb();
  const one = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
  const admin = await addUser(db, { name: 'Admin' });
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  const customer = await addUser(db, { name: 'Customer' });
  const mechanic = await addUser(db, { name: 'Mechanic' });
  await db.query(`update public.profiles set role = 'mechanic' where id = $1`, [mechanic]);
  const workshop = await one(
    `insert into public.workshops (owner_id, name, city, lat, lng, staff_count, stage, gst_registered)
     values ($1,'Shop','Chennai',13.08,80.21,10,'active',true) returning id`, [mechanic]);
  const service = await one(
    `insert into public.services (code, name, vehicle_kind, category, base_price, base_duration_min)
     values ('CAR_001','Car General Service','car','general',2500,180) returning id`);
  const model = await one(
    `insert into public.vehicle_models (kind, make, model, segment) values ('car','Maruti','Swift','hatchback') returning id`);
  const vehicle = await one(
    `insert into public.vehicles (owner_id, registration_no, model_id, year) values ($1,'TN09AB1234',$2,2019) returning id`,
    [customer, model]);
  return { db, admin, customer, mechanic, workshop, vehicle, service };
}

async function accepted(w: W, secondsToAccept: number) {
  const id = (
    await w.db.query<{ id: string }>(
      `select id from public.create_booking($1,$2,$3,'workshop',13.09,80.21,null,null,2950,3500,180)`,
      [w.customer, w.vehicle, w.service],
    )
  ).rows[0].id;
  await w.db.query(`update public.bookings set workshop_id = $2, eta_min = 12 where id = $1`, [id, w.workshop]);
  await w.db.query(`select public.transition_booking($1,'offered',null,'system')`, [id]);
  await w.db.query(`select public.transition_booking($1,'accepted',$2,'mechanic')`, [id, w.mechanic]);
  // make the acceptance happen `secondsToAccept` after the request
  await w.db.query(
    `update public.booking_events set at = (select at from public.booking_events where booking_id = $1 and to_status = 'requested')
                                           + make_interval(secs => $2)
      where booking_id = $1 and to_status = 'accepted'`, [id, secondsToAccept]);
  return id;
}

describe('admin reporting', () => {
  it('is closed to everyone but admins', async () => {
    const w = await world();
    await expect(
      asUser(w.db, w.customer, async () => {
        await w.db.query(`select * from public.admin_kpis(7)`);
      }),
    ).rejects.toThrow(/admin only/);
    await expect(
      asUser(w.db, w.mechanic, async () => {
        await w.db.query(`select public.jobs_gini(7)`);
      }),
    ).rejects.toThrow(/admin only/);
    await w.db.close();
  });

  it('reports time to assign and acceptance per day', async () => {
    const w = await world();
    for (const s of [20, 40, 60, 120]) await accepted(w, s);
    await w.db.query(
      `insert into public.offers (booking_id, workshop_id, score, rank, expires_at, response)
       select id, workshop_id, 0.5, 1, now(), 'accepted' from public.bookings`);
    const rows = await asUser(w.db, w.admin, async () =>
      (await w.db.query<Record<string, string>>(`select * from public.admin_kpis(7)`)).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].bookings).toBe(4);
    expect(Number(rows[0].median_assign_s)).toBe(50); // between 40 and 60
    expect(Number(rows[0].p90_assign_s)).toBeGreaterThan(60);
    expect(rows[0].offers_accepted).toBe(4);
    expect(Number(rows[0].mean_eta_min)).toBe(12);
    await w.db.close();
  });

  it('computes the Gini of jobs across active workshops', async () => {
    const w = await world();
    // a second active shop that gets nothing: 4 jobs vs 0 -> Gini 0.5
    await w.db.query(
      `insert into public.workshops (name, city, lat, lng, staff_count, stage) values ('Idle','Chennai',13.1,80.2,2,'active')`);
    for (let i = 0; i < 4; i++) await accepted(w, 30);
    const g = await asUser(w.db, w.admin, async () =>
      Number((await w.db.query<{ g: string }>(`select public.jobs_gini(7) as g`)).rows[0].g));
    expect(g).toBeCloseTo(0.5, 3);
    await w.db.close();
  });

  it('writes real pilot metrics with their sample sizes and never touches sim rows', async () => {
    const w = await world();
    for (const s of [30, 50, 70]) await accepted(w, s);
    await w.db.query(
      `insert into public.pilot_metrics (metric, source, period, value, n) values ('no_match_rate','sim','pilot',0.05,1000)`);
    const n = await w.db.query<{ n: number }>(
      `select public.compute_pilot_metrics('pilot', now() - interval '1 day', now() + interval '1 day') as n`);
    expect(n.rows[0].n).toBeGreaterThanOrEqual(3);

    const med = await w.db.query<{ value: number; n: number; source: string }>(
      `select value, n, source from public.pilot_metrics where metric = 'time_to_assign_median_s'`);
    expect(med.rows).toEqual([{ value: 50, n: 3, source: 'real' }]);
    const sim = await w.db.query<{ value: number }>(
      `select value from public.pilot_metrics where metric = 'no_match_rate' and source = 'sim'`);
    expect(sim.rows[0].value).toBe(0.05);
    // the source column cannot be anything but real or sim
    await expect(
      w.db.query(`insert into public.pilot_metrics (metric, source, period, value, n) values ('x','synthetic','p',1,1)`),
    ).rejects.toThrow();
    await w.db.close();
  });

  it("shows a workshop only its own summary, with a rating only after 5 reviews", async () => {
    const w = await world();
    const rows = await asUser(w.db, w.mechanic, async () =>
      (await w.db.query<{ workshop_id: string; rating: string | null }>(`select * from public.my_workshop_summary()`)).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].workshop_id).toBe(w.workshop);
    expect(rows[0].rating).toBeNull();
    const other = await asUser(w.db, w.customer, async () =>
      (await w.db.query(`select * from public.my_workshop_summary()`)).rows);
    expect(other).toHaveLength(0);
    await w.db.close();
  });

  it('exports flat pilot rows an admin can hand to the report generator', async () => {
    const w = await world();
    const id = await accepted(w, 45);
    await w.db.query(`update public.bookings set started_at = now() + interval '15 minutes' where id = $1`, [id]);
    const rows = await asUser(w.db, w.admin, async () =>
      (await w.db.query<Record<string, unknown>>(
        `select * from public.pilot_export_bookings(now() - interval '1 day', now() + interval '1 day')`)).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'accepted', service_code: 'CAR_001', vehicle_kind: 'car', assign_s: 45 });
    // eta was 12 minutes; the job "started" a little after acceptance, so the error is about +3 minutes
    expect(Number(rows[0].eta_error_min)).toBeGreaterThan(2);
    expect(Number(rows[0].eta_error_min)).toBeLessThan(4);

    await expect(
      asUser(w.db, w.customer, async () => {
        await w.db.query(`select * from public.pilot_export_bookings(now() - interval '1 day', now())`);
      }),
    ).rejects.toThrow(/admin only/);
    await w.db.close();
  });
});

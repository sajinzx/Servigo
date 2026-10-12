import type { PGlite } from '@electric-sql/pglite';
import { addUser, createDb } from './harness';
import { Allocator } from '../../src/allocation/allocator';
import { allocationHandlers } from '../../src/allocation/handlers';
import { fallbackEtaMin } from '../../src/domain/geo';
import type { EtaProvider } from '../../src/domain/osrm';
import { runOnce } from '../../src/worker/runner';
import { pgQueue } from '../../src/worker/pgQueue';

const ALWAYS_OPEN = JSON.stringify(
  Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['00:00', '23:59']])),
);

const eta: EtaProvider = {
  async etas(from, to) {
    return { etaMin: from.map((p) => fallbackEtaMin(p, to)), usedFallback: false };
  },
};

interface Shop {
  id: string;
  owner: string;
}

interface W {
  db: PGlite;
  allocator: Allocator;
  customer: string;
  carService: string;
  bikeService: string;
  car: string;
  bike: string;
  shop(name: string, lat: number, lng: number, staff: number, opts?: ShopOpts): Promise<Shop>;
  book(vehicle?: string, service?: string, lat?: number, lng?: number): Promise<string>;
}

interface ShopOpts {
  hours?: string;
  kinds?: string;
  offerService?: boolean;
  paused?: boolean;
  ratingSum?: number;
  ratingCount?: number;
  doorstep?: boolean;
  radius?: number;
}

async function world(): Promise<W> {
  const db = await createDb();
  const customer = await addUser(db, { name: 'Customer' });
  const one = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ id: string }>(sql, params)).rows[0].id;

  const carService = await one(
    `insert into public.services (code, name, vehicle_kind, category, base_price, base_duration_min)
     values ('CAR_001','Car General Service','car','general',2500,180) returning id`,
  );
  const bikeService = await one(
    `insert into public.services (code, name, vehicle_kind, category, base_price, base_duration_min)
     values ('BIKE_001','Bike General Service','bike','general',800,120) returning id`,
  );
  const carModel = await one(
    `insert into public.vehicle_models (kind, make, model, segment) values ('car','Maruti','Swift','hatchback') returning id`,
  );
  const bikeModel = await one(
    `insert into public.vehicle_models (kind, make, model, segment) values ('bike','Hero','Splendor','commuter') returning id`,
  );
  const car = await one(
    `insert into public.vehicles (owner_id, registration_no, model_id, year) values ($1,'TN09AB1234',$2,2019) returning id`,
    [customer, carModel],
  );
  const bike = await one(
    `insert into public.vehicles (owner_id, registration_no, model_id, year) values ($1,'TN10CD5678',$2,2021) returning id`,
    [customer, bikeModel],
  );

  let n = 0;
  const shop: W['shop'] = async (name, lat, lng, staff, o = {}) => {
    const owner = await addUser(db, { name: `${name} owner` });
    await db.query(`update public.profiles set role = 'mechanic' where id = $1`, [owner]);
    const id = await one(
      `insert into public.workshops (owner_id, name, city, lat, lng, staff_count, open_hours, vehicle_kinds,
                                     rating_sum, rating_count, offers_doorstep, service_radius_km, stage)
       values ($1,$2,'Chennai',$3,$4,$5,$6::jsonb,$7::public.vehicle_kind[],$8,$9,$10,$11,'active') returning id`,
      [owner, name, lat, lng, staff, o.hours ?? ALWAYS_OPEN, o.kinds ?? '{car,bike}', o.ratingSum ?? 0,
       o.ratingCount ?? 0, o.doorstep ?? false, o.radius ?? 10],
    );
    if (o.offerService !== false) {
      for (const svc of [carService, bikeService]) {
        await db.query(
          `insert into public.workshop_services (workshop_id, service_id, is_paused) values ($1,$2,$3)`,
          [id, svc, o.paused ?? false],
        );
      }
    }
    n++;
    return { id, owner };
  };

  const book: W['book'] = async (vehicle = car, service = carService, lat = 13.09, lng = 80.21) =>
    one(
      `select id from public.create_booking($1,$2,$3,'workshop',$4,$5,null,null,2950,3500,180)`,
      [customer, vehicle, service, lat, lng],
    );

  return { db, allocator: new Allocator(db, { eta }), customer, carService, bikeService, car, bike, shop, book };
}

const stateOf = async (db: PGlite, id: string) =>
  (await db.query<{ status: string; workshop_id: string | null }>(
    'select status, workshop_id from public.bookings where id = $1', [id])).rows[0];

describe('allocation', () => {
  let w: W;
  beforeEach(async () => {
    w = await world();
  });
  afterEach(async () => {
    await w.db.close();
  });

  it('offers a Chennai booking to a Chennai shop, never to a higher-rated Bangalore one', async () => {
    const near = await w.shop('Anna Nagar Auto', 13.085, 80.2101, 2, { ratingSum: 40, ratingCount: 10 });
    await w.shop('Bangalore Elite', 12.9352, 77.6245, 9, { ratingSum: 500, ratingCount: 100 });
    const id = await w.book();
    const out = await w.allocator.dispatch(id);
    expect(out.outcome).toBe('offered');
    expect(out).toMatchObject({ workshopId: near.id });
    expect((await stateOf(w.db, id)).status).toBe('offered');
  });

  it('skips shops that cannot do the job: wrong vehicle kind, paused, closed, not offering', async () => {
    await w.shop('Bike only', 13.085, 80.21, 3, { kinds: '{bike}' });
    await w.shop('Paused', 13.086, 80.21, 3, { paused: true });
    await w.shop('Closed', 13.087, 80.21, 3, { hours: '{}' });
    await w.shop('No service', 13.088, 80.21, 3, { offerService: false });
    const good = await w.shop('Good', 13.2, 80.3, 3);
    const id = await w.book();
    const out = await w.allocator.dispatch(id);
    expect(out).toMatchObject({ outcome: 'offered', workshopId: good.id });
  });

  it('prefers the idle shop over a busy one at the same distance', async () => {
    // same spot, so ETA is equal and load decides
    const busy = await w.shop('Busy', 13.1, 80.21, 2);
    const idle = await w.shop('Idle', 13.1, 80.21, 2);
    // busy already has one job running
    const first = await w.book();
    await w.db.query('update public.bookings set workshop_id = $2 where id = $1', [first, busy.id]);
    await w.db.query(`select public.transition_booking($1,'offered',null,'system')`, [first]);
    await w.db.query(`select public.transition_booking($1,'accepted',$2,'mechanic')`, [first, busy.owner]);
    const second = await w.book();
    const out = await w.allocator.dispatch(second);
    expect(out).toMatchObject({ outcome: 'offered', workshopId: idle.id });
  });

  it('moves to the next shop when an offer is rejected', async () => {
    const a = await w.shop('A', 13.09, 80.21, 1);
    const b = await w.shop('B', 13.12, 80.25, 1);
    const id = await w.book();
    const first = await w.allocator.dispatch(id);
    expect(first).toMatchObject({ outcome: 'offered', workshopId: a.id });
    if (first.outcome !== 'offered') throw new Error('unreachable');

    await w.db.query(`select public.respond_offer($1,'rejected',$2,'mechanic')`, [first.offerId, a.owner]);
    expect((await stateOf(w.db, id)).status).toBe('matching');

    const second = await w.allocator.dispatch(id);
    expect(second).toMatchObject({ outcome: 'offered', workshopId: b.id });
  });

  it('ends in no_match once every shop within 40 km has been tried', async () => {
    const a = await w.shop('Only shop', 13.09, 80.21, 1);
    const id = await w.book();
    const first = await w.allocator.dispatch(id);
    if (first.outcome !== 'offered') throw new Error('expected an offer');
    await w.db.query(`select public.respond_offer($1,'rejected',$2,'mechanic')`, [first.offerId, a.owner]);
    const second = await w.allocator.dispatch(id);
    expect(second.outcome).toBe('no_match');
    expect((await stateOf(w.db, id)).status).toBe('no_match');
  });

  it('widens the radius when too few shops are close', async () => {
    // 12 km away: outside 5 km, inside 20 km
    const far = await w.shop('Far', 13.2, 80.21, 2);
    const id = await w.book();
    const out = await w.allocator.dispatch(id);
    expect(out).toMatchObject({ outcome: 'offered', workshopId: far.id });
    if (out.outcome === 'offered') expect(out.radiusKm).toBeGreaterThan(10);
    const r = await w.db.query<{ search_radius_km: number }>(
      'select search_radius_km from public.bookings where id = $1', [id]);
    expect(r.rows[0].search_radius_km).toBeGreaterThan(5);
  });

  it('returns no_match immediately when nothing is within 40 km', async () => {
    await w.shop('Bangalore', 12.9352, 77.6245, 4);
    const id = await w.book();
    expect((await w.allocator.dispatch(id)).outcome).toBe('no_match');
  });

  it('expires an unanswered offer through the delayed job and re-queues dispatch', async () => {
    const a = await w.shop('A', 13.09, 80.21, 1);
    const b = await w.shop('B', 13.12, 80.25, 1);
    const queue = pgQueue(w.db);
    const handlers = allocationHandlers(w.db, w.allocator);
    const id = await w.book();

    // the dispatch job queued by create_booking
    await runOnce(queue, handlers, { queues: ['realtime'] });
    const offered = await stateOf(w.db, id);
    expect(offered).toEqual({ status: 'offered', workshop_id: a.id });

    // 90 s pass with no answer
    await w.db.query(`update public.outbox set next_run_at = now() where event_type = 'offer.timeout'`);
    await runOnce(queue, handlers, { queues: ['realtime'], batchSize: 50 });
    expect((await stateOf(w.db, id)).status).toBe('matching');

    // the re-dispatch job offers it to the next shop
    await runOnce(queue, handlers, { queues: ['realtime'], batchSize: 50 });
    expect(await stateOf(w.db, id)).toEqual({ status: 'offered', workshop_id: b.id });

    const offers = await w.db.query<{ response: string }>(
      'select response from public.offers where booking_id = $1 order by offered_at, rank', [id]);
    expect(offers.rows.map((o) => o.response)).toEqual(['expired', 'pending']);
  });

  it('treats an accept that arrives after capacity filled as a miss', async () => {
    const a = await w.shop('A', 13.09, 80.21, 1);
    await w.shop('B', 13.12, 80.25, 1);
    const id = await w.book();
    const out = await w.allocator.dispatch(id);
    if (out.outcome !== 'offered') throw new Error('expected offer');
    // while the offer is pending the shop is given another job directly
    const other = await w.book();
    await w.db.query('update public.bookings set workshop_id = $2, status = $3 where id = $1',
      [other, a.id, 'in_progress']);
    const o = await w.db.query<{ response: string }>(
      `select response from public.respond_offer($1,'accepted',$2,'mechanic')`, [out.offerId, a.owner]);
    expect(o.rows[0].response).toBe('expired');
    expect((await stateOf(w.db, id)).status).toBe('matching');
  });

  it('is idempotent: a second answer to the same offer changes nothing', async () => {
    const a = await w.shop('A', 13.09, 80.21, 2);
    const id = await w.book();
    const out = await w.allocator.dispatch(id);
    if (out.outcome !== 'offered') throw new Error('expected offer');
    await w.db.query(`select public.respond_offer($1,'accepted',$2,'mechanic')`, [out.offerId, a.owner]);
    const again = await w.db.query<{ response: string }>(
      `select response from public.respond_offer($1,'rejected',$2,'mechanic')`, [out.offerId, a.owner]);
    expect(again.rows[0].response).toBe('accepted');
    expect((await stateOf(w.db, id)).status).toBe('accepted');
  });

  it("does not let one shop's owner answer another shop's offer", async () => {
    await w.shop('A', 13.09, 80.21, 2);
    const b = await w.shop('B', 13.3, 80.4, 2);
    const id = await w.book();
    const out = await w.allocator.dispatch(id);
    if (out.outcome !== 'offered') throw new Error('expected offer');
    await expect(
      w.db.query(`select * from public.respond_offer($1,'accepted',$2,'mechanic')`, [out.offerId, b.owner]),
    ).rejects.toThrow(/not your offer/);
  });
});

describe('capacity under load', () => {
  it('100 simultaneous bookings never push any workshop past its staff count', async () => {
    const w = await world();
    const staff = [2, 3, 1, 4];
    const shops: Shop[] = [];
    for (let i = 0; i < staff.length; i++) {
      shops.push(await w.shop(`Shop ${i}`, 13.08 + i * 0.01, 80.2 + i * 0.01, staff[i]));
    }
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) ids.push(await w.book());

    // dispatch everything at once, then have every offered shop accept
    const outs = await Promise.all(ids.map((id) => w.allocator.dispatch(id)));
    const offered = outs.filter((o) => o.outcome === 'offered');
    await Promise.all(
      offered.map((o) => {
        if (o.outcome !== 'offered') return null;
        const owner = shops.find((s) => s.id === o.workshopId)!.owner;
        return w.db
          .query(`select public.respond_offer($1,'accepted',$2,'mechanic')`, [o.offerId, owner])
          .catch(() => null);
      }),
    );

    const load = await w.db.query<{ workshop_id: string; n: string; staff_count: number }>(
      `select b.workshop_id, count(*)::text n, w.staff_count
         from public.bookings b join public.workshops w on w.id = b.workshop_id
        where b.status in ('accepted','in_progress')
        group by b.workshop_id, w.staff_count`,
    );
    for (const row of load.rows) expect(Number(row.n)).toBeLessThanOrEqual(row.staff_count);

    const pending = await w.db.query<{ n: string; staff_count: number }>(
      `select count(*)::text n, w.staff_count from public.offers o
         join public.workshops w on w.id = o.workshop_id
        where o.response = 'pending' group by o.workshop_id, w.staff_count`,
    );
    for (const row of pending.rows) expect(Number(row.n)).toBeLessThanOrEqual(row.staff_count);

    const accepted = load.rows.reduce((s, r) => s + Number(r.n), 0);
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThanOrEqual(staff.reduce((a, b) => a + b, 0));
    await w.db.close();
  });
});

describe('batch assignment', () => {
  it('beats greedy order when the first request would take the only good slot', async () => {
    const w = await world();
    // one slot at "near", one slot at "mid"; request 2 can ONLY reach near within the radius
    const near = await w.shop('Near', 13.09, 80.21, 1);
    const mid = await w.shop('Mid', 13.115, 80.21, 1);
    const first = await w.book(w.car, w.carService, 13.1, 80.21); // between both
    const second = await w.book(w.car, w.carService, 13.0905, 80.21); // right next to near

    const results = await w.allocator.dispatchBatch([first, second]);
    const byBooking = new Map<string, string>();
    for (const r of results) if (r.outcome === 'offered') byBooking.set(r.workshopId, r.offerId);
    expect(results.every((r) => r.outcome === 'offered')).toBe(true);
    // each workshop gets exactly one of the two requests
    expect(byBooking.size).toBe(2);
    expect(byBooking.has(near.id) && byBooking.has(mid.id)).toBe(true);
    await w.db.close();
  });
});

describe('workshop_open_at', () => {
  it('reads weekday windows in IST', async () => {
    const db = await createDb();
    const hours = '{"mon":["09:00","19:00"]}';
    const q = async (ts: string) =>
      (await db.query<{ o: boolean }>(
        `select public.workshop_open_at($1::jsonb, $2::timestamptz) as o`, [hours, ts])).rows[0].o;
    expect(await q('2026-10-12T04:00:00Z')).toBe(true); // Mon 09:30 IST
    expect(await q('2026-10-12T03:00:00Z')).toBe(false); // Mon 08:30 IST
    expect(await q('2026-10-13T04:00:00Z')).toBe(false); // Tue: no window
    await db.close();
  });
});

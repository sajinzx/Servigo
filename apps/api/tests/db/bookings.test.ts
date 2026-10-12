import type { PGlite } from '@electric-sql/pglite';
import { addUser, asUser, createDb } from './harness';

const STATUSES = [
  'requested', 'matching', 'offered', 'accepted', 'in_progress', 'completed',
  'payment_pending_verification', 'paid', 'reviewed', 'cancelled', 'no_match', 'disputed', 'refunded',
];

interface World {
  db: PGlite;
  customer: string;
  other: string;
  mechanic: string;
  otherMechanic: string;
  admin: string;
  workshop: string;
  service: string;
  vehicle: string;
  bikeVehicle: string;
}

async function buildWorld(staffCount = 1): Promise<World> {
  const db = await createDb();
  const customer = await addUser(db, { name: 'Customer' });
  const other = await addUser(db, { name: 'Other' });
  const mechanic = await addUser(db, { name: 'Mechanic' });
  const otherMechanic = await addUser(db, { name: 'Other Mechanic' });
  const admin = await addUser(db, { name: 'Admin' });
  await db.query(`update public.profiles set role = 'mechanic' where id in ($1, $2)`, [
    mechanic,
    otherMechanic,
  ]);
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

  const ws = await db.query<{ id: string }>(
    `insert into public.workshops (owner_id, name, city, lat, lng, staff_count)
     values ($1, 'Anna Nagar Auto', 'Chennai', 13.085, 80.2101, $2) returning id`,
    [mechanic, staffCount],
  );
  await db.query(
    `insert into public.workshops (owner_id, name, city, lat, lng, staff_count)
     values ($1, 'Other Shop', 'Chennai', 13.04, 80.23, 2)`,
    [otherMechanic],
  );
  const svc = await db.query<{ id: string }>(
    `insert into public.services (code, name, vehicle_kind, category, base_price, base_duration_min)
     values ('CAR_001', 'Car General Service', 'car', 'general', 2500, 180) returning id`,
  );
  const carModel = await db.query<{ id: string }>(
    `insert into public.vehicle_models (kind, make, model, segment) values ('car','Maruti','Swift','hatchback') returning id`,
  );
  const bikeModel = await db.query<{ id: string }>(
    `insert into public.vehicle_models (kind, make, model, segment) values ('bike','Hero','Splendor','commuter') returning id`,
  );
  const car = await db.query<{ id: string }>(
    `insert into public.vehicles (owner_id, registration_no, model_id, year)
     values ($1, 'TN09AB1234', $2, 2019) returning id`,
    [customer, carModel.rows[0].id],
  );
  const bike = await db.query<{ id: string }>(
    `insert into public.vehicles (owner_id, registration_no, model_id, year)
     values ($1, 'TN10CD5678', $2, 2021) returning id`,
    [customer, bikeModel.rows[0].id],
  );
  return {
    db, customer, other, mechanic, otherMechanic, admin,
    workshop: ws.rows[0].id,
    service: svc.rows[0].id,
    vehicle: car.rows[0].id,
    bikeVehicle: bike.rows[0].id,
  };
}

async function newBooking(w: World, vehicle = w.vehicle): Promise<string> {
  const r = await w.db.query<{ id: string }>(
    `select id from public.create_booking($1, $2, $3, 'workshop', 13.09, 80.21, null, 'grinding noise',
                                          2950, 3500, 180)`,
    [w.customer, vehicle, w.service],
  );
  return r.rows[0].id;
}

const status = async (db: PGlite, id: string) =>
  (await db.query<{ status: string }>('select status from public.bookings where id = $1', [id]))
    .rows[0].status;

const move = (w: World, id: string, to: string, actor: string | null, role: string) =>
  w.db.query('select * from public.transition_booking($1, $2, $3, $4)', [id, to, actor, role]);

/** put a booking in an assigned workshop's hands at the offered stage */
async function offer(w: World, id: string) {
  await w.db.query('update public.bookings set workshop_id = $2 where id = $1', [id, w.workshop]);
  await move(w, id, 'offered', null, 'system');
}

describe('booking lifecycle', () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld(1);
  });
  afterAll(async () => {
    await w.db.close();
  });

  it('creates a booking in matching and logs the events', async () => {
    const id = await newBooking(w);
    expect(await status(w.db, id)).toBe('matching');
    const ev = await w.db.query<{ to_status: string }>(
      'select to_status from public.booking_events where booking_id = $1 order by id',
      [id],
    );
    expect(ev.rows.map((r) => r.to_status)).toEqual(['requested', 'matching']);
  });

  it('walks a booking from request to review', async () => {
    const id = await newBooking(w);
    await offer(w, id);
    await move(w, id, 'accepted', w.mechanic, 'mechanic');
    await move(w, id, 'in_progress', w.mechanic, 'mechanic');
    await w.db.query('select * from public.complete_booking($1, $2, $3, $4, $5)', [
      id, w.mechanic, 'mechanic', 2000, 500,
    ]);
    const done = await w.db.query<{ final_price: string; needs_price_approval: boolean }>(
      'select final_price, needs_price_approval from public.bookings where id = $1',
      [id],
    );
    expect(Number(done.rows[0].final_price)).toBe(2950); // (2000 + 500) * 1.18
    expect(done.rows[0].needs_price_approval).toBe(false);

    await move(w, id, 'paid', null, 'system');
    await w.db.query('select * from public.submit_review($1, $2, 5, $3)', [id, w.customer, 'great']);
    expect(await status(w.db, id)).toBe('reviewed');

    const shop = await w.db.query<{ rating_sum: number; rating_count: number }>(
      'select rating_sum, rating_count from public.workshops where id = $1',
      [w.workshop],
    );
    expect(shop.rows[0]).toEqual({ rating_sum: 5, rating_count: 1 });

    const ob = await w.db.query<{ n: string }>(
      `select count(*)::text n from public.outbox where payload ->> 'booking_id' = $1`,
      [id],
    );
    expect(Number(ob.rows[0].n)).toBeGreaterThanOrEqual(6);
  });

  it('refuses a second accept when the workshop has no free staff', async () => {
    const first = await newBooking(w);
    await offer(w, first);
    await move(w, first, 'accepted', w.mechanic, 'mechanic');

    const second = await newBooking(w);
    await offer(w, second);
    await expect(move(w, second, 'accepted', w.mechanic, 'mechanic')).rejects.toThrow(/at capacity/);
    expect(await status(w.db, second)).toBe('offered');
    await move(w, first, 'cancelled', w.admin, 'admin');
    await move(w, second, 'cancelled', w.admin, 'admin');
  });

  it("does not let a customer move someone else's booking", async () => {
    const id = await newBooking(w);
    await expect(move(w, id, 'cancelled', w.other, 'customer')).rejects.toThrow(/not your booking/);
    await move(w, id, 'cancelled', w.customer, 'customer');
    expect(await status(w.db, id)).toBe('cancelled');
  });

  it("does not let a mechanic act on another workshop's job", async () => {
    const id = await newBooking(w);
    await offer(w, id);
    await expect(move(w, id, 'accepted', w.otherMechanic, 'mechanic')).rejects.toThrow(
      /not your workshop/,
    );
    await move(w, id, 'cancelled', w.admin, 'admin');
  });

  it('does not let a customer start a job', async () => {
    const id = await newBooking(w);
    await offer(w, id);
    await move(w, id, 'accepted', w.mechanic, 'mechanic');
    await expect(move(w, id, 'in_progress', w.customer, 'customer')).rejects.toThrow(
      /cannot move a booking/,
    );
    await move(w, id, 'cancelled', w.customer, 'customer');
  });

  it('holds payment until the customer approves a price far above the quote', async () => {
    const id = await newBooking(w);
    await offer(w, id);
    await move(w, id, 'accepted', w.mechanic, 'mechanic');
    await move(w, id, 'in_progress', w.mechanic, 'mechanic');
    // quote_high is 3500; 4500 + GST is well over 3500 * 1.15
    await w.db.query('select * from public.complete_booking($1, $2, $3, $4, $5)', [
      id, w.mechanic, 'mechanic', 4000, 500,
    ]);
    await expect(move(w, id, 'paid', null, 'system')).rejects.toThrow(/approve the final price/);
    await expect(
      w.db.query('select * from public.approve_price($1, $2)', [id, w.other]),
    ).rejects.toThrow(/nothing to approve/);
    await w.db.query('select * from public.approve_price($1, $2)', [id, w.customer]);
    await move(w, id, 'paid', null, 'system');
    expect(await status(w.db, id)).toBe('paid');
  });

  it('only lets a paid booking be reviewed', async () => {
    const id = await newBooking(w);
    await expect(
      w.db.query('select * from public.submit_review($1, $2, 4, null)', [id, w.customer]),
    ).rejects.toThrow(/only a paid booking/);
    await move(w, id, 'cancelled', w.customer, 'customer');
  });

  it('rejects a car service booked for a bike', async () => {
    await expect(newBooking(w, w.bikeVehicle)).rejects.toThrow(/cannot be booked for a bike/);
  });

  it("rejects booking someone else's vehicle", async () => {
    await expect(
      w.db.query(
        `select * from public.create_booking($1, $2, $3, 'workshop', 13, 80, null, null, 1, 2, 60)`,
        [w.other, w.vehicle, w.service],
      ),
    ).rejects.toThrow(/vehicle not found/);
  });
});

describe('transition table', () => {
  let w: World;
  let id: string;
  beforeAll(async () => {
    w = await buildWorld(5);
    id = await newBooking(w);
    // a fully prepared row so only the transition rules decide the outcome
    await w.db.query(
      `update public.bookings set workshop_id = $2, labour_amount = 2000, parts_amount = 500,
              final_price = 2950, completed_at = now() where id = $1`,
      [id, w.workshop],
    );
  });
  afterAll(async () => {
    await w.db.close();
  });

  const actorFor = (role: string) =>
    role === 'customer' ? w.customer : role === 'mechanic' ? w.mechanic : role === 'admin' ? w.admin : null;

  it('accepts every legal move and refuses every other pair', async () => {
    const legal = (
      await w.db.query<{ from_status: string; to_status: string; actors: string[] }>(
        'select from_status, to_status, actors from public.booking_transitions',
      )
    ).rows;
    const legalSet = new Set(legal.map((l) => `${l.from_status}>${l.to_status}`));
    expect(legal.length).toBe(26);

    for (const from of STATUSES) {
      for (const to of STATUSES) {
        await w.db.query(
          `update public.bookings set status = $2, workshop_id = $3 where id = $1`,
          [id, from, w.workshop],
        );
        const key = `${from}>${to}`;
        if (legalSet.has(key)) {
          const actors = legal.find((l) => `${l.from_status}>${l.to_status}` === key)!.actors;
          const role = actors[0];
          await move(w, id, to, actorFor(role), role);
          expect(await status(w.db, id)).toBe(to);
        } else {
          await expect(move(w, id, to, w.admin, 'admin')).rejects.toThrow(/illegal transition/);
          expect(await status(w.db, id)).toBe(from);
        }
      }
    }
  });
});

describe('row level security on bookings', () => {
  let w: World;
  let id: string;
  beforeAll(async () => {
    w = await buildWorld(2);
    id = await newBooking(w);
    await offer(w, id);
  });
  afterAll(async () => {
    await w.db.close();
  });

  const visible = (user: string) =>
    asUser(w.db, user, async () => {
      const r = await w.db.query<{ id: string }>('select id from public.bookings');
      return r.rows.map((x) => x.id);
    });

  it('shows a customer only their own bookings', async () => {
    expect(await visible(w.customer)).toEqual([id]);
    expect(await visible(w.other)).toEqual([]);
  });

  it('shows a mechanic only bookings of their workshop', async () => {
    expect(await visible(w.mechanic)).toEqual([id]);
    expect(await visible(w.otherMechanic)).toEqual([]);
  });

  it('shows an admin everything', async () => {
    expect(await visible(w.admin)).toEqual([id]);
  });

  it('blocks clients from writing bookings directly', async () => {
    await expect(
      asUser(w.db, w.customer, async () => {
        await w.db.query(`update public.bookings set final_price = 1 where id = $1`, [id]);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('blocks clients from calling the write functions', async () => {
    await expect(
      asUser(w.db, w.customer, async () => {
        await w.db.query(`select * from public.transition_booking($1, 'cancelled', $2, 'customer')`, [
          id, w.customer,
        ]);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('stops a workshop owner editing their own rating', async () => {
    await expect(
      asUser(w.db, w.mechanic, async () => {
        await w.db.query(`update public.workshops set rating_sum = 500, rating_count = 100 where id = $1`, [
          w.workshop,
        ]);
      }),
    ).rejects.toThrow(/cannot be edited directly/);
  });
});

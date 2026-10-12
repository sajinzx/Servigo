import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Role } from '../src/auth/types';
import type { BookingRow, BookingStore, CreateBookingArgs } from '../src/routes/bookings';

const SECRET = 'test-secret-that-is-long-enough';
const VEHICLE = '11111111-1111-4111-8111-111111111111';
const SERVICE = '22222222-2222-4222-8222-222222222222';
const ADDRESS = '33333333-3333-4333-8333-333333333333';
const B1 = '44444444-4444-4444-8444-444444444444';

const roles: Record<string, Role> = { cust: 'customer', mech: 'mechanic', adm: 'admin' };
const token = (sub: string) =>
  jwt.sign({ sub, aud: 'authenticated' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const bearer = (sub: string) => ({ Authorization: `Bearer ${token(sub)}` });

function setup() {
  const created: CreateBookingArgs[] = [];
  const calls: string[] = [];
  const dispatched: string[] = [];
  const row = (over: Partial<BookingRow> = {}): BookingRow => ({
    id: B1, ref: 'BK-10001', status: 'matching', customer_id: 'cust', workshop_id: null,
    quote_low: 0, quote_high: 0, final_price: null, needs_price_approval: false, ...over,
  });
  const store: BookingStore = {
    async quoteContext() {
      return { basePrice: 2500, segmentFactor: 1.35, baseDurationMin: 180 };
    },
    async addressPoint(_u, id) {
      return id === ADDRESS ? { lat: 13.085, lng: 80.21 } : null;
    },
    async create(args) {
      created.push(args);
      return row({ quote_low: args.quoteLow, quote_high: args.quoteHigh });
    },
    async transition(id, to, actor, role) {
      calls.push(`${to}:${actor}:${role}`);
      return row({ id, status: to });
    },
    async complete(id, actor, role, labour, parts) {
      calls.push(`complete:${actor}:${role}:${labour}:${parts}`);
      return row({ id, status: 'completed' });
    },
    async approvePrice(id) {
      calls.push(`approve:${id}`);
      return row({ id });
    },
    async review(id, _c, rating) {
      calls.push(`review:${id}:${rating}`);
    },
  };
  const app = createApp(loadConfig({ NODE_ENV: 'test' }), {
    auth: { jwtSecret: SECRET, lookupRole: async (id) => roles[id] ?? null },
    profiles: { get: async () => null, update: async () => { throw new Error('unused'); } },
    bookings: store,
    dispatch: async (id) => {
      dispatched.push(id);
    },
  });
  return { app, created, calls, dispatched };
}

describe('POST /api/bookings', () => {
  it('prices the booking on the server and starts allocation', async () => {
    const { app, created, dispatched } = setup();
    const res = await request(app)
      .post('/api/bookings')
      .set(bearer('cust'))
      .send({ vehicle_id: VEHICLE, service_id: SERVICE, address_id: ADDRESS });
    expect(res.status).toBe(201);
    expect(created[0].quoteLow).toBeGreaterThan(0);
    expect(created[0].quoteHigh).toBeGreaterThan(created[0].quoteLow);
    expect(created[0].lat).toBe(13.085);
    expect(dispatched).toEqual([B1]);
  });

  it('rejects a price sent by the client', async () => {
    const { app, created } = setup();
    const res = await request(app)
      .post('/api/bookings')
      .set(bearer('cust'))
      .send({ vehicle_id: VEHICLE, service_id: SERVICE, address_id: ADDRESS, price: 1 });
    expect(res.status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it('needs a location', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/bookings')
      .set(bearer('cust'))
      .send({ vehicle_id: VEHICLE, service_id: SERVICE });
    expect(res.status).toBe(400);
  });

  it('is for customers only', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/bookings')
      .set(bearer('mech'))
      .send({ vehicle_id: VEHICLE, service_id: SERVICE, address_id: ADDRESS });
    expect(res.status).toBe(403);
  });

  it('requires sign-in', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/bookings').send({});
    expect(res.status).toBe(401);
  });
});

describe('status routes', () => {
  it('lets a mechanic start and complete a job', async () => {
    const { app, calls } = setup();
    await request(app).post(`/api/bookings/${B1}/start`).set(bearer('mech')).expect(200);
    await request(app)
      .post(`/api/bookings/${B1}/complete`)
      .set(bearer('mech'))
      .send({ labour_amount: 2000, parts_amount: 500 })
      .expect(200);
    expect(calls).toEqual(['in_progress:mech:mechanic', 'complete:mech:mechanic:2000:500']);
  });

  it('stops a customer from starting or completing a job', async () => {
    const { app } = setup();
    await request(app).post(`/api/bookings/${B1}/start`).set(bearer('cust')).expect(403);
    await request(app)
      .post(`/api/bookings/${B1}/complete`)
      .set(bearer('cust'))
      .send({ labour_amount: 1 })
      .expect(403);
  });

  it('validates the final amounts', async () => {
    const { app } = setup();
    await request(app)
      .post(`/api/bookings/${B1}/complete`)
      .set(bearer('mech'))
      .send({ labour_amount: -5 })
      .expect(400);
  });

  it('records a review with a bounded rating', async () => {
    const { app, calls } = setup();
    await request(app).post(`/api/bookings/${B1}/review`).set(bearer('cust')).send({ rating: 6 }).expect(400);
    await request(app).post(`/api/bookings/${B1}/review`).set(bearer('cust')).send({ rating: 5 }).expect(201);
    expect(calls).toContain(`review:${B1}:5`);
  });
});

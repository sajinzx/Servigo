import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import path from 'path';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Role } from '../src/auth/types';
import { baselineQuoter, mlQuoter, type QuoteContext } from '../src/domain/quoter';
import { keywordTriage, SERVICE_CATEGORY } from '../src/domain/triageBaseline';
import { MlClient } from '../src/ml/client';
import type { BookingStore } from '../src/routes/bookings';

const ctx: QuoteContext = {
  serviceCode: 'CAR_001',
  segment: 'suv',
  basePrice: 2500,
  segmentFactor: 1.35,
  baseDurationMin: 180,
  vehicleAge: 6,
  kmSinceService: 7000,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('MlClient', () => {
  it('returns null and reports a timeout instead of hanging', async () => {
    const reasons: string[] = [];
    const never = ((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as unknown as typeof fetch;
    const ml = new MlClient({
      baseUrl: 'http://ml', fetchImpl: never, timeoutMs: 30, onFallback: (_p, r) => reasons.push(r),
    });
    const t0 = Date.now();
    expect(await ml.price({ service_code: 'CAR_001', segment: 'suv', vehicle_age: 1, km_since_service: 1 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(reasons).toEqual(['timeout']);
  });

  it('returns null for an error status or a network failure', async () => {
    const down = new MlClient({ baseUrl: 'http://ml', fetchImpl: (async () => json({}, 500)) as unknown as typeof fetch });
    expect(await down.triage('brake noise', 'car')).toBeNull();
    const dead = new MlClient({
      baseUrl: 'http://ml',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    expect(await dead.acceptance([])).toBeNull();
  });

  it('is disabled without a base url and never calls out', async () => {
    let called = false;
    const ml = new MlClient({ fetchImpl: (async () => ((called = true), json({}))) as unknown as typeof fetch });
    expect(ml.enabled).toBe(false);
    expect(await ml.weights()).toBeNull();
    expect(called).toBe(false);
  });

  it('sends the api key and parses a triage answer', async () => {
    let headers: Record<string, string> = {};
    const f = (async (_u: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return json({ suggestions: [{ code: 'CAR_003', name: 'Car Brake Inspection', probability: 0.99 }] });
    }) as unknown as typeof fetch;
    const ml = new MlClient({ baseUrl: 'http://ml', apiKey: 'k', fetchImpl: f });
    const r = await ml.triage('grinding noise when braking', 'car');
    expect(r?.[0].code).toBe('CAR_003');
    expect(headers['X-ML-Key']).toBe('k');
  });
});

describe('quoter', () => {
  const answer = (price: unknown, duration: unknown) =>
    (async (url: string) => json(url.includes('price') ? price : duration)) as unknown as typeof fetch;

  it('uses the models when they answer sensibly', async () => {
    const ml = new MlClient({
      baseUrl: 'http://ml',
      fetchImpl: answer(
        { low: 3000, median: 3500, high: 4300, why: [], model_version: 'p1' },
        { minutes: 190, low: 150, high: 250, why: [], model_version: 'd1' },
      ),
    });
    const q = await mlQuoter(ml).quote(ctx);
    expect(q).toMatchObject({ low: 3000, expected: 3500, high: 4300, durationMin: 190 });
    expect(q.source).toEqual({ price: 'ml', duration: 'ml' });
  });

  it('keeps the baseline when the service only answers with its own fallback', async () => {
    const ml = new MlClient({
      baseUrl: 'http://ml',
      fetchImpl: answer(
        { low: 1, median: 2, high: 3, why: [], model_version: 'baseline' },
        { minutes: 5, low: 1, high: 9, why: [], model_version: 'baseline' },
      ),
    });
    const q = await mlQuoter(ml).quote(ctx);
    expect(q.source).toEqual({ price: 'baseline', duration: 'baseline' });
    expect(q.expected).toBe((await baselineQuoter.quote(ctx)).expected);
  });

  it('rejects a nonsensical band', async () => {
    const ml = new MlClient({
      baseUrl: 'http://ml',
      fetchImpl: answer(
        { low: 5000, median: 3000, high: 2000, why: [], model_version: 'p1' },
        { minutes: -4, low: 0, high: 0, why: [], model_version: 'd1' },
      ),
    });
    const q = await mlQuoter(ml).quote(ctx);
    expect(q.source).toEqual({ price: 'baseline', duration: 'baseline' });
    expect(q.low).toBeLessThan(q.high);
  });

  it('works when the service is unreachable', async () => {
    const ml = new MlClient({ baseUrl: 'http://ml', fetchImpl: (async () => json({}, 503)) as unknown as typeof fetch });
    const q = await mlQuoter(ml).quote(ctx);
    expect(q.source).toEqual({ price: 'baseline', duration: 'baseline' });
    expect(q.expected).toBe(3982.5);
  });
});

describe('triage baseline', () => {
  it('knows the same 20 services as the seed', () => {
    const seed = readFileSync(path.resolve(__dirname, '../../../supabase/seed.sql'), 'utf8');
    const codes = [...seed.matchAll(/\('((?:CAR|BIKE)_\d+)','[^']+','(car|bike)','([a-z]+)'/g)];
    expect(codes).toHaveLength(20);
    for (const [, code, kind, category] of codes) {
      expect(SERVICE_CATEGORY[code]).toMatchObject({ kind, category });
    }
  });

  it('ranks by keyword and stays within the vehicle kind', () => {
    const r = keywordTriage('grinding noise when braking', 'bike');
    expect(r[0].code).toBe('BIKE_003');
    expect(r.every((x) => x.code.startsWith('BIKE_'))).toBe(true);
    expect(keywordTriage('ac is not cooling', 'car')[0].code).toBe('CAR_005');
    expect(keywordTriage('anything', 'car')).toHaveLength(3);
  });
});

describe('quote and triage routes', () => {
  const SECRET = 'test-secret-that-is-long-enough';
  const roles: Record<string, Role> = { cust: 'customer' };
  const bearer = {
    Authorization: `Bearer ${jwt.sign({ sub: 'cust', aud: 'authenticated' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })}`,
  };
  const V = '11111111-1111-4111-8111-111111111111';
  const S = '22222222-2222-4222-8222-222222222222';

  function appWith(ml: MlClient | undefined) {
    const store = {
      quoteContext: async () => ctx,
      vehicleDue: async (id: string) =>
        id === V ? { kind: 'car', ageYears: 5, kmPerDay: 30, daysSinceService: 100 } : null,
    } as unknown as BookingStore;
    return createApp(loadConfig({ NODE_ENV: 'test' }), {
      auth: { jwtSecret: SECRET, lookupRole: async (id) => roles[id] ?? null },
      profiles: { get: async () => null, update: async () => { throw new Error('unused'); } },
      bookings: store,
      ml,
    });
  }

  it('shows a GST-inclusive range and a time estimate from the baseline when ML is off', async () => {
    const res = await request(appWith(undefined)).get(`/api/quote?vehicle_id=${V}&service_id=${S}`).set(bearer);
    expect(res.status).toBe(200);
    expect(res.body.price).toMatchObject({ expected: 3982.5, gst_inclusive: true });
    expect(res.body.price.low).toBeLessThan(res.body.price.high);
    expect(res.body.duration.minutes).toBe(180);
    expect(res.body.source).toEqual({ price: 'baseline', duration: 'baseline' });
  });

  it('triages with the model when it answers, and with keywords when it does not', async () => {
    const good = new MlClient({
      baseUrl: 'http://ml',
      fetchImpl: (async () => json({ suggestions: [{ code: 'CAR_005', name: 'Car AC Service', probability: 0.9 }] })) as unknown as typeof fetch,
    });
    const a = await request(appWith(good)).post('/api/triage').set(bearer).send({ text: 'ac not cooling', vehicle_kind: 'car' });
    expect(a.body.source).toBe('ml');

    const bad = new MlClient({ baseUrl: 'http://ml', fetchImpl: (async () => json({}, 500)) as unknown as typeof fetch });
    const b = await request(appWith(bad)).post('/api/triage').set(bearer).send({ text: 'ac not cooling', vehicle_kind: 'car' });
    expect(b.body.source).toBe('baseline');
    expect(b.body.suggestions[0].code).toBe('CAR_005');
  });

  it('estimates the next service from the fixed rule when ML is off', async () => {
    // 30 km/day -> 5000 km in ~167 days; 100 days since the last service -> ~67 days left
    const res = await request(appWith(undefined)).get(`/api/vehicles/${V}/service-due`).set(bearer);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('baseline');
    expect(res.body.days_left).toBeCloseTo(66.7, 0);
  });

  it('does not reveal a vehicle that is not the caller's', async () => {
    const other = '99999999-9999-4999-8999-999999999999';
    const res = await request(appWith(undefined)).get(`/api/vehicles/${other}/service-due`).set(bearer);
    expect(res.status).toBe(404);
  });

  it('needs sign-in', async () => {
    await request(appWith(undefined)).post('/api/triage').send({ text: 'x', vehicle_kind: 'car' }).expect(401);
  });
});

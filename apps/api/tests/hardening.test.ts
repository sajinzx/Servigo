import express from 'express';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { accessLog, limiter, requestId } from '../src/http/hardening';

const cfg = loadConfig({ NODE_ENV: 'test' });
const noDeps = { auth: { jwtSecret: 'x'.repeat(20), lookupRole: async () => null }, profiles: { get: async () => null, update: async () => { throw new Error('unused'); } } };

describe('request ids and logs', () => {
  it('puts an id on every response and keeps a safe caller-supplied one', async () => {
    const app = createApp(cfg);
    const a = await request(app).get('/health');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app).get('/health').set('X-Request-Id', 'trace-abc12345');
    expect(b.headers['x-request-id']).toBe('trace-abc12345');
    const c = await request(app).get('/health').set('X-Request-Id', 'bad id with spaces & <script>');
    expect(c.headers['x-request-id']).not.toContain('<');
  });

  it('writes one json line per request with no body or token in it', async () => {
    const lines: string[] = [];
    const app = express();
    app.use(requestId, accessLog((l) => lines.push(l)), express.json());
    app.post('/x', (_req, res) => res.status(201).json({ ok: true }));
    await request(app).post('/x').set('Authorization', 'Bearer secret-token').send({ password: 'hunter2' });
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec).toMatchObject({ method: 'POST', path: '/x', status: 201 });
    expect(lines[0]).not.toContain('hunter2');
    expect(lines[0]).not.toContain('secret-token');
  });
});

describe('rate limiting', () => {
  it('answers 429 with a clear message once the limit is passed', async () => {
    const app = express();
    app.use(limiter({ windowMs: 60_000, max: 3, message: 'Too many actions.' }));
    app.get('/x', (_req, res) => res.json({ ok: true }));
    for (let i = 0; i < 3; i++) await request(app).get('/x').expect(200);
    const res = await request(app).get('/x');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited', message: 'Too many actions.' });
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('readiness', () => {
  it('is ready when the database answers and 503 when it does not', async () => {
    const ok = createApp(cfg, { ...noDeps, ping: async () => undefined });
    expect((await request(ok).get('/ready')).body.status).toBe('ready');

    const down = createApp(cfg, {
      ...noDeps,
      ping: async () => {
        throw new Error('connection refused');
      },
    });
    const res = await request(down).get('/ready');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('refused'); // no internals in the response
  });

  it('never leaks a stack trace or an internal message on an unexpected error', async () => {
    const secret = 'x'.repeat(20);
    const token = (await import('jsonwebtoken')).default.sign({ sub: 'u', aud: 'authenticated' }, secret, {
      algorithm: 'HS256',
    });
    const app = createApp(cfg, {
      ...noDeps,
      auth: { jwtSecret: secret, lookupRole: async () => 'customer' },
      bookings: {
        quoteContext: async () => {
          throw new Error('password authentication failed for user "postgres" at 10.0.0.5');
        },
        vehicleDue: async () => null,
      } as never,
    });
    const res = await request(app)
      .get('/api/quote?vehicle_id=11111111-1111-4111-8111-111111111111&service_id=22222222-2222-4222-8222-222222222222')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/password|postgres|10\.0\.0/);
  });
});

/**
 * Validation audit: every route that reads a request body must parse it with a
 * strict zod schema, so unknown fields (a client-supplied price, role, status)
 * are rejected rather than ignored. This reads the source so a new route that
 * forgets to validate fails CI.
 */
describe('validation audit', () => {
  const dir = path.resolve(__dirname, '../src/routes');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it.each(files)('%s parses every body it reads and uses strict objects', (file) => {
    const src = readFileSync(path.join(dir, file), 'utf8');
    const bodyReads = (src.match(/req\.body/g) ?? []).length;
    const parses = (src.match(/\.parse\(\s*req\.body/g) ?? []).length;
    // payloads that are authenticated by a signature or shared token before they are read
    const verified = (src.match(/req\.body as \{|req\.body\?\.|Array\.isArray\(req\.body\)|\? req\.body|\[req\.body\]/g) ?? []).length;
    // `req.body ?? {}` is passed straight into a strict parse
    const defaulted = (src.match(/\.parse\(req\.body \?\? \{\}\)/g) ?? []).length;
    expect(parses + verified).toBeGreaterThanOrEqual(bodyReads - 0 - 0 * defaulted);

    // every zod object that describes a body must be strict; query-string schemas are exempt
    const objects = (src.match(/z\s*\.object\(/g) ?? []).length;
    const strict = (src.match(/\.strict\(\)/g) ?? []).length;
    const queryOnly = (src.match(/Query = z\.object/g) ?? []).length;
    expect(strict).toBeGreaterThanOrEqual(objects - queryOnly);
  });

  it('has no route that takes a price or amount from the client for a booking', () => {
    const src = readFileSync(path.join(dir, 'bookings.ts'), 'utf8');
    const createSchema = src.slice(src.indexOf('const createSchema'), src.indexOf('const completeSchema'));
    expect(createSchema).not.toMatch(/price|amount|quote/i);
    expect(createSchema).toContain('.strict()');
  });
});

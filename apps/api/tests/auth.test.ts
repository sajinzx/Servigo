import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { authenticate, requireRole } from '../src/auth/middleware';
import { errorHandler } from '../src/http/errors';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import type { Role } from '../src/auth/types';

const SECRET = 'test-secret-that-is-long-enough';
const roles: Record<string, Role> = { cust: 'customer', mech: 'mechanic', adm: 'admin' };

function appWith(secret: string | undefined = SECRET) {
  const app = express();
  const auth = authenticate({ jwtSecret: secret, lookupRole: async (id) => roles[id] ?? null });
  app.get('/me', auth, (req, res) => res.json(req.user));
  app.get('/admin/stats', auth, requireRole('admin'), (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

const token = (sub: string, opts: jwt.SignOptions = {}, secret = SECRET) =>
  jwt.sign({ sub, aud: 'authenticated', role: 'authenticated' }, secret, {
    algorithm: 'HS256',
    expiresIn: '1h',
    ...opts,
  });

describe('authenticate', () => {
  it('rejects requests with no token', async () => {
    const res = await request(appWith()).get('/me');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = token('adm', {}, 'your_jwt_secret_key_padding');
    const res = await request(appWith()).get('/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const old = token('cust', { expiresIn: -10 });
    const res = await request(appWith()).get('/me').set('Authorization', `Bearer ${old}`);
    expect(res.status).toBe(401);
  });

  it('rejects an unsigned (alg none) token', async () => {
    const none = jwt.sign({ sub: 'adm', aud: 'authenticated' }, '', { algorithm: 'none' });
    const res = await request(appWith()).get('/me').set('Authorization', `Bearer ${none}`);
    expect(res.status).toBe(401);
  });

  it('attaches the user and the role from the profile', async () => {
    const res = await request(appWith()).get('/me').set('Authorization', `Bearer ${token('cust')}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'cust', role: 'customer' });
  });

  it('refuses users with no profile', async () => {
    const res = await request(appWith()).get('/me').set('Authorization', `Bearer ${token('ghost')}`);
    expect(res.status).toBe(403);
  });

  it('fails closed when the secret is not configured', async () => {
    const res = await request(appWith('')).get('/me').set('Authorization', `Bearer ${token('cust')}`);
    expect(res.status).toBe(500);
  });
});

describe('requireRole', () => {
  it('blocks non-admins from admin routes', async () => {
    const res = await request(appWith())
      .get('/admin/stats')
      .set('Authorization', `Bearer ${token('cust')}`);
    expect(res.status).toBe(403);
  });

  it('lets admins through', async () => {
    const res = await request(appWith())
      .get('/admin/stats')
      .set('Authorization', `Bearer ${token('adm')}`);
    expect(res.status).toBe(200);
  });
});

describe('asymmetric (JWKS) tokens', () => {
  async function setup() {
    const good = await generateKeyPair('ES256');
    const other = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(good.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
    const jwks = createLocalJWKSet({ keys: [jwk] });
    const app = express();
    const auth = authenticate({ jwks, lookupRole: async (id) => roles[id] ?? null });
    app.get('/me', auth, (req, res) => res.json(req.user));
    app.use(errorHandler);
    const sign = (key: KeyLike, sub: string, exp = '1h', kid = 'k1') =>
      new SignJWT({ role: 'authenticated' })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setSubject(sub)
        .setAudience('authenticated')
        .setExpirationTime(exp)
        .sign(key);
    return { app, sign, good: good.privateKey, other: other.privateKey };
  }

  it('accepts a token signed by a key in the set', async () => {
    const { app, sign, good } = await setup();
    const res = await request(app).get('/me').set('Authorization', `Bearer ${await sign(good, 'cust')}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'cust', role: 'customer' });
  });

  it('rejects a token signed by some other key', async () => {
    const { app, sign, other } = await setup();
    const res = await request(app).get('/me').set('Authorization', `Bearer ${await sign(other, 'adm')}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { app, sign, good } = await setup();
    const res = await request(app).get('/me').set('Authorization', `Bearer ${await sign(good, 'cust', '-1m')}`);
    expect(res.status).toBe(401);
  });

  it('does not accept an HS256 token when only a key set is configured', async () => {
    const { app } = await setup();
    const forged = jwt.sign({ sub: 'adm', aud: 'authenticated' }, 'x'.repeat(32), { algorithm: 'HS256' });
    const res = await request(app).get('/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});

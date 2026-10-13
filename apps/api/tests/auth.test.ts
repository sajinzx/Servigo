import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { authenticate, requireRole } from '../src/auth/middleware';
import { errorHandler } from '../src/http/errors';
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

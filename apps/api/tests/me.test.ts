import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Profile, ProfileRepo } from '../src/routes/me';

const SECRET = 'test-secret-that-is-long-enough';
const token = (sub: string) =>
  jwt.sign({ sub, aud: 'authenticated' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });

function setup() {
  const rows = new Map<string, Profile>([
    [
      'u1',
      {
        id: 'u1',
        role: 'customer',
        full_name: 'Asha',
        phone: null,
        phone_verified: false,
        whatsapp_opt_in: false,
        onboarded_at: null,
      },
    ],
  ]);
  const profiles: ProfileRepo = {
    async get(id) {
      return rows.get(id) ?? null;
    },
    async update(id, patch) {
      const next = { ...rows.get(id)!, ...patch };
      rows.set(id, next);
      return next;
    },
  };
  const app = createApp(loadConfig({ NODE_ENV: 'test' }), {
    auth: { jwtSecret: SECRET, lookupRole: async (id) => rows.get(id)?.role ?? null },
    profiles,
  });
  return { app, rows };
}

describe('/api/me', () => {
  it('requires a token', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/me')).status).toBe(401);
  });

  it('returns the caller profile', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token('u1')}`);
    expect(res.status).toBe(200);
    expect(res.body.full_name).toBe('Asha');
  });

  it('updates allowed fields', async () => {
    const { app } = setup();
    const res = await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${token('u1')}`)
      .send({ full_name: 'Asha K', whatsapp_opt_in: true });
    expect(res.status).toBe(200);
    expect(res.body.whatsapp_opt_in).toBe(true);
  });

  it('refuses to set the role through the api', async () => {
    const { app, rows } = setup();
    const res = await request(app)
      .patch('/api/me')
      .set('Authorization', `Bearer ${token('u1')}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(400);
    expect(rows.get('u1')!.role).toBe('customer');
  });

  it('refuses to set the phone or verification flags through the api', async () => {
    const { app, rows } = setup();
    for (const body of [{ phone: '+919840012345' }, { phone_verified: true }, { onboarded_at: '2026-01-01' }]) {
      const res = await request(app).patch('/api/me').set('Authorization', `Bearer ${token('u1')}`).send(body);
      expect(res.status).toBe(400);
    }
    expect(rows.get('u1')!.phone_verified).toBe(false);
  });
});

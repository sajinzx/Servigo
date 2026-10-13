import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Role } from '../src/auth/types';
import type { Rpc } from '../src/db/rpc';
import { decrypt, parseKey } from '../src/domain/secrets';

const SECRET = 'test-secret-that-is-long-enough';
const KEY = Buffer.alloc(32, 5);
const roles: Record<string, Role> = { cust: 'customer', mech: 'mechanic', adm: 'admin' };
const bearer = (sub: string) => ({
  Authorization: `Bearer ${jwt.sign({ sub, aud: 'authenticated' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })}`,
});

const ID = '55555555-5555-4555-8555-555555555555';

function setup() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const dupes: unknown[] = [];
  const rpc: Rpc = {
    async one(fn, args = {}) {
      calls.push({ fn, args });
      return { id: ID } as never;
    },
    async many(fn, args = {}) {
      calls.push({ fn, args });
      return (fn === 'find_duplicate_applicants' ? dupes : []) as never;
    },
    async insert(table, row) {
      inserts.push({ table, row });
    },
  };
  const app = createApp(loadConfig({ NODE_ENV: 'test' }), {
    auth: { jwtSecret: SECRET, lookupRole: async (id) => roles[id] ?? null },
    profiles: { get: async () => null, update: async () => { throw new Error('unused'); } },
    rpc,
    payoutKey: KEY,
  });
  return { app, calls, inserts, dupes };
}

describe('admin routes', () => {
  it('are closed to everyone but admins', async () => {
    const { app } = setup();
    await request(app).get('/api/admin/review-queue').expect(401);
    await request(app).get('/api/admin/review-queue').set(bearer('cust')).expect(403);
    await request(app).post(`/api/admin/applications/${ID}/approve`).set(bearer('mech')).expect(403);
    await request(app).get('/api/admin/review-queue').set(bearer('adm')).expect(200);
  });

  it('approves an application as the signed-in admin', async () => {
    const { app, calls } = setup();
    await request(app).post(`/api/admin/applications/${ID}/approve`).set(bearer('adm')).expect(200);
    expect(calls[0]).toEqual({ fn: 'approve_application', args: { p_application: ID, p_admin: 'adm' } });
  });

  it('requires a reason to reject', async () => {
    const { app, calls } = setup();
    await request(app).post(`/api/admin/applications/${ID}/reject`).set(bearer('adm')).send({}).expect(400);
    await request(app)
      .post(`/api/admin/applications/${ID}/reject`)
      .set(bearer('adm'))
      .send({ reason: 'photos do not match the pin' })
      .expect(200);
    expect(calls[0].fn).toBe('reject_application');
  });

  it('validates dispute outcomes', async () => {
    const { app } = setup();
    await request(app)
      .post(`/api/admin/disputes/${ID}/resolve`)
      .set(bearer('adm'))
      .send({ outcome: 'maybe', resolution: 'unsure' })
      .expect(400);
    await request(app)
      .post(`/api/admin/disputes/${ID}/resolve`)
      .set(bearer('adm'))
      .send({ outcome: 'partial', refund_amount: 500, resolution: 'half the parts were not fitted' })
      .expect(200);
  });
});

describe('safety routes', () => {
  it('lets a customer report an incident', async () => {
    const { app, calls } = setup();
    await request(app)
      .post(`/api/bookings/${ID}/incidents`)
      .set(bearer('cust'))
      .send({ type: 'safety', description: 'brakes failed after the service' })
      .expect(201);
    expect(calls[0].fn).toBe('report_incident');
    expect(calls[0].args.p_reporter).toBe('cust');
  });

  it('only customers can open disputes and only workshops can appeal', async () => {
    const { app } = setup();
    const body = { reason: 'charged for parts that were not fitted' };
    await request(app).post(`/api/bookings/${ID}/dispute`).set(bearer('mech')).send(body).expect(403);
    await request(app).post(`/api/bookings/${ID}/dispute`).set(bearer('cust')).send(body).expect(201);
    await request(app).post(`/api/strikes/${ID}/appeal`).set(bearer('cust')).send({ text: 'unfair strike' }).expect(403);
    await request(app).post(`/api/strikes/${ID}/appeal`).set(bearer('mech')).send({ text: 'unfair strike' }).expect(200);
  });
});

describe('workshop applications', () => {
  it('creates an application for the signed-in user', async () => {
    const { app, calls } = setup();
    await request(app)
      .post('/api/applications')
      .set(bearer('cust'))
      .send({
        shop_name: 'Ravi Motors', owner_name: 'Ravi K', phone: '+919840012345', city: 'Chennai',
        lat: 13.05, lng: 80.22, service_ids: [ID], staff_count: 3,
      })
      .expect(201);
    expect(calls[0].fn).toBe('create_application');
    expect(calls[0].args.p_applicant).toBe('cust');
  });

  it('rejects a bad GSTIN before it reaches the database', async () => {
    const { app, calls } = setup();
    const res = await request(app)
      .post(`/api/applications/${ID}/documents`)
      .set(bearer('cust'))
      .send({ kind: 'gstin', number: '27AAPFU0939F1ZA' });
    expect(res.status).toBe(400);
    expect(calls.map((c) => c.fn)).toEqual(['record_kyc_check']);
    expect(calls[0].args).toMatchObject({ p_check: 'gstin_checksum', p_passed: false });
  });

  it('stores a UPI id encrypted, with only the last four visible', async () => {
    const { app, inserts, calls } = setup();
    await request(app)
      .post(`/api/applications/${ID}/documents`)
      .set(bearer('cust'))
      .send({ kind: 'upi', upi_id: 'Ravi.K@okhdfcbank' })
      .expect(201);
    expect(inserts).toHaveLength(1);
    const row = inserts[0].row;
    expect(String(row.ciphertext)).not.toContain('ravi');
    expect(decrypt(String(row.ciphertext), parseKey(KEY.toString('base64')))).toBe('ravi.k@okhdfcbank');
    expect(String(row.fingerprint)).toHaveLength(64);
    const attach = calls.find((c) => c.fn === 'attach_document')!;
    expect(String(attach.args.p_number)).toMatch(/\*{4}/);
    expect(JSON.stringify(calls)).not.toContain('ravi.k@okhdfcbank');
  });

  it('records duplicates as a non-blocking flag on submit', async () => {
    const { app, calls, dupes } = setup();
    dupes.push({ reason: 'same phone', other_application: ID });
    await request(app).post(`/api/applications/${ID}/submit`).set(bearer('cust')).expect(200);
    const check = calls.find((c) => c.fn === 'record_kyc_check')!;
    expect(check.args).toMatchObject({ p_check: 'duplicate_applicant', p_passed: false, p_blocking: false });
  });

  it('rejects unknown fields', async () => {
    const { app } = setup();
    await request(app)
      .post(`/api/applications/${ID}/documents`)
      .set(bearer('cust'))
      .send({ kind: 'owner_id', storage_path: 'docs/id.jpg', verified: true })
      .expect(400);
  });
});

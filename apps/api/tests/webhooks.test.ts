import { createHmac } from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { NotificationStore } from '../src/worker/ports';

const receipts: unknown[][] = [];
const store = {
  applyReceipt: async (...a: unknown[]) => {
    receipts.push(a);
  },
} as unknown as NotificationStore;

const app = createApp(
  loadConfig({
    NODE_ENV: 'test',
    WHATSAPP_APP_SECRET: 'app-secret',
    WHATSAPP_VERIFY_TOKEN: 'verify-me',
    SMS_WEBHOOK_TOKEN: 'sms-token',
  }),
  {
    auth: { jwtSecret: 'x'.repeat(20), lookupRole: async () => null },
    profiles: { get: async () => null, update: async () => { throw new Error('unused'); } },
    notifications: store,
  },
);

const sign = (body: string) => 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
const payload = JSON.stringify({
  entry: [{ changes: [{ value: { statuses: [
    { id: 'wamid.1', status: 'delivered' },
    { id: 'wamid.2', status: 'failed', errors: [{ title: 'Undeliverable' }] },
    { id: 'wamid.3', status: 'sent' },
  ] } }] }],
});

beforeEach(() => {
  receipts.length = 0;
});

describe('webhooks', () => {
  it('answers the whatsapp verification handshake', async () => {
    const ok = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345',
    });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('12345');
    const bad = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1',
    });
    expect(bad.status).toBe(403);
  });

  it('applies delivery receipts when the signature is valid', async () => {
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(payload))
      .send(payload);
    expect(res.status).toBe(200);
    expect(receipts).toEqual([
      ['wamid.1', 'delivered', undefined],
      ['wamid.2', 'failed', 'Undeliverable'],
    ]);
  });

  it('rejects a bad signature', async () => {
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
      .send(payload);
    expect(res.status).toBe(401);
    expect(receipts).toHaveLength(0);
  });

  it('checks the sms webhook token', async () => {
    await request(app).post('/webhooks/sms?token=wrong').send([{ request_id: 'r1', status: 'DELIVERED' }]).expect(401);
    await request(app).post('/webhooks/sms?token=sms-token').send([{ request_id: 'r1', status: 'DELIVERED' }]).expect(200);
    expect(receipts).toEqual([['r1', 'delivered', undefined]]);
  });
});

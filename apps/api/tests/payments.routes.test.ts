import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Role } from '../src/auth/types';
import type { Rpc } from '../src/db/rpc';
import { createOrder, toPaise, verifyCheckout, verifyWebhook } from '../src/domain/razorpay';
import { qrDataUrl, staticUpiString, upiLink } from '../src/domain/upi';

const SECRET = 'test-secret-that-is-long-enough';
const roles: Record<string, Role> = { cust: 'customer', mech: 'mechanic', adm: 'admin' };
const bearer = (sub: string) => ({
  Authorization: `Bearer ${jwt.sign({ sub, aud: 'authenticated' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })}`,
});
const ID = '66666666-6666-4666-8666-666666666666';
const PAYEE = { vpa: '7339498130@ptsbi', name: 'ServiGo' };

describe('upi helpers', () => {
  it('builds the intent link from the plan', () => {
    expect(upiLink(PAYEE, { amount: 2950, reference: 'BK-10423' })).toBe(
      'upi://pay?pa=7339498130@ptsbi&pn=ServiGo&am=2950.00&cu=INR&tn=ServiGo%20BK-10423&tr=BK-10423',
    );
  });

  it('refuses a bad payee or an out-of-range amount', () => {
    expect(() => upiLink({ vpa: 'nope', name: 'x' }, { amount: 1, reference: 'r' })).toThrow();
    expect(() => upiLink(PAYEE, { amount: 0, reference: 'r' })).toThrow(RangeError);
    expect(() => upiLink(PAYEE, { amount: 5_000_000, reference: 'r' })).toThrow(RangeError);
  });

  it('builds the static string without an amount and renders a QR', async () => {
    expect(staticUpiString({ vpa: '7339498130@ptsbi', name: 'Sajin' })).toBe(
      'upi://pay?pa=7339498130@ptsbi&pn=Sajin',
    );
    expect(await qrDataUrl('upi://pay?pa=a@b')).toMatch(/^data:image\/png;base64,/);
  });
});

describe('razorpay helpers', () => {
  it('converts rupees to integer paise', () => {
    expect(toPaise(2950)).toBe(295000);
    expect(toPaise(1234.56)).toBe(123456);
  });

  it('creates an order with basic auth and paise', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: 'order_1', amount: 295000, currency: 'INR', receipt: 'BK-1' }));
    }) as unknown as typeof fetch;
    const o = await createOrder({ keyId: 'k', keySecret: 's' }, { amountRupees: 2950, receipt: 'BK-1' }, f);
    expect(o.id).toBe('order_1');
    expect(seen!.url).toBe('https://api.razorpay.com/v1/orders');
    expect(JSON.parse(seen!.init.body as string).amount).toBe(295000);
    expect((seen!.init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it('verifies webhook and checkout signatures', () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const sig = createHmac('sha256', 'whsec').update(raw).digest('hex');
    expect(verifyWebhook('whsec', raw, sig)).toBe(true);
    expect(verifyWebhook('whsec', raw, sig.replace(/.$/, '0'))).toBe(false);
    expect(verifyWebhook('whsec', raw, undefined)).toBe(false);

    const c = createHmac('sha256', 'key').update('order_1|pay_1').digest('hex');
    expect(verifyCheckout('key', 'order_1', 'pay_1', c)).toBe(true);
    expect(verifyCheckout('key', 'order_1', 'pay_2', c)).toBe(false);
  });
});

function setup(opts: { razorpay?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = {
    async one(fn, args = {}) {
      calls.push({ fn, args });
      if (fn === 'start_payment') {
        return { id: ID, booking_id: args.p_booking, amount: '2950.00', method: args.p_method, status: 'initiated', reference: 'BK-10423' } as never;
      }
      return { id: ID } as never;
    },
    async many() {
      return [] as never;
    },
    async insert() {
      /* unused */
    },
  };
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ id: 'order_9', amount: 295000, currency: 'INR', receipt: 'BK-10423' }))) as unknown as typeof fetch;
  const app = createApp(loadConfig({ NODE_ENV: 'test' }), {
    auth: { jwtSecret: SECRET, lookupRole: async (id) => roles[id] ?? null },
    profiles: { get: async () => null, update: async () => { throw new Error('unused'); } },
    rpc,
    payments: {
      payee: PAYEE,
      razorpay: opts.razorpay ? { keyId: 'rzp_test_1', keySecret: 'sec', webhookSecret: 'whsec' } : undefined,
      fetchImpl,
    },
  });
  return { app, calls };
}

describe('payment routes', () => {
  it('returns a server-built UPI link and ignores any client amount', async () => {
    const { app } = setup();
    const res = await request(app).post(`/api/bookings/${ID}/pay`).set(bearer('cust')).send({ method: 'upi_link' });
    expect(res.status).toBe(201);
    expect(res.body.upi_link).toContain('am=2950.00');
    const bad = await request(app)
      .post(`/api/bookings/${ID}/pay`)
      .set(bearer('cust'))
      .send({ method: 'upi_link', amount: 1 });
    expect(bad.status).toBe(400);
  });

  it('returns static and dynamic QR codes with instructions for the QR method', async () => {
    const { app } = setup();
    const res = await request(app).post(`/api/bookings/${ID}/pay`).set(bearer('cust')).send({ method: 'upi_qr' });
    expect(res.status).toBe(201);
    expect(res.body.static_qr).toMatch(/^data:image\/png/);
    expect(res.body.dynamic_qr).toMatch(/^data:image\/png/);
    expect(res.body.instructions).toContain('2950.00');
    expect(res.body.instructions).toContain('BK-10423');
  });

  it('creates a gateway order and attaches it to the payment', async () => {
    const { app, calls } = setup({ razorpay: true });
    const res = await request(app).post(`/api/bookings/${ID}/pay`).set(bearer('cust')).send({ method: 'razorpay' });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ id: 'order_9', key_id: 'rzp_test_1' });
    expect(calls.map((c) => c.fn)).toEqual(['start_payment', 'attach_gateway_order']);
  });

  it('says so when the gateway is not configured', async () => {
    const { app } = setup();
    const res = await request(app).post(`/api/bookings/${ID}/pay`).set(bearer('cust')).send({ method: 'razorpay' });
    expect(res.status).toBe(503);
  });

  it('validates the UTR shape', async () => {
    const { app } = setup();
    await request(app).post(`/api/payments/${ID}/utr`).set(bearer('cust')).send({ utr: '123' }).expect(400);
    await request(app).post(`/api/payments/${ID}/utr`).set(bearer('cust')).send({ utr: '123456789012' }).expect(200);
  });

  it('restricts confirmation and rejection by role', async () => {
    const { app } = setup();
    await request(app).post(`/api/payments/${ID}/confirm`).set(bearer('cust')).expect(403);
    await request(app).post(`/api/payments/${ID}/confirm`).set(bearer('mech')).expect(200);
    await request(app).post(`/api/payments/${ID}/reject`).set(bearer('mech')).send({ reason: 'not in statement' }).expect(403);
    await request(app).post(`/api/payments/${ID}/reject`).set(bearer('adm')).send({ reason: 'not in statement' }).expect(200);
  });

  it('confirms a captured payment from a signed webhook, and ignores unsigned ones', async () => {
    const { app, calls } = setup({ razorpay: true });
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_1', order_id: 'order_9', amount: 295000 } } },
    });
    await request(app).post('/api/razorpay/webhook').set('Content-Type', 'application/json').send(body).expect(401);
    const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
    await request(app)
      .post('/api/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', sig)
      .send(body)
      .expect(200);
    const c = calls.find((x) => x.fn === 'confirm_gateway_payment')!;
    expect(c.args).toEqual({ p_order_id: 'order_9', p_razorpay_payment_id: 'pay_1', p_amount: 2950 });
  });

  it('keeps finance operations admin-only', async () => {
    const { app } = setup();
    await request(app).post('/api/admin/finance/payouts/plan').set(bearer('mech')).expect(403);
    await request(app).post('/api/admin/finance/payouts/plan').set(bearer('adm')).expect(200);
    await request(app)
      .post(`/api/admin/finance/refunds/${ID}/complete`)
      .set(bearer('adm'))
      .send({ reference: '' })
      .expect(400);
  });
});

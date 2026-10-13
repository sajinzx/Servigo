import { createHmac, timingSafeEqual } from 'crypto';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  baseUrl?: string;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
}

/** Razorpay amounts are in paise, as integers. */
export const toPaise = (rupees: number) => Math.round(rupees * 100);

export async function createOrder(
  cfg: RazorpayConfig,
  args: { amountRupees: number; receipt: string; notes?: Record<string, string> },
  f: typeof fetch = fetch,
): Promise<RazorpayOrder> {
  const res = await f(`${cfg.baseUrl ?? 'https://api.razorpay.com'}/v1/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify({
      amount: toPaise(args.amountRupees),
      currency: 'INR',
      receipt: args.receipt,
      notes: args.notes ?? {},
    }),
  });
  if (!res.ok) throw new Error(`razorpay ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as RazorpayOrder;
}

/** Webhook signature: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWebhook(secret: string, raw: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Checkout success signature: HMAC of "order_id|payment_id" with the key secret. */
export function verifyCheckout(secret: string, orderId: string, paymentId: string, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

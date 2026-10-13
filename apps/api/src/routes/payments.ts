import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware';
import type { Rpc } from '../db/rpc';
import { HttpError } from '../http/errors';
import { createOrder, verifyWebhook, type RazorpayConfig } from '../domain/razorpay';
import { qrDataUrl, staticUpiString, upiLink, type UpiPayee } from '../domain/upi';

const uuid = z.string().uuid();

interface PaymentRow {
  id: string;
  booking_id: string;
  amount: number | string;
  method: string;
  status: string;
  reference: string;
}

export interface PaymentsDeps {
  rpc: Rpc;
  payee?: UpiPayee;
  razorpay?: RazorpayConfig;
  fetchImpl?: typeof fetch;
}

const startSchema = z
  .object({ method: z.enum(['upi_link', 'upi_qr', 'razorpay']) })
  .strict();
const utrSchema = z
  .object({
    utr: z.string().regex(/^[0-9]{12}$/, 'a UTR is 12 digits'),
    screenshot_path: z.string().max(300).optional(),
  })
  .strict();
const rejectSchema = z
  .object({ reason: z.string().trim().min(3).max(300), fake: z.boolean().default(false) })
  .strict();

export function paymentsRouter(deps: PaymentsDeps, auth: RequestHandler): Router {
  const { rpc } = deps;
  const r = Router();

  const wrap =
    (fn: RequestHandler): RequestHandler =>
    async (req, res, next) => {
      try {
        await fn(req, res, next);
      } catch (e) {
        next(e);
      }
    };

  // Razorpay calls this; no user session, so it authenticates by signature.
  r.post(
    '/razorpay/webhook',
    wrap(async (req, res) => {
      const secret = deps.razorpay?.webhookSecret;
      if (!secret) throw new HttpError(503, 'gateway webhook not configured');
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
      if (!raw || !verifyWebhook(secret, raw, req.header('x-razorpay-signature'))) {
        throw new HttpError(401, 'bad signature', 'bad_signature');
      }
      const event = req.body as {
        event?: string;
        payload?: { payment?: { entity?: { id: string; order_id: string; amount: number } } };
      };
      if (event.event === 'payment.captured') {
        const e = event.payload?.payment?.entity;
        if (e) {
          await rpc.one('confirm_gateway_payment', {
            p_order_id: e.order_id,
            p_razorpay_payment_id: e.id,
            p_amount: e.amount / 100,
          });
        }
      }
      res.sendStatus(200);
    }),
  );

  // The customer chooses how to pay. The amount is whatever the booking says.
  r.post(
    '/bookings/:id/pay',
    auth,
    requireRole('customer'),
    wrap(async (req, res) => {
      const { method } = startSchema.parse(req.body);
      const bookingId = uuid.parse(req.params.id);
      const p = await rpc.one<PaymentRow>('start_payment', {
        p_booking: bookingId,
        p_customer: req.user!.id,
        p_method: method,
      });
      const amount = Number(p.amount);
      const out: Record<string, unknown> = { payment: p, amount, reference: p.reference };

      if (method === 'razorpay') {
        if (!deps.razorpay) throw new HttpError(503, 'card and netbanking payments are not configured');
        const order = await createOrder(
          deps.razorpay,
          { amountRupees: amount, receipt: p.reference, notes: { booking_id: bookingId } },
          deps.fetchImpl,
        );
        await rpc.one('attach_gateway_order', { p_payment: p.id, p_order_id: order.id });
        out.order = { id: order.id, amount: order.amount, currency: order.currency, key_id: deps.razorpay.keyId };
        return void res.status(201).json(out);
      }

      if (!deps.payee) throw new HttpError(503, 'UPI payments are not configured');
      if (method === 'upi_link') {
        out.upi_link = upiLink(deps.payee, { amount, reference: p.reference });
      } else {
        // static QR (no amount, the customer types it) plus a dynamic one with the amount filled in
        out.static_qr = await qrDataUrl(staticUpiString(deps.payee));
        out.dynamic_qr = await qrDataUrl(upiLink(deps.payee, { amount, reference: p.reference }));
        out.instructions = `Pay exactly ₹${amount.toFixed(2)} and put ${p.reference} in the note.`;
      }
      res.status(201).json(out);
    }),
  );

  r.post(
    '/payments/:id/utr',
    auth,
    requireRole('customer'),
    wrap(async (req, res) => {
      const b = utrSchema.parse(req.body);
      res.json(
        await rpc.one('submit_utr', {
          p_payment: uuid.parse(req.params.id),
          p_customer: req.user!.id,
          p_utr: b.utr,
          p_screenshot: b.screenshot_path ?? null,
        }),
      );
    }),
  );

  // "Payment received" in the mechanic's app, or an admin reconciling the statement
  r.post(
    '/payments/:id/confirm',
    auth,
    requireRole('mechanic', 'admin'),
    wrap(async (req, res) => {
      res.json(
        await rpc.one('confirm_payment', {
          p_payment: uuid.parse(req.params.id),
          p_actor: req.user!.id,
          p_actor_role: req.user!.role,
        }),
      );
    }),
  );

  r.post(
    '/payments/:id/reject',
    auth,
    requireRole('admin'),
    wrap(async (req, res) => {
      const b = rejectSchema.parse(req.body);
      res.json(
        await rpc.one('reject_payment', {
          p_payment: uuid.parse(req.params.id),
          p_actor: req.user!.id,
          p_reason: b.reason,
          p_fake: b.fake,
        }),
      );
    }),
  );

  return r;
}

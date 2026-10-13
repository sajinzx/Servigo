import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware';
import type { Rpc } from '../db/rpc';

const uuid = z.string().uuid();
const refSchema = z.object({ reference: z.string().trim().min(3).max(100) }).strict();
const refundSchema = z
  .object({
    booking_id: z.string().uuid(),
    amount: z.number().positive().max(1_000_000),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

/** Admin-only money operations: refunds, payouts, reconciliation. Each is a SQL function. */
export function financeRouter(rpc: Rpc, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth, requireRole('admin'));

  const wrap =
    (fn: RequestHandler): RequestHandler =>
    async (req, res, next) => {
      try {
        await fn(req, res, next);
      } catch (e) {
        next(e);
      }
    };

  r.post(
    '/refunds',
    wrap(async (req, res) => {
      const b = refundSchema.parse(req.body);
      res.status(201).json(
        await rpc.one('create_refund', {
          p_booking: b.booking_id,
          p_amount: b.amount,
          p_reason: b.reason,
          p_actor: req.user!.id,
        }),
      );
    }),
  );

  r.post(
    '/refunds/:id/complete',
    wrap(async (req, res) => {
      const { reference } = refSchema.parse(req.body);
      res.json(
        await rpc.one('complete_refund', {
          p_refund: uuid.parse(req.params.id),
          p_admin: req.user!.id,
          p_reference: reference,
        }),
      );
    }),
  );

  r.post(
    '/payouts/plan',
    wrap(async (_req, res) => {
      const n = await rpc.one<number>('plan_payouts', {});
      res.json({ planned: n });
    }),
  );

  r.post(
    '/payouts/:id/paid',
    wrap(async (req, res) => {
      const { reference } = refSchema.parse(req.body);
      res.json(
        await rpc.one('mark_payout_paid', {
          p_payout: uuid.parse(req.params.id),
          p_admin: req.user!.id,
          p_reference: reference,
        }),
      );
    }),
  );

  r.get(
    '/ledger/balanced',
    wrap(async (_req, res) => {
      res.json({ balanced: await rpc.one<boolean>('ledger_is_balanced', {}) });
    }),
  );

  return r;
}

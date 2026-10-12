import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware';
import type { Rpc } from '../db/rpc';

const uuid = z.string().uuid();
const idOf = (req: { params: Record<string, string | string[]> }) => uuid.parse(req.params.id);

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const incidentSchema = z
  .object({ upheld: z.boolean(), resolution: z.string().trim().min(3).max(500) })
  .strict();
const disputeSchema = z
  .object({
    outcome: z.enum(['upheld', 'partial', 'rejected']),
    refund_amount: z.number().min(0).max(1_000_000).default(0),
    resolution: z.string().trim().min(3).max(500),
  })
  .strict();
const appealSchema = z
  .object({ accept: z.boolean(), note: z.string().trim().min(3).max(500) })
  .strict();

/** Everything an admin does goes through here; each action is a SQL function that logs who and why. */
export function adminRouter(rpc: Rpc, auth: RequestHandler): Router {
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

  r.get('/review-queue', wrap(async (_req, res) => res.json(await rpc.many('admin_review_queue'))));
  r.get('/cases', wrap(async (_req, res) => res.json(await rpc.many('admin_open_cases'))));
  r.get('/dead-letters', wrap(async (_req, res) => res.json(await rpc.many('admin_dead_letters'))));

  r.post(
    '/dead-letters/:id/requeue',
    wrap(async (req, res) => {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      await rpc.one('requeue_dead_job', { p_id: id });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/applications/:id/approve',
    wrap(async (req, res) => {
      res.json(await rpc.one('approve_application', { p_application: idOf(req), p_admin: req.user!.id }));
    }),
  );

  r.post(
    '/applications/:id/reject',
    wrap(async (req, res) => {
      const { reason } = reasonSchema.parse(req.body);
      res.json(
        await rpc.one('reject_application', {
          p_application: idOf(req),
          p_admin: req.user!.id,
          p_reason: reason,
        }),
      );
    }),
  );

  r.post(
    '/incidents/:id/resolve',
    wrap(async (req, res) => {
      const b = incidentSchema.parse(req.body);
      res.json(
        await rpc.one('resolve_incident', {
          p_incident: idOf(req),
          p_admin: req.user!.id,
          p_upheld: b.upheld,
          p_resolution: b.resolution,
        }),
      );
    }),
  );

  r.post(
    '/disputes/:id/resolve',
    wrap(async (req, res) => {
      const b = disputeSchema.parse(req.body);
      res.json(
        await rpc.one('resolve_dispute', {
          p_dispute: idOf(req),
          p_admin: req.user!.id,
          p_outcome: b.outcome,
          p_refund: b.refund_amount,
          p_resolution: b.resolution,
        }),
      );
    }),
  );

  r.post(
    '/strikes/:id/appeal',
    wrap(async (req, res) => {
      const b = appealSchema.parse(req.body);
      res.json(
        await rpc.one('decide_appeal', {
          p_strike: idOf(req),
          p_admin: req.user!.id,
          p_accept: b.accept,
          p_note: b.note,
        }),
      );
    }),
  );

  return r;
}

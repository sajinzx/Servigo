import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware';
import type { Rpc } from '../db/rpc';

const uuid = z.string().uuid();

const incidentSchema = z
  .object({
    type: z.enum(['no_show', 'overcharge', 'damage', 'safety', 'off_platform', 'fake_review', 'other']),
    description: z.string().trim().min(5).max(1000),
    evidence: z.array(z.string().max(300)).max(10).default([]),
  })
  .strict();

const disputeSchema = z
  .object({
    reason: z.string().trim().min(5).max(1000),
    evidence: z.array(z.string().max(300)).max(10).default([]),
  })
  .strict();

const appealSchema = z.object({ text: z.string().trim().min(5).max(1000) }).strict();

/** Customer and workshop facing trust & safety actions. The rules themselves are SQL. */
export function safetyRouter(rpc: Rpc, auth: RequestHandler): Router {
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

  r.post(
    '/bookings/:id/incidents',
    auth,
    wrap(async (req, res) => {
      const b = incidentSchema.parse(req.body);
      const inc = await rpc.one('report_incident', {
        p_booking: uuid.parse(req.params.id),
        p_reporter: req.user!.id,
        p_type: b.type,
        p_description: b.description,
        p_evidence: b.evidence,
      });
      res.status(201).json(inc);
    }),
  );

  r.post(
    '/bookings/:id/dispute',
    auth,
    requireRole('customer'),
    wrap(async (req, res) => {
      const b = disputeSchema.parse(req.body);
      const d = await rpc.one('open_dispute', {
        p_booking: uuid.parse(req.params.id),
        p_customer: req.user!.id,
        p_reason: b.reason,
        p_evidence: b.evidence,
      });
      res.status(201).json(d);
    }),
  );

  r.post(
    '/strikes/:id/appeal',
    auth,
    requireRole('mechanic'),
    wrap(async (req, res) => {
      const b = appealSchema.parse(req.body);
      res.json(
        await rpc.one('appeal_strike', {
          p_strike: uuid.parse(req.params.id),
          p_owner: req.user!.id,
          p_text: b.text,
        }),
      );
    }),
  );

  return r;
}

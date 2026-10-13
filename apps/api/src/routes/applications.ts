import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Rpc } from '../db/rpc';
import { badRequest } from '../http/errors';
import {
  gstinMatchesPan,
  validateBank,
  validateGstin,
  validatePan,
  validateUpiId,
} from '../domain/kyc';
import { encrypt, fingerprint, last4 } from '../domain/secrets';

const uuid = z.string().uuid();

const createSchema = z
  .object({
    shop_name: z.string().trim().min(2).max(80),
    owner_name: z.string().trim().min(2).max(80),
    phone: z.string().regex(/^\+91[6-9]\d{9}$/, 'use +91XXXXXXXXXX'),
    city: z.string().trim().min(2).max(60),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    service_ids: z.array(z.string().uuid()).min(1).max(40),
    staff_count: z.number().int().min(1).max(50),
    open_hours: z.record(z.array(z.string().regex(/^\d\d:\d\d$/)).length(2)).optional(),
  })
  .strict();

const documentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner_id'), storage_path: z.string().min(3).max(300) }).strict(),
  z.object({ kind: z.literal('shop_photo_outside'), storage_path: z.string().min(3).max(300) }).strict(),
  z.object({ kind: z.literal('shop_photo_bay'), storage_path: z.string().min(3).max(300) }).strict(),
  z.object({ kind: z.literal('pan'), number: z.string(), storage_path: z.string().max(300).optional() }).strict(),
  z.object({ kind: z.literal('gstin'), number: z.string(), pan: z.string().optional() }).strict(),
  z.object({ kind: z.literal('upi'), upi_id: z.string() }).strict(),
  z.object({ kind: z.literal('bank'), account_number: z.string(), ifsc: z.string() }).strict(),
]);

export interface ApplicationDeps {
  rpc: Rpc;
  /** 32-byte key for payout encryption */
  payoutKey: Buffer;
}

export function applicationsRouter(deps: ApplicationDeps, auth: RequestHandler): Router {
  const { rpc, payoutKey } = deps;
  const r = Router();
  r.use(auth);

  r.post('/', async (req, res, next) => {
    try {
      const b = createSchema.parse(req.body);
      const app = await rpc.one('create_application', {
        p_applicant: req.user!.id,
        p_shop_name: b.shop_name,
        p_owner_name: b.owner_name,
        p_phone: b.phone,
        p_city: b.city,
        p_lat: b.lat,
        p_lng: b.lng,
        p_service_ids: b.service_ids,
        p_staff: b.staff_count,
        p_hours: b.open_hours ?? null,
      });
      res.status(201).json(app);
    } catch (e) {
      next(e);
    }
  });

  r.post('/:id/documents', async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      const doc = documentSchema.parse(req.body);
      const me = req.user!.id;

      const check = (name: string, result: { ok: boolean; reason?: string }, blocking = true) =>
        rpc.one('record_kyc_check', {
          p_application: id,
          p_check: name,
          p_passed: result.ok,
          p_blocking: blocking,
          p_detail: result.reason ? { reason: result.reason } : {},
        });

      let path: string | null = null;
      let number: string | null = null;

      switch (doc.kind) {
        case 'owner_id':
        case 'shop_photo_outside':
        case 'shop_photo_bay':
          path = doc.storage_path;
          break;
        case 'pan': {
          const v = validatePan(doc.number);
          await check('pan_format', v);
          if (!v.ok) throw badRequest(v.reason!);
          number = doc.number.trim().toUpperCase();
          path = doc.storage_path ?? null;
          break;
        }
        case 'gstin': {
          const v = validateGstin(doc.number);
          await check('gstin_checksum', v);
          if (!v.ok) throw badRequest(v.reason!);
          if (doc.pan) {
            await check('gstin_matches_pan', {
              ok: gstinMatchesPan(doc.number, doc.pan),
              reason: 'GSTIN does not contain the PAN given',
            });
          }
          number = doc.number.trim().toUpperCase();
          break;
        }
        case 'upi': {
          const v = validateUpiId(doc.upi_id);
          await check('upi_format', v);
          if (!v.ok) throw badRequest(v.reason!);
          const upi = doc.upi_id.trim().toLowerCase();
          await rpc.insert('payout_accounts', {
            application_id: id,
            kind: 'upi',
            ciphertext: encrypt(upi, payoutKey),
            fingerprint: fingerprint(upi, payoutKey),
            last4: last4(upi.split('@')[0]),
          });
          number = `upi:****${last4(upi.split('@')[0])}`;
          break;
        }
        case 'bank': {
          const v = validateBank(doc.account_number, doc.ifsc);
          await check('bank_format', v);
          if (!v.ok) throw badRequest(v.reason!);
          const value = `${doc.account_number.trim()}:${doc.ifsc.trim().toUpperCase()}`;
          await rpc.insert('payout_accounts', {
            application_id: id,
            kind: 'bank',
            ciphertext: encrypt(value, payoutKey),
            fingerprint: fingerprint(value, payoutKey),
            last4: last4(doc.account_number),
          });
          number = `bank:****${last4(doc.account_number)}`;
          break;
        }
      }

      const saved = await rpc.one('attach_document', {
        p_application: id,
        p_applicant: me,
        p_kind: doc.kind,
        p_path: path,
        p_number: number,
      });
      res.status(201).json(saved);
    } catch (e) {
      next(e);
    }
  });

  r.post('/:id/submit', async (req, res, next) => {
    try {
      const id = uuid.parse(req.params.id);
      // duplicates do not block, they are flagged for the reviewer
      const dups = await rpc.many<{ reason: string; other_application: string }>(
        'find_duplicate_applicants',
        { p_application: id },
      );
      await rpc.one('record_kyc_check', {
        p_application: id,
        p_check: 'duplicate_applicant',
        p_passed: dups.length === 0,
        p_blocking: false,
        p_detail: { matches: dups },
      });
      const app = await rpc.one('submit_for_review', { p_application: id, p_applicant: req.user!.id });
      res.json(app);
    } catch (e) {
      next(e);
    }
  });

  return r;
}

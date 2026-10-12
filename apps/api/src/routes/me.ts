import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { notFound } from '../http/errors';

export interface Profile {
  id: string;
  role: 'customer' | 'mechanic' | 'admin';
  full_name: string | null;
  phone: string | null;
  phone_verified: boolean;
  whatsapp_opt_in: boolean;
  onboarded_at: string | null;
}

export interface ProfileRepo {
  get(id: string): Promise<Profile | null>;
  update(id: string, patch: Partial<Pick<Profile, 'full_name' | 'phone' | 'whatsapp_opt_in'>>): Promise<Profile>;
}

const patchSchema = z
  .object({
    full_name: z.string().trim().min(2).max(80).optional(),
    phone: z
      .string()
      .regex(/^\+91[6-9]\d{9}$/, 'use an Indian mobile number in +91XXXXXXXXXX form')
      .optional(),
    whatsapp_opt_in: z.boolean().optional(),
  })
  .strict();

export function meRouter(repo: ProfileRepo, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth);

  r.get('/', async (req, res, next) => {
    try {
      const profile = await repo.get(req.user!.id);
      if (!profile) throw notFound('profile');
      res.json(profile);
    } catch (e) {
      next(e);
    }
  });

  r.patch('/', async (req, res, next) => {
    try {
      const patch = patchSchema.parse(req.body);
      res.json(await repo.update(req.user!.id, patch));
    } catch (e) {
      next(e);
    }
  });

  return r;
}

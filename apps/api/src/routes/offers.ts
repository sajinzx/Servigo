import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware';

export interface OfferStore {
  respond(
    offerId: string,
    response: 'accepted' | 'rejected',
    actorId: string,
    actorRole: 'mechanic' | 'admin',
  ): Promise<{ id: string; booking_id: string; response: string }>;
}

const uuid = z.string().uuid();

export function offersRouter(store: OfferStore, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth, requireRole('mechanic', 'admin'));

  const answer =
    (response: 'accepted' | 'rejected'): RequestHandler =>
    async (req, res, next) => {
      try {
        const id = uuid.parse(req.params.id);
        const user = req.user!;
        res.json(await store.respond(id, response, user.id, user.role as 'mechanic' | 'admin'));
      } catch (e) {
        next(e);
      }
    };

  r.post('/:id/accept', answer('accepted'));
  r.post('/:id/reject', answer('rejected'));
  return r;
}

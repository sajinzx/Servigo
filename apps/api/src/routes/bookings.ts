import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/middleware';
import { baselineQuote } from '../domain/pricing';
import { badRequest, notFound } from '../http/errors';

export interface BookingRow {
  id: string;
  ref: string;
  status: string;
  customer_id: string;
  workshop_id: string | null;
  quote_low: number;
  quote_high: number;
  final_price: number | null;
  needs_price_approval: boolean;
}

export interface QuoteContext {
  basePrice: number;
  segmentFactor: number;
  baseDurationMin: number;
}

export interface CreateBookingArgs {
  customerId: string;
  vehicleId: string;
  serviceId: string;
  mode: 'workshop' | 'doorstep';
  lat: number;
  lng: number;
  scheduledFor: string | null;
  symptomText: string | null;
  quoteLow: number;
  quoteHigh: number;
  predictedDurationMin: number;
}

export interface BookingStore {
  quoteContext(vehicleId: string, serviceId: string): Promise<QuoteContext | null>;
  addressPoint(userId: string, addressId: string): Promise<{ lat: number; lng: number } | null>;
  create(args: CreateBookingArgs): Promise<BookingRow>;
  transition(
    bookingId: string,
    to: string,
    actorId: string,
    actorRole: string,
    meta?: Record<string, unknown>,
  ): Promise<BookingRow>;
  complete(bookingId: string, actorId: string, role: string, labour: number, parts: number): Promise<BookingRow>;
  approvePrice(bookingId: string, customerId: string): Promise<BookingRow>;
  review(bookingId: string, customerId: string, rating: number, comment: string | null): Promise<void>;
}

// `.strict()` makes a client-supplied price a validation error instead of silently ignored
const createSchema = z
  .object({
    vehicle_id: z.string().uuid(),
    service_id: z.string().uuid(),
    mode: z.enum(['workshop', 'doorstep']).default('workshop'),
    address_id: z.string().uuid().optional(),
    location: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .optional(),
    scheduled_for: z.string().datetime().optional(),
    symptom_text: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.address_id || v.location, { message: 'address_id or location is required' });

const completeSchema = z
  .object({ labour_amount: z.number().min(0).max(1_000_000), parts_amount: z.number().min(0).max(1_000_000).default(0) })
  .strict();

const reviewSchema = z
  .object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() })
  .strict();

const uuid = z.string().uuid();
const bookingId = (req: { params: Record<string, string | string[]> }) =>
  uuid.parse(req.params.id);

const cancelSchema = z.object({ reason: z.string().trim().max(200).optional() }).strict();

export function bookingsRouter(store: BookingStore, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth);

  r.post('/', requireRole('customer'), async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const user = req.user!;

      const ctx = await store.quoteContext(body.vehicle_id, body.service_id);
      if (!ctx) throw notFound('vehicle or service');

      let point = body.location ?? null;
      if (body.address_id) {
        point = await store.addressPoint(user.id, body.address_id);
        if (!point) throw notFound('address');
      }
      if (!point) throw badRequest('a pickup location is required');

      const quote = baselineQuote({ basePrice: ctx.basePrice, segmentFactor: ctx.segmentFactor });
      const booking = await store.create({
        customerId: user.id,
        vehicleId: body.vehicle_id,
        serviceId: body.service_id,
        mode: body.mode,
        lat: point.lat,
        lng: point.lng,
        scheduledFor: body.scheduled_for ?? null,
        symptomText: body.symptom_text ?? null,
        quoteLow: quote.low,
        quoteHigh: quote.high,
        predictedDurationMin: ctx.baseDurationMin,
      });

      // create_booking queued the dispatch job in the same transaction
      res.status(201).json(booking);
    } catch (e) {
      next(e);
    }
  });

  r.post('/:id/cancel', requireRole('customer', 'mechanic', 'admin'), async (req, res, next) => {
    try {
      const { reason } = cancelSchema.parse(req.body ?? {});
      const user = req.user!;
      res.json(await store.transition(bookingId(req), 'cancelled', user.id, user.role, { reason }));
    } catch (e) {
      next(e);
    }
  });

  r.post('/:id/start', requireRole('mechanic', 'admin'), async (req, res, next) => {
    try {
      const user = req.user!;
      res.json(await store.transition(bookingId(req), 'in_progress', user.id, user.role));
    } catch (e) {
      next(e);
    }
  });

  r.post('/:id/complete', requireRole('mechanic', 'admin'), async (req, res, next) => {
    try {
      const body = completeSchema.parse(req.body);
      const user = req.user!;
      res.json(
        await store.complete(bookingId(req), user.id, user.role, body.labour_amount, body.parts_amount),
      );
    } catch (e) {
      next(e);
    }
  });

  r.post('/:id/approve-price', requireRole('customer'), async (req, res, next) => {
    try {
      res.json(await store.approvePrice(bookingId(req), req.user!.id));
    } catch (e) {
      next(e);
    }
  });

  r.post('/:id/review', requireRole('customer'), async (req, res, next) => {
    try {
      const body = reviewSchema.parse(req.body);
      await store.review(bookingId(req), req.user!.id, body.rating, body.comment ?? null);
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

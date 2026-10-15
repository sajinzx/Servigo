import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Quoter } from '../domain/quoter';
import { keywordTriage } from '../domain/triageBaseline';
import { HttpError, notFound } from '../http/errors';
import type { MlClient } from '../ml/client';
import type { BookingStore } from './bookings';
import { serviceDueBaseline } from '../domain/serviceDue';

const quoteQuery = z.object({ vehicle_id: z.string().uuid(), service_id: z.string().uuid() });
const triageBody = z
  .object({
    text: z.string().trim().min(2).max(1000),
    vehicle_kind: z.enum(['car', 'bike']),
    k: z.number().int().min(1).max(5).default(3),
  })
  .strict();

const stop = z
  .object({
    name: z.string().trim().min(1).max(80),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    dwell_min: z.number().min(0).max(600).optional(),
  })
  .strict();
const tripBody = z
  .object({
    start: stop,
    stops: z.array(stop).min(1).max(25),
    end: stop.optional(),
    optimise: z.boolean().optional(),
    mileage_kmpl: z.number().gt(0).max(80).optional(),
    fuel_price: z.number().gt(0).max(500).optional(),
    vehicle: z
      .object({
        kind: z.enum(['car', 'bike']),
        segment: z.string().max(30).optional(),
        age_years: z.number().min(0).max(40).optional(),
        odometer_km: z.number().min(0).optional(),
        km_per_day: z.number().gt(0).max(1000).optional(),
        days_since_service: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** What the booking screen shows before the customer confirms: suggested services, price range, time. */
export function quotesRouter(
  store: Pick<BookingStore, 'quoteContext' | 'vehicleDue'>,
  quoter: Quoter,
  ml: MlClient | null,
  auth: RequestHandler,
): Router {
  const r = Router();

  r.get('/quote', auth, async (req, res, next) => {
    try {
      const q = quoteQuery.parse(req.query);
      const ctx = await store.quoteContext(q.vehicle_id, q.service_id);
      if (!ctx) throw notFound('vehicle or service');
      const quote = await quoter.quote(ctx);
      res.json({
        price: { low: quote.low, high: quote.high, expected: quote.expected, gst_inclusive: true },
        duration: { minutes: quote.durationMin, low: quote.durationLow, high: quote.durationHigh },
        source: quote.source,
        why: quote.why ?? [],
      });
    } catch (e) {
      next(e);
    }
  });

  // "next service due in ~N days" on the garage card
  r.get('/vehicles/:id/service-due', auth, async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const f = await store.vehicleDue(id, req.user!.id);
      if (!f) throw notFound('vehicle');
      const fromModel = ml
        ? await ml.serviceDue({
            kind: f.kind,
            age_years: f.ageYears,
            km_per_day: f.kmPerDay,
            days_since_service: f.daysSinceService,
            within_days: 30,
          })
        : null;
      if (fromModel && fromModel.model_version !== 'baseline') {
        res.json({
          days_left: fromModel.days_left,
          probability_due: fromModel.probability_due,
          source: 'ml',
        });
        return;
      }
      res.json({ ...serviceDueBaseline(f.kmPerDay, f.daysSinceService), source: 'baseline' });
    } catch (e) {
      next(e);
    }
  });

  // health score, parts that need attention and what they will cost; needs the ML service
  r.get('/vehicles/:id/intelligence', auth, async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const f = await store.vehicleDue(id, req.user!.id);
      if (!f) throw notFound('vehicle');
      const out = ml
        ? await ml.vehicleIntelligence({
            kind: f.kind,
            segment: f.segment ?? (f.kind === 'bike' ? 'commuter' : 'hatchback'),
            age_years: f.ageYears,
            odometer_km: f.odometerKm ?? 0,
            km_per_day: f.kmPerDay,
            days_since_service: f.daysSinceService,
          })
        : null;
      if (!out) throw new HttpError(503, 'Vehicle intelligence is not available right now', 'ml_unavailable');
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  r.post('/trip/plan', auth, async (req, res, next) => {
    try {
      const b = tripBody.parse(req.body);
      const out = ml ? await ml.tripPlan(b) : null;
      if (!out) throw new HttpError(503, 'Trip planning is not available right now', 'ml_unavailable');
      res.json(out);
    } catch (e) {
      next(e);
    }
  });

  r.post('/triage', auth, async (req, res, next) => {
    try {
      const b = triageBody.parse(req.body);
      const fromModel = ml ? await ml.triage(b.text, b.vehicle_kind, b.k) : null;
      if (fromModel && fromModel.length > 0) {
        res.json({ suggestions: fromModel, source: 'ml' });
        return;
      }
      res.json({ suggestions: keywordTriage(b.text, b.vehicle_kind, b.k), source: 'baseline' });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

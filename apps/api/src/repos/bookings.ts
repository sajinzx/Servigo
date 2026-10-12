import type { Db } from '../db/supabase';
import { unwrap } from '../db/supabase';
import type { BookingRow, BookingStore, QuoteContext } from '../routes/bookings';

/** supabase-js rpc wrapper: our SQL functions return a single booking row. */
export function supabaseBookings(db: Db): BookingStore {
  const one = async (fn: string, args: Record<string, unknown>) =>
    unwrap(await db.rpc(fn, args).single()) as BookingRow;

  return {
    async quoteContext(vehicleId, serviceId): Promise<QuoteContext | null> {
      const veh = await db
        .from('vehicles')
        .select('id, vehicle_models(kind, segment)')
        .eq('id', vehicleId)
        .maybeSingle();
      const vehicle = unwrap(veh) as unknown as {
        vehicle_models: { kind: string; segment: string };
      } | null;
      if (!vehicle) return null;

      const svc = await db
        .from('services')
        .select('base_price, base_duration_min')
        .eq('id', serviceId)
        .eq('is_active', true)
        .maybeSingle();
      const service = unwrap(svc) as { base_price: number; base_duration_min: number } | null;
      if (!service) return null;

      const fac = await db
        .from('segment_factors')
        .select('factor')
        .eq('vehicle_kind', vehicle.vehicle_models.kind)
        .eq('segment', vehicle.vehicle_models.segment)
        .maybeSingle();
      const factor = unwrap(fac) as { factor: number } | null;

      return {
        basePrice: Number(service.base_price),
        segmentFactor: factor ? Number(factor.factor) : 1,
        baseDurationMin: service.base_duration_min,
      };
    },

    async addressPoint(userId, addressId) {
      const res = await db
        .from('addresses')
        .select('lat, lng')
        .eq('id', addressId)
        .eq('user_id', userId)
        .maybeSingle();
      return unwrap(res) as { lat: number; lng: number } | null;
    },

    create: (a) =>
      one('create_booking', {
        p_customer: a.customerId,
        p_vehicle: a.vehicleId,
        p_service: a.serviceId,
        p_mode: a.mode,
        p_lat: a.lat,
        p_lng: a.lng,
        p_scheduled_for: a.scheduledFor,
        p_symptom: a.symptomText,
        p_quote_low: a.quoteLow,
        p_quote_high: a.quoteHigh,
        p_predicted_duration: a.predictedDurationMin,
      }),

    transition: (bookingId, to, actorId, actorRole, meta = {}) =>
      one('transition_booking', {
        p_booking_id: bookingId,
        p_to: to,
        p_actor_id: actorId,
        p_actor_role: actorRole,
        p_meta: meta,
      }),

    complete: (bookingId, actorId, role, labour, parts) =>
      one('complete_booking', {
        p_booking_id: bookingId,
        p_actor_id: actorId,
        p_actor_role: role,
        p_labour: labour,
        p_parts: parts,
      }),

    approvePrice: (bookingId, customerId) =>
      one('approve_price', { p_booking_id: bookingId, p_customer: customerId }),

    async review(bookingId, customerId, rating, comment) {
      unwrap(
        await db.rpc('submit_review', {
          p_booking_id: bookingId,
          p_customer: customerId,
          p_rating: rating,
          p_comment: comment,
        }),
      );
    },
  };
}

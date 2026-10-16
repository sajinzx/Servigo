import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/auth/AuthProvider';
import { requireSupabase } from '@/lib/supabase';
import type {
  Address,
  Booking,
  BookingEvent,
  Invoice,
  Offer,
  Payment,
  QuoteResponse,
  Service,
  TriageSuggestion,
  Vehicle,
  VehicleModel,
  Workshop,
} from '@/lib/types';

const BOOKING_SELECT =
  '*, services(name, code, vehicle_kind), vehicles(registration_no, vehicle_models(make, model)), workshops(name, phone, lat, lng)';

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? ([] as unknown)) as T;
}

// ---- reads straight from Supabase (RLS decides what comes back) ----------------

export const useVehicles = () =>
  useQuery({
    queryKey: ['vehicles'],
    queryFn: () =>
      must<Vehicle[]>(
        requireSupabase().from('vehicles').select('*, vehicle_models(*)').order('created_at', { ascending: false }),
      ),
  });

export const useVehicleModels = () =>
  useQuery({
    queryKey: ['vehicle-models'],
    staleTime: 10 * 60_000,
    queryFn: () =>
      must<VehicleModel[]>(requireSupabase().from('vehicle_models').select('*').order('make').order('model')),
  });

export const useServices = (kind?: 'car' | 'bike') =>
  useQuery({
    queryKey: ['services', kind],
    staleTime: 10 * 60_000,
    queryFn: () => {
      let q = requireSupabase().from('services').select('*').eq('is_active', true).order('base_price');
      if (kind) q = q.eq('vehicle_kind', kind);
      return must<Service[]>(q);
    },
  });

export const useAddresses = () =>
  useQuery({
    queryKey: ['addresses'],
    queryFn: () =>
      must<Address[]>(requireSupabase().from('addresses').select('*').order('is_default', { ascending: false })),
  });

export const useBookings = () =>
  useQuery({
    queryKey: ['bookings'],
    queryFn: () =>
      must<Booking[]>(
        requireSupabase().from('bookings').select(BOOKING_SELECT).order('created_at', { ascending: false }).limit(100),
      ),
  });

export const useInvoices = () =>
  useQuery({
    queryKey: ['invoices'],
    queryFn: () =>
      must<Invoice[]>(requireSupabase().from('invoices').select('*').order('issued_at', { ascending: false })),
  });

export function useBooking(id: string | undefined) {
  const qc = useQueryClient();
  const booking = useQuery({
    queryKey: ['booking', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('bookings').select(BOOKING_SELECT).eq('id', id!).single();
      if (error) throw new Error(error.message);
      return data as Booking;
    },
  });
  const events = useQuery({
    queryKey: ['booking-events', id],
    enabled: Boolean(id),
    queryFn: () =>
      must<BookingEvent[]>(
        requireSupabase().from('booking_events').select('id, to_status, at').eq('booking_id', id!).order('id'),
      ),
  });

  // live status: the tracking screen updates without a refresh
  useEffect(() => {
    if (!id) return;
    const sb = requireSupabase();
    const ch = sb
      .channel(`booking:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, () => {
        void qc.invalidateQueries({ queryKey: ['booking', id] });
        void qc.invalidateQueries({ queryKey: ['booking-events', id] });
      })
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [id, qc]);

  return { booking, events };
}

export function usePayment(bookingId: string | undefined) {
  return useQuery({
    queryKey: ['payment', bookingId],
    enabled: Boolean(bookingId),
    queryFn: async () => {
      const rows = await must<Payment[]>(
        requireSupabase()
          .from('payments')
          .select('*')
          .eq('booking_id', bookingId!)
          .order('created_at', { ascending: false })
          .limit(1),
      );
      return rows[0] ?? null;
    },
  });
}

/** The workshop the signed-in user owns. Workshops are publicly readable, so this must filter by owner. */
export function useMyWorkshop() {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery({
    queryKey: ['my-workshop', uid],
    enabled: !!uid,
    queryFn: async () => {
      const rows = await must<Workshop[]>(
        requireSupabase().from('workshops').select('*').eq('owner_id', uid!).limit(1),
      );
      return rows[0] ?? null;
    },
  });
}

/** Pending offers for the signed-in workshop, kept fresh with realtime. */
export function usePendingOffers(workshopId: string | undefined) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['offers', workshopId],
    enabled: Boolean(workshopId),
    refetchInterval: 15_000,
    queryFn: () =>
      must<Offer[]>(
        requireSupabase()
          .from('offers')
          .select(`*, bookings(${BOOKING_SELECT})`)
          .eq('workshop_id', workshopId!)
          .eq('response', 'pending')
          .gt('expires_at', new Date().toISOString())
          .order('offered_at'),
      ),
  });
  useEffect(() => {
    if (!workshopId) return;
    const sb = requireSupabase();
    const ch = sb
      .channel(`offers:${workshopId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers', filter: `workshop_id=eq.${workshopId}` }, () => {
        void qc.invalidateQueries({ queryKey: ['offers', workshopId] });
      })
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [workshopId, qc]);
  return q;
}

export const useWorkshopJobs = (workshopId: string | undefined) =>
  useQuery({
    queryKey: ['workshop-jobs', workshopId],
    enabled: Boolean(workshopId),
    refetchInterval: 20_000,
    queryFn: () =>
      must<Booking[]>(
        requireSupabase()
          .from('bookings')
          .select(BOOKING_SELECT)
          .eq('workshop_id', workshopId!)
          .in('status', ['accepted', 'in_progress', 'completed', 'payment_pending_verification'])
          .order('created_at'),
      ),
  });

// ---- writes go through the Core API ---------------------------------------------

export function useApiMutation<TIn, TOut = unknown>(
  fn: (input: TIn) => Promise<TOut>,
  invalidate: (string | undefined)[][] = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
    },
  });
}

export const quoteFor = (vehicleId: string, serviceId: string) =>
  api<QuoteResponse>('/api/quote', { query: { vehicle_id: vehicleId, service_id: serviceId } });

export const triage = (text: string, vehicleKind: 'car' | 'bike') =>
  api<{ suggestions: TriageSuggestion[]; source: 'ml' | 'baseline' }>('/api/triage', {
    body: { text, vehicle_kind: vehicleKind },
  });

-- 0015: flat exports for the pilot report. The report generator (services/ml/app/pilot_report.py)
-- reads these as CSV, so real data and simulator data go through the same metric code.
--
--   \copy (select * from public.pilot_export_bookings('2026-11-02', '2026-11-30')) to bookings.csv csv header
--   \copy (select * from public.pilot_export_offers('2026-11-02', '2026-11-30'))   to offers.csv csv header
--   \copy (select * from public.pilot_export_notifications('2026-11-02', '2026-11-30')) to notifications.csv csv header

create function public.pilot_export_bookings(p_from timestamptz, p_to timestamptz)
returns table (
  booking_id text, created_at timestamptz, status text, service_code text, vehicle_kind text,
  workshop_id uuid, assign_s double precision, eta_error_min double precision,
  duration_min double precision, predicted_duration_min double precision, base_min integer,
  quote_low numeric, quote_high numeric, final_price numeric, rating integer,
  payment_confirm_s double precision, disputed boolean, refunded boolean, rebooked boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select b.ref, b.created_at, b.status::text, s.code, vm.kind::text, b.workshop_id,
         extract(epoch from (acc.at - req.at))::double precision,
         -- there is no "arrived" status: job start stands in for arrival
         ((extract(epoch from (b.started_at - acc.at)) / 60.0) - b.eta_min)::double precision,
         (extract(epoch from (b.completed_at - b.started_at)) / 60.0)::double precision,
         b.predicted_duration_min::double precision, s.base_duration_min,
         b.quote_low, b.quote_high, b.final_price, r.rating,
         extract(epoch from (p.confirmed_at - b.completed_at))::double precision,
         exists (select 1 from public.disputes d where d.booking_id = b.id),
         b.status = 'refunded',
         exists (select 1 from public.bookings n
                  where n.customer_id = b.customer_id and n.created_at > b.created_at
                    and n.created_at <= b.created_at + interval '30 days')
    from public.bookings b
    join public.services s on s.id = b.service_id
    join public.vehicles v on v.id = b.vehicle_id
    join public.vehicle_models vm on vm.id = v.model_id
    left join lateral (select min(e.at) as at from public.booking_events e
                        where e.booking_id = b.id and e.to_status = 'requested') req on true
    left join lateral (select min(e.at) as at from public.booking_events e
                        where e.booking_id = b.id and e.to_status = 'accepted') acc on true
    left join public.reviews r on r.booking_id = b.id and not r.hidden
    left join lateral (select pay.confirmed_at from public.payments pay
                        where pay.booking_id = b.id and pay.status in ('confirmed', 'refunded')
                        order by pay.confirmed_at limit 1) p on true
   where b.created_at >= p_from and b.created_at < p_to
   order by b.created_at;
end $$;

create function public.pilot_export_offers(p_from timestamptz, p_to timestamptz)
returns table (
  offer_id uuid, booking_id text, workshop_id uuid, rank integer, distance_km double precision,
  active_jobs integer, staff_count integer, hour integer, weekday integer, night integer,
  markup double precision, response text, offered_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select o.id, b.ref, o.workshop_id, o.rank,
         coalesce((o.features ->> 'distance_km')::double precision, b.distance_km::double precision),
         coalesce((o.features ->> 'active_jobs')::integer, 0),
         w.staff_count,
         extract(hour from o.offered_at at time zone 'Asia/Kolkata')::integer,
         ((extract(isodow from o.offered_at at time zone 'Asia/Kolkata'))::integer - 1),
         case when extract(hour from o.offered_at at time zone 'Asia/Kolkata') >= 20
                or extract(hour from o.offered_at at time zone 'Asia/Kolkata') < 8 then 1 else 0 end,
         1.0::double precision,
         o.response::text, o.offered_at
    from public.offers o
    join public.bookings b on b.id = o.booking_id
    join public.workshops w on w.id = o.workshop_id
   where o.offered_at >= p_from and o.offered_at < p_to and o.response <> 'pending'
   order by o.offered_at;
end $$;

-- delivery latency per queue, from the notification log
create function public.pilot_export_notifications(p_from timestamptz, p_to timestamptz)
returns table (queue text, channel text, status text, latency_s double precision)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select case when n.template in ('offer_new', 'booking_accepted') then 'realtime'
              when n.template in ('payment_received', 'payout_notice') then 'billing'
              else 'notify' end,
         n.channel::text, n.status::text,
         extract(epoch from (coalesce(n.delivered_at, n.sent_at) - n.created_at))::double precision
    from public.notifications n
   where n.created_at >= p_from and n.created_at < p_to;
end $$;

revoke execute on function
  public.pilot_export_bookings(timestamptz, timestamptz),
  public.pilot_export_offers(timestamptz, timestamptz),
  public.pilot_export_notifications(timestamptz, timestamptz)
from public, anon;

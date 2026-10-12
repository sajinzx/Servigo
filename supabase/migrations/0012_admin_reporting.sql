-- 0012: read-only reporting for the admin dashboard and the pilot report.
-- All security definer functions check is_admin() themselves, so they are safe to expose over RPC.

-- one row per day: how allocation performed
create function public.admin_kpis(p_days integer default 14)
returns table (
  day               date,
  bookings          integer,
  assigned          integer,
  no_match          integer,
  median_assign_s   numeric,
  p90_assign_s      numeric,
  offers            integer,
  offers_accepted   integer,
  mean_eta_min      numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  with created as (
    select b.id, (b.created_at at time zone 'Asia/Kolkata')::date as d, b.created_at, b.eta_min, b.status
      from public.bookings b
     where b.created_at >= now() - make_interval(days => p_days)
  ),
  acc as (
    select e.booking_id, min(e.at) as accepted_at
      from public.booking_events e where e.to_status = 'accepted' group by e.booking_id
  ),
  secs as (
    select c.d, extract(epoch from (a.accepted_at - c.created_at)) as s
      from created c join acc a on a.booking_id = c.id
  ),
  off as (
    select (o.offered_at at time zone 'Asia/Kolkata')::date as d,
           count(*)::integer as n, count(*) filter (where o.response = 'accepted')::integer as ok
      from public.offers o
     where o.offered_at >= now() - make_interval(days => p_days)
     group by 1
  )
  select c.d,
         count(*)::integer,
         count(*) filter (where c.status not in ('requested', 'matching', 'offered', 'no_match', 'cancelled'))::integer,
         count(*) filter (where c.status = 'no_match')::integer,
         round((select percentile_cont(0.5) within group (order by s.s) from secs s where s.d = c.d)::numeric, 1),
         round((select percentile_cont(0.9) within group (order by s.s) from secs s where s.d = c.d)::numeric, 1),
         coalesce((select o.n from off o where o.d = c.d), 0),
         coalesce((select o.ok from off o where o.d = c.d), 0),
         round(avg(c.eta_min)::numeric, 1)
    from created c
   group by c.d
   order by c.d;
end $$;

-- Gini coefficient of accepted jobs per active workshop over the last p_days days (0 = even, 1 = one shop gets everything)
create function public.jobs_gini(p_days integer default 14) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  n integer;
  total numeric;
  weighted numeric;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  with jobs as (
    select w.id, count(b.id) filter (where b.status in ('accepted','in_progress','completed','paid','reviewed')
                                      and b.created_at >= now() - make_interval(days => p_days)) as j
      from public.workshops w left join public.bookings b on b.workshop_id = w.id
     where w.stage in ('probation', 'active')
     group by w.id
  ),
  ranked as (select j, row_number() over (order by j) as i from jobs)
  select count(*), coalesce(sum(j), 0), coalesce(sum(j * i), 0) into n, total, weighted from ranked;
  if n = 0 or total = 0 then
    return 0;
  end if;
  return round((2 * weighted) / (n * total) - (n + 1)::numeric / n, 4);
end $$;

-- the live board: everything not finished
create function public.admin_live_bookings()
returns table (
  id uuid, ref text, status public.booking_status, created_at timestamptz,
  service text, workshop text, lat double precision, lng double precision, miss_count integer
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select b.id, b.ref, b.status, b.created_at, s.name, w.name, b.pickup_lat, b.pickup_lng, b.miss_count
    from public.bookings b
    join public.services s on s.id = b.service_id
    left join public.workshops w on w.id = b.workshop_id
   where b.status in ('requested', 'matching', 'offered', 'accepted', 'in_progress', 'no_match')
   order by b.created_at desc
   limit 300;
end $$;

-- demand per H3 cell for the next 7 days, from the nightly forecast
create function public.admin_demand_heatmap()
returns table (h3_cell text, total_yhat real, total_hi real)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select f.h3_cell, sum(f.yhat)::real, sum(f.yhat_hi)::real
    from public.demand_forecasts f
   where f.hour_ts >= now() and f.hour_ts < now() + interval '7 days'
   group by f.h3_cell;
end $$;

-- busiest hours next week, for the mechanic's insights strip (city-wide, not sensitive)
create function public.busy_hours_next_week()
returns table (hour_of_day integer, expected real)
language sql stable security definer set search_path = public as $$
  select extract(hour from f.hour_ts at time zone 'Asia/Kolkata')::integer, (sum(f.yhat) / 7)::real
    from public.demand_forecasts f
   where f.hour_ts >= now() and f.hour_ts < now() + interval '7 days'
   group by 1
   order by 1
$$;

-- a workshop's earnings, from the ledger and its reviews
create function public.my_workshop_summary()
returns table (
  workshop_id uuid, rating numeric, review_count integer, jobs_30d integer,
  earned_30d numeric, owed numeric, active_strikes integer, stage public.workshop_stage
) language sql stable security definer set search_path = public as $$
  select w.id,
         case when w.rating_count >= 5 then round(w.rating_sum::numeric / w.rating_count, 2) end,
         w.rating_count,
         (select count(*)::integer from public.bookings b
           where b.workshop_id = w.id and b.created_at >= now() - interval '30 days'
             and b.status in ('completed', 'paid', 'reviewed')),
         coalesce((select -sum(e.amount) from public.ledger_entries e
                    where e.workshop_id = w.id and e.account = 'workshop_payable' and e.kind = 'payment'
                      and e.at >= now() - interval '30 days'), 0),
         public.workshop_balance(w.id),
         public.active_strikes(w.id),
         w.stage
    from public.workshops w
   where w.owner_id = auth.uid()
$$;

-- Pilot report: write the real column of pilot_metrics from booking_events and friends.
-- Confidence intervals are added by the reporting script (bootstrap), not here.
create function public.compute_pilot_metrics(p_period text, p_from timestamptz, p_to timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  v numeric;
  c integer;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' and not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  -- time to assign (median), seconds
  select percentile_cont(0.5) within group (order by extract(epoch from (a.at - r.at))), count(*)
    into v, c
    from public.booking_events r
    join public.booking_events a on a.booking_id = r.booking_id and a.to_status = 'accepted'
   where r.to_status = 'requested' and r.at >= p_from and r.at < p_to;
  if c > 0 then
    insert into public.pilot_metrics (metric, source, period, value, n)
    values ('time_to_assign_median_s', 'real', p_period, v, c)
    on conflict (metric, source, period) do update set value = excluded.value, n = excluded.n;
    n := n + 1;
  end if;

  select percentile_cont(0.9) within group (order by extract(epoch from (a.at - r.at))), count(*)
    into v, c
    from public.booking_events r
    join public.booking_events a on a.booking_id = r.booking_id and a.to_status = 'accepted'
   where r.to_status = 'requested' and r.at >= p_from and r.at < p_to;
  if c > 0 then
    insert into public.pilot_metrics (metric, source, period, value, n)
    values ('time_to_assign_p90_s', 'real', p_period, v, c)
    on conflict (metric, source, period) do update set value = excluded.value, n = excluded.n;
    n := n + 1;
  end if;

  -- offer acceptance rate
  select count(*) filter (where response = 'accepted')::numeric / nullif(count(*), 0), count(*)
    into v, c from public.offers where offered_at >= p_from and offered_at < p_to and response <> 'pending';
  if c > 0 then
    insert into public.pilot_metrics (metric, source, period, value, n)
    values ('offer_acceptance_rate', 'real', p_period, v, c)
    on conflict (metric, source, period) do update set value = excluded.value, n = excluded.n;
    n := n + 1;
  end if;

  -- no-match rate
  select count(*) filter (where status = 'no_match')::numeric / nullif(count(*), 0), count(*)
    into v, c from public.bookings where created_at >= p_from and created_at < p_to;
  if c > 0 then
    insert into public.pilot_metrics (metric, source, period, value, n)
    values ('no_match_rate', 'real', p_period, v, c)
    on conflict (metric, source, period) do update set value = excluded.value, n = excluded.n;
    n := n + 1;
  end if;

  -- duration model error vs the catalogue, on completed jobs
  select avg(abs(extract(epoch from (b.completed_at - b.started_at)) / 60 - b.predicted_duration_min)), count(*)
    into v, c from public.bookings b
   where b.completed_at is not null and b.started_at is not null and b.predicted_duration_min is not null
     and b.created_at >= p_from and b.created_at < p_to;
  if c > 0 then
    insert into public.pilot_metrics (metric, source, period, value, n)
    values ('duration_mae_min', 'real', p_period, v, c)
    on conflict (metric, source, period) do update set value = excluded.value, n = excluded.n;
    n := n + 1;
  end if;

  -- share of final prices inside the quoted range
  select avg((final_price between quote_low and quote_high)::int), count(*)
    into v, c from public.bookings
   where final_price is not null and created_at >= p_from and created_at < p_to;
  if c > 0 then
    insert into public.pilot_metrics (metric, source, period, value, n)
    values ('price_inside_quote_band', 'real', p_period, v, c)
    on conflict (metric, source, period) do update set value = excluded.value, n = excluded.n;
    n := n + 1;
  end if;

  -- payment confirmation time (median, seconds)
  select percentile_cont(0.5) within group (order by extract(epoch from (p.confirmed_at - b.completed_at))), count(*)
    into v, c from public.payments p join public.bookings b on b.id = p.booking_id
   where p.status in ('confirmed', 'refunded') and b.completed_at >= p_from and b.completed_at < p_to;
  if c > 0 then
    insert into public.pilot_metrics (metric, source, period, value, n)
    values ('payment_confirmation_median_s', 'real', p_period, v, c)
    on conflict (metric, source, period) do update set value = excluded.value, n = excluded.n;
    n := n + 1;
  end if;

  -- disputes per 100 bookings
  select (select count(*) from public.disputes d where d.opened_at >= p_from and d.opened_at < p_to)::numeric * 100
         / nullif(count(*), 0), count(*)
    into v, c from public.bookings where created_at >= p_from and created_at < p_to;
  if c > 0 then
    insert into public.pilot_metrics (metric, source, period, value, n)
    values ('disputes_per_100_bookings', 'real', p_period, v, c)
    on conflict (metric, source, period) do update set value = excluded.value, n = excluded.n;
    n := n + 1;
  end if;

  -- mean customer rating
  select avg(rating), count(*) into v, c from public.reviews
   where not hidden and created_at >= p_from and created_at < p_to;
  if c > 0 then
    insert into public.pilot_metrics (metric, source, period, value, n)
    values ('customer_rating_mean', 'real', p_period, v, c)
    on conflict (metric, source, period) do update set value = excluded.value, n = excluded.n;
    n := n + 1;
  end if;

  return n;
end $$;

revoke execute on function
  public.admin_kpis(integer), public.jobs_gini(integer), public.admin_live_bookings(),
  public.admin_demand_heatmap(), public.compute_pilot_metrics(text, timestamptz, timestamptz)
from public, anon;
revoke execute on function public.busy_hours_next_week(), public.my_workshop_summary() from public, anon;

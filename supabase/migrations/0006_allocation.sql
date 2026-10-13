-- 0006: candidate retrieval, offers and the offer cascade.

-- is the workshop open at this instant? open_hours is {"mon":["09:00","19:00"], ...} in IST.
create function public.workshop_open_at(p_hours jsonb, p_at timestamptz) returns boolean
language plpgsql immutable as $$
declare
  local_ts  timestamp := p_at at time zone 'Asia/Kolkata';
  day_key   text := lower(to_char(local_ts, 'dy'));
  win       jsonb := p_hours -> day_key;
  t_open    time;
  t_close   time;
begin
  if win is null or jsonb_typeof(win) <> 'array' or jsonb_array_length(win) < 2 then
    return false;
  end if;
  t_open  := (win ->> 0)::time;
  t_close := (win ->> 1)::time;
  return local_ts::time >= t_open and local_ts::time < t_close;
end $$;

-- Hard filters, all in one query (plan 4.1). Scoring happens in the API.
create function public.find_candidates(
  p_booking   uuid,
  p_radius_km numeric,
  p_limit     integer default 20
) returns table (
  workshop_id       uuid,
  name              text,
  lat               double precision,
  lng               double precision,
  distance_km       double precision,
  staff_count       integer,
  active_jobs       integer,
  rating_sum        integer,
  rating_count      integer,
  jobs_today        integer,
  offers_30d        integer,
  accepted_30d      integer,
  price_override    numeric
)
language sql stable as $$
  with b as (
    select bk.id, bk.service_id, bk.mode, bk.pickup_lat, bk.pickup_lng,
           coalesce(bk.scheduled_for, now()) as at_time,
           vm.kind as vkind
      from public.bookings bk
      join public.vehicles v on v.id = bk.vehicle_id
      join public.vehicle_models vm on vm.id = v.model_id
     where bk.id = p_booking
  ),
  near as (
    select w.*, public.haversine_km(w.lat, w.lng, b.pickup_lat, b.pickup_lng) as dist,
           ws.price_override, b.mode, b.at_time
      from public.workshops w
      cross join b
      join public.workshop_services ws
        on ws.workshop_id = w.id and ws.service_id = b.service_id and not ws.is_paused
     where w.is_active
       and b.vkind = any (w.vehicle_kinds)
       -- cheap bounding box first: 1 degree of latitude is about 111 km
       and abs(w.lat - b.pickup_lat) <= p_radius_km / 111.0
       and abs(w.lng - b.pickup_lng) <= p_radius_km / (111.0 * greatest(cos(radians(b.pickup_lat)), 0.01))
       and public.workshop_open_at(w.open_hours, b.at_time)
       -- a shop that already turned this booking down (or let it expire) is not asked again
       and not exists (select 1 from public.offers o where o.booking_id = p_booking and o.workshop_id = w.id)
  ),
  load as (
    select n.id as wid,
           coalesce((select count(*) from public.bookings x
                      where x.workshop_id = n.id and x.status in ('accepted', 'in_progress')), 0)
         + coalesce((select count(*) from public.offers o
                      where o.workshop_id = n.id and o.response = 'pending'), 0) as active
      from near n
  )
  select n.id, n.name, n.lat, n.lng, n.dist, n.staff_count,
         l.active::integer,
         n.rating_sum, n.rating_count,
         (select count(*)::integer from public.offers o
           where o.workshop_id = n.id and o.response = 'accepted'
             and o.responded_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
         (select count(*)::integer from public.offers o
           where o.workshop_id = n.id and o.offered_at >= now() - interval '30 days'),
         (select count(*)::integer from public.offers o
           where o.workshop_id = n.id and o.offered_at >= now() - interval '30 days'
             and o.response = 'accepted'),
         n.price_override
    from near n
    join load l on l.wid = n.id
   where n.dist <= p_radius_km
     and l.active < n.staff_count
     and (n.mode = 'workshop' or (n.offers_doorstep and n.dist <= n.service_radius_km))
   order by n.dist
   limit p_limit
$$;

-- ---------------------------------------------------------------------------
-- offers
-- ---------------------------------------------------------------------------
create function public.create_offer(
  p_booking     uuid,
  p_workshop    uuid,
  p_score       numeric,
  p_rank        integer,
  p_features    jsonb   default '{}'::jsonb,
  p_eta_min     integer default null,
  p_distance_km numeric default null,
  p_ttl_seconds integer default 90
) returns public.offers
language plpgsql as $$
declare
  b public.bookings;
  w public.workshops;
  o public.offers;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'booking not found';
  end if;
  if b.status <> 'matching' then
    raise exception 'booking is % and cannot be offered', b.status;
  end if;

  -- lock the workshop so concurrent dispatches see each other's pending offers
  select * into w from public.workshops where id = p_workshop for update;
  if not found or not w.is_active then
    raise exception 'workshop not available';
  end if;
  if public.workshop_active_jobs(w.id)
     + (select count(*) from public.offers where workshop_id = w.id and response = 'pending')
     >= w.staff_count then
    raise exception 'workshop is at capacity';
  end if;

  insert into public.offers (booking_id, workshop_id, score, rank, features, expires_at)
  values (p_booking, p_workshop, p_score, p_rank, p_features,
          now() + make_interval(secs => p_ttl_seconds))
  returning * into o;

  update public.bookings
     set workshop_id = p_workshop, eta_min = p_eta_min, distance_km = p_distance_km
   where id = p_booking;

  perform public.transition_booking(p_booking, 'offered', null, 'system',
                                    jsonb_build_object('offer_id', o.id, 'rank', p_rank));

  -- the 90 s timer is a delayed job, not an in-memory timeout
  perform public.enqueue_job('realtime', 'offer.timeout',
                             jsonb_build_object('offer_id', o.id, 'booking_id', p_booking),
                             'offer:' || o.id || ':timeout', o.expires_at);
  return o;
end $$;

-- Accept, reject or expire an offer. Idempotent: answering twice is a no-op.
create function public.respond_offer(
  p_offer      uuid,
  p_response   public.offer_response,
  p_actor      uuid default null,
  p_actor_role text default 'system'
) returns public.offers
language plpgsql as $$
declare
  o       public.offers;
  b       public.bookings;
  w       public.workshops;
  effective public.offer_response := p_response;
begin
  if p_response = 'pending' then
    raise exception 'cannot respond with pending';
  end if;

  select * into o from public.offers where id = p_offer for update;
  if not found then
    raise exception 'offer not found';
  end if;
  if o.response <> 'pending' then
    return o;
  end if;

  select * into w from public.workshops where id = o.workshop_id;
  if p_actor_role = 'mechanic' and w.owner_id is distinct from p_actor then
    raise exception 'not your offer' using errcode = '42501';
  end if;
  if p_actor_role = 'system' and p_response <> 'expired' then
    raise exception 'the system can only expire offers';
  end if;
  if p_response = 'expired' and p_actor_role not in ('system', 'admin') then
    raise exception 'only the system can expire an offer' using errcode = '42501';
  end if;

  select * into b from public.bookings where id = o.booking_id for update;

  if p_response = 'accepted' then
    if b.status <> 'offered' or b.workshop_id is distinct from o.workshop_id then
      raise exception 'offer is no longer open';
    end if;
    -- capacity may have changed since the offer went out; if so it counts as a miss
    if public.workshop_active_jobs(w.id) >= w.staff_count then
      effective := 'expired';
    end if;
  end if;

  update public.offers
     set response = effective, responded_at = now()
   where id = o.id
  returning * into o;

  if effective = 'accepted' then
    perform public.transition_booking(b.id, 'accepted', p_actor,
                                      case when p_actor_role = 'admin' then 'admin' else 'mechanic' end,
                                      jsonb_build_object('offer_id', o.id));
  else
    update public.bookings set miss_count = miss_count + 1 where id = b.id;
    if b.status = 'offered' then
      perform public.transition_booking(b.id, 'matching', null, 'system',
                                        jsonb_build_object('offer_id', o.id, 'reason', effective));
      perform public.enqueue_job('realtime', 'dispatch.booking',
                                 jsonb_build_object('booking_id', b.id),
                                 'booking:' || b.id || ':dispatch:' || (b.miss_count + 1));
    end if;
  end if;
  return o;
end $$;

-- safety net run by pg_cron every minute; the delayed job normally gets there first
create function public.expire_stale_offers() returns integer
language plpgsql as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.offers where response = 'pending' and expires_at < now() - interval '5 seconds'
  loop
    perform public.respond_offer(r.id, 'expired', null, 'system');
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.set_search_radius(p_booking uuid, p_radius integer) returns void
language sql as $$
  update public.bookings set search_radius_km = p_radius
   where id = p_booking and p_radius > search_radius_km;
$$;

-- bookings that have been searching with no offer out (for the batch assigner)
create function public.bookings_waiting() returns table (id uuid, pickup_lat double precision, pickup_lng double precision)
language sql stable as $$
  select b.id, b.pickup_lat, b.pickup_lng
    from public.bookings b
   where b.status = 'matching'
     and not exists (select 1 from public.offers o where o.booking_id = b.id and o.response = 'pending')
$$;

revoke execute on function
  public.find_candidates(uuid, numeric, integer),
  public.create_offer(uuid, uuid, numeric, integer, jsonb, integer, numeric, integer),
  public.respond_offer(uuid, public.offer_response, uuid, text),
  public.expire_stale_offers(),
  public.set_search_radius(uuid, integer),
  public.bookings_waiting()
from public, anon, authenticated;

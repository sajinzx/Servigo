-- 0003: business rules that must hold no matter which code path touches a booking.

create function public.gst_rate() returns numeric
language sql immutable as $$ select 0.18::numeric $$;

create function public.haversine_km(lat1 double precision, lng1 double precision,
                                    lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 2 * 6371.0088 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- ---------------------------------------------------------------------------
-- allowed status moves
-- ---------------------------------------------------------------------------
insert into public.booking_transitions (from_status, to_status, actors) values
  ('requested', 'matching',  '{system}'),
  ('requested', 'cancelled', '{customer,admin}'),
  ('matching',  'offered',   '{system}'),
  ('matching',  'no_match',  '{system}'),
  ('matching',  'cancelled', '{customer,admin}'),
  ('offered',   'accepted',  '{mechanic,admin}'),
  ('offered',   'matching',  '{system}'),
  ('offered',   'cancelled', '{customer,admin}'),
  ('accepted',  'in_progress', '{mechanic,admin}'),
  ('accepted',  'cancelled', '{customer,mechanic,admin}'),
  ('accepted',  'matching',  '{system,admin}'),
  ('in_progress', 'completed', '{mechanic,admin}'),
  ('in_progress', 'cancelled', '{admin}'),
  ('completed', 'payment_pending_verification', '{customer,admin}'),
  ('completed', 'paid',      '{mechanic,admin,system}'),
  ('payment_pending_verification', 'paid',      '{mechanic,admin,system}'),
  ('payment_pending_verification', 'completed', '{admin,system}'),
  ('paid',      'reviewed',  '{customer}'),
  ('completed', 'disputed',  '{customer,admin}'),
  ('paid',      'disputed',  '{customer,admin}'),
  ('reviewed',  'disputed',  '{customer,admin}'),
  ('disputed',  'paid',      '{admin}'),
  ('disputed',  'refunded',  '{admin}'),
  ('disputed',  'completed', '{admin}'),
  ('disputed',  'reviewed',  '{admin}'),
  ('completed', 'refunded',  '{admin}'),
  ('paid',      'refunded',  '{admin}'),
  ('reviewed',  'refunded',  '{admin}');

-- ---------------------------------------------------------------------------
-- queue helper
-- ---------------------------------------------------------------------------
create function public.enqueue_job(
  p_queue text, p_event_type text, p_payload jsonb, p_key text,
  p_run_at timestamptz default now()
) returns void language sql as $$
  insert into public.outbox (queue, event_type, payload, idempotency_key, next_run_at)
  values (p_queue, p_event_type, p_payload, p_key, p_run_at)
  on conflict (idempotency_key) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- capacity
-- ---------------------------------------------------------------------------
create function public.workshop_active_jobs(p_workshop_id uuid) returns integer
language sql stable as $$
  select count(*)::integer from public.bookings
  where workshop_id = p_workshop_id and status in ('accepted', 'in_progress')
$$;

-- ---------------------------------------------------------------------------
-- the one place a booking's status changes
-- ---------------------------------------------------------------------------
create function public.transition_booking(
  p_booking_id uuid,
  p_to         public.booking_status,
  p_actor_id   uuid  default null,
  p_actor_role text  default 'system',
  p_meta       jsonb default '{}'::jsonb
) returns public.bookings
language plpgsql as $$
declare
  b        public.bookings;
  allowed  text[];
  w        public.workshops;
  owner    uuid;
  ev_id    bigint;
  q_name   text;
  prev_status public.booking_status;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking % not found', p_booking_id;
  end if;
  prev_status := b.status;

  select actors into allowed from public.booking_transitions
   where from_status = b.status and to_status = p_to;
  if not found then
    raise exception 'illegal transition % -> %', b.status, p_to;
  end if;

  -- a frozen booking (safety or damage report) only moves by an admin decision
  if b.frozen and p_actor_role <> 'admin' then
    raise exception 'booking is frozen pending an admin review' using errcode = '42501';
  end if;

  if not (p_actor_role = any (allowed)) then
    raise exception 'role % cannot move a booking from % to %', p_actor_role, b.status, p_to
      using errcode = '42501';
  end if;

  -- ownership: a customer only moves their own booking, a mechanic only the
  -- bookings of their own workshop
  if p_actor_role = 'customer' and b.customer_id is distinct from p_actor_id then
    raise exception 'not your booking' using errcode = '42501';
  end if;
  if p_actor_role = 'mechanic' then
    select owner_id into owner from public.workshops where id = b.workshop_id;
    if owner is null or owner is distinct from p_actor_id then
      raise exception 'not your workshop''s booking' using errcode = '42501';
    end if;
  end if;

  if p_to = 'accepted' then
    if b.workshop_id is null then
      raise exception 'booking has no workshop to accept it';
    end if;
    -- lock the workshop row so two accepts cannot both take the last slot
    select * into w from public.workshops where id = b.workshop_id for update;
    if public.workshop_active_jobs(w.id) >= w.staff_count then
      raise exception 'workshop is at capacity (% of % staff busy)',
        public.workshop_active_jobs(w.id), w.staff_count;
    end if;
  end if;

  if p_to = 'completed' and (b.labour_amount is null or b.final_price is null) then
    raise exception 'completed needs a final price; use complete_booking()';
  end if;

  if p_to = 'disputed' and p_actor_role = 'customer'
     and b.completed_at is not null and now() - b.completed_at > interval '72 hours' then
    raise exception 'the 72 hour dispute window has closed';
  end if;

  if p_to in ('paid', 'payment_pending_verification')
     and b.needs_price_approval and b.price_approved_at is null then
    raise exception 'customer must approve the final price before payment';
  end if;

  update public.bookings set
    status       = p_to,
    started_at   = case when p_to = 'in_progress' then now() else started_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    workshop_id  = case when p_to in ('matching', 'no_match') then null else workshop_id end,
    cancelled_reason = case when p_to = 'cancelled' then p_meta ->> 'reason' else cancelled_reason end,
    updated_at   = now()
  where id = b.id
  returning * into b;

  insert into public.booking_events (booking_id, from_status, to_status, actor_id, actor_role, meta)
  values (b.id, prev_status, p_to, p_actor_id, p_actor_role, p_meta)
  returning id into ev_id;

  q_name := case when p_to in ('offered', 'accepted', 'matching') then 'realtime' else 'notify' end;
  perform public.enqueue_job(
    q_name, 'booking.status_changed',
    jsonb_build_object('booking_id', b.id, 'ref', b.ref, 'status', p_to, 'from', prev_status,
                       'customer_id', b.customer_id, 'workshop_id', b.workshop_id),
    'booking:' || b.id || ':' || p_to || ':' || ev_id
  );

  return b;
end $$;

-- ---------------------------------------------------------------------------
-- create a booking (price band is computed by the API, never taken from a client)
-- ---------------------------------------------------------------------------
create function public.create_booking(
  p_customer uuid, p_vehicle uuid, p_service uuid, p_mode public.booking_mode,
  p_lat double precision, p_lng double precision, p_scheduled_for timestamptz,
  p_symptom text, p_quote_low numeric, p_quote_high numeric, p_predicted_duration integer
) returns public.bookings
language plpgsql as $$
declare
  v_kind public.vehicle_kind;
  s_kind public.vehicle_kind;
  b      public.bookings;
begin
  select vm.kind into v_kind
    from public.vehicles v join public.vehicle_models vm on vm.id = v.model_id
   where v.id = p_vehicle and v.owner_id = p_customer;
  if not found then
    raise exception 'vehicle not found for this customer' using errcode = '42501';
  end if;

  select vehicle_kind into s_kind from public.services where id = p_service and is_active;
  if not found then
    raise exception 'service not available';
  end if;
  if s_kind <> v_kind then
    raise exception 'a % service cannot be booked for a % vehicle', s_kind, v_kind;
  end if;

  insert into public.bookings (customer_id, vehicle_id, service_id, mode, pickup_lat, pickup_lng,
                               scheduled_for, symptom_text, quote_low, quote_high,
                               predicted_duration_min)
  values (p_customer, p_vehicle, p_service, p_mode, p_lat, p_lng, p_scheduled_for,
          p_symptom, p_quote_low, p_quote_high, p_predicted_duration)
  returning * into b;

  insert into public.booking_events (booking_id, from_status, to_status, actor_id, actor_role)
  values (b.id, null, 'requested', p_customer, 'customer');

  b := public.transition_booking(b.id, 'matching', null, 'system', '{}'::jsonb);

  -- allocation is a durable job, queued in this same transaction
  perform public.enqueue_job('realtime', 'dispatch.booking',
                             jsonb_build_object('booking_id', b.id), 'booking:' || b.id || ':dispatch:0');
  return b;
end $$;

-- ---------------------------------------------------------------------------
-- completion with a server-computed GST-inclusive price
-- ---------------------------------------------------------------------------
create function public.complete_booking(
  p_booking_id uuid, p_actor_id uuid, p_actor_role text, p_labour numeric, p_parts numeric
) returns public.bookings
language plpgsql as $$
declare
  b     public.bookings;
  total numeric;
begin
  if p_labour is null or p_labour < 0 or coalesce(p_parts, 0) < 0 then
    raise exception 'labour and parts must be zero or more';
  end if;
  total := round((p_labour + coalesce(p_parts, 0)) * (1 + public.gst_rate()), 2);

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking % not found', p_booking_id;
  end if;

  update public.bookings set
    labour_amount = p_labour,
    parts_amount  = coalesce(p_parts, 0),
    final_price   = total,
    -- more than 15% over the top of the quote needs the customer's say-so
    needs_price_approval = total > quote_high * 1.15,
    price_approved_at    = null
  where id = p_booking_id;

  return public.transition_booking(p_booking_id, 'completed', p_actor_id, p_actor_role,
                                   jsonb_build_object('final_price', total));
end $$;

create function public.approve_price(p_booking_id uuid, p_customer uuid)
returns public.bookings language plpgsql as $$
declare b public.bookings;
begin
  update public.bookings
     set price_approved_at = now(), updated_at = now()
   where id = p_booking_id and customer_id = p_customer
     and needs_price_approval and status in ('completed', 'payment_pending_verification')
  returning * into b;
  if not found then
    raise exception 'nothing to approve' using errcode = '42501';
  end if;
  return b;
end $$;

-- ---------------------------------------------------------------------------
-- reviews: one per paid booking, by its customer; workshop rating is derived
-- ---------------------------------------------------------------------------
create function public.submit_review(
  p_booking_id uuid, p_customer uuid, p_rating integer, p_comment text
) returns public.reviews language plpgsql as $$
declare
  b public.bookings;
  r public.reviews;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.customer_id <> p_customer then
    raise exception 'booking not found' using errcode = '42501';
  end if;
  if b.status <> 'paid' then
    raise exception 'only a paid booking can be reviewed (it is %)', b.status;
  end if;

  insert into public.reviews (booking_id, customer_id, workshop_id, rating, comment)
  values (b.id, p_customer, b.workshop_id, p_rating, p_comment)
  returning * into r;

  perform public.transition_booking(b.id, 'reviewed', p_customer, 'customer', '{}'::jsonb);
  return r;
end $$;

create function public.reviews_rating_sync() returns trigger language plpgsql as $$
declare
  delta_sum integer := 0;
  delta_cnt integer := 0;
  ws        uuid;
begin
  if tg_op = 'INSERT' then
    ws := new.workshop_id;
    if not new.hidden then delta_sum := new.rating; delta_cnt := 1; end if;
  elsif tg_op = 'DELETE' then
    ws := old.workshop_id;
    if not old.hidden then delta_sum := -old.rating; delta_cnt := -1; end if;
  else
    ws := new.workshop_id;
    if not old.hidden then delta_sum := delta_sum - old.rating; delta_cnt := delta_cnt - 1; end if;
    if not new.hidden then delta_sum := delta_sum + new.rating; delta_cnt := delta_cnt + 1; end if;
  end if;

  update public.workshops
     set rating_sum = rating_sum + delta_sum, rating_count = rating_count + delta_cnt
   where id = ws;
  return null;
end $$;

create trigger reviews_rating_sync
  after insert or update or delete on public.reviews
  for each row execute function public.reviews_rating_sync();

-- ratings are derived data: nobody edits them directly
create function public.workshops_guard() returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' and (
       new.rating_sum is distinct from old.rating_sum or
       new.rating_count is distinct from old.rating_count or
       new.owner_id is distinct from old.owner_id or
       new.is_demo is distinct from old.is_demo) then
    raise exception 'ratings and ownership cannot be edited directly' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger workshops_guard
  before update on public.workshops
  for each row execute function public.workshops_guard();

-- ---------------------------------------------------------------------------
-- who may call what: writes go through the API (service role) only
-- ---------------------------------------------------------------------------
revoke execute on function
  public.transition_booking(uuid, public.booking_status, uuid, text, jsonb),
  public.create_booking(uuid, uuid, uuid, public.booking_mode, double precision, double precision,
                        timestamptz, text, numeric, numeric, integer),
  public.complete_booking(uuid, uuid, text, numeric, numeric),
  public.approve_price(uuid, uuid),
  public.submit_review(uuid, uuid, integer, text),
  public.enqueue_job(text, text, jsonb, text, timestamptz)
from public, anon, authenticated;

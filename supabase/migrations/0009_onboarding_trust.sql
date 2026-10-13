-- 0009: workshop onboarding pipeline and trust & safety rules (plan sections 9.2, 9.3).
-- The rules are deterministic and live here so they apply the same way every time.

-- ---------------------------------------------------------------------------
-- workshop verification state
-- ---------------------------------------------------------------------------
create type public.workshop_stage as enum ('applied', 'review', 'probation', 'active', 'suspended');

alter table public.workshops
  add column stage            public.workshop_stage not null default 'applied',
  add column verified_at      timestamptz,
  add column completed_jobs   integer not null default 0,
  add column suspended_until  timestamptz,
  add column suspension_reason text,
  add column low_acceptance   boolean not null default false,
  add column gst_registered   boolean not null default false;

-- the verification and rating columns are never edited by the workshop itself
create or replace function public.workshops_guard() returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    if new.rating_sum is distinct from old.rating_sum
       or new.rating_count is distinct from old.rating_count
       or new.owner_id is distinct from old.owner_id
       or new.is_demo is distinct from old.is_demo
       or new.stage is distinct from old.stage
       or new.verified_at is distinct from old.verified_at
       or new.completed_jobs is distinct from old.completed_jobs
       or new.suspended_until is distinct from old.suspended_until
       or new.low_acceptance is distinct from old.low_acceptance then
      raise exception 'ratings, ownership and verification cannot be edited directly'
        using errcode = '42501';
    end if;
    -- moving the shop sends it back to review before it can get jobs again
    if (new.lat is distinct from old.lat or new.lng is distinct from old.lng)
       and old.stage in ('probation', 'active') then
      new.stage := 'review';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- who may receive an offer right now (single source of truth for eligibility)
-- ---------------------------------------------------------------------------
create function public.workshop_may_receive(
  p_workshop uuid, p_dist_km double precision, p_at timestamptz default now()
) returns boolean language sql stable as $$
  select w.is_active
     and w.stage in ('probation', 'active')
     and (w.suspended_until is null or w.suspended_until < p_at)
     -- probation: only nearby, at most 2 jobs a day
     and (w.stage <> 'probation' or (
           p_dist_km <= 5
           and (select count(*) from public.offers o
                 where o.workshop_id = w.id and o.response = 'accepted'
                   and o.responded_at >= date_trunc('day', now() at time zone 'Asia/Kolkata')
                                         at time zone 'Asia/Kolkata') < 2))
    from public.workshops w
   where w.id = p_workshop
$$;

-- find_candidates, now with the eligibility rule and the low-acceptance flag
-- (the return type changes, so the function is dropped and recreated)
drop function public.find_candidates(uuid, numeric, integer);

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
  price_override    numeric,
  low_acceptance    boolean
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
     where b.vkind = any (w.vehicle_kinds)
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
         n.price_override,
         n.low_acceptance
    from near n
    join load l on l.wid = n.id
   where n.dist <= p_radius_km
     and l.active < n.staff_count
     and (n.mode = 'workshop' or (n.offers_doorstep and n.dist <= n.service_radius_km))
     and public.workshop_may_receive(n.id, n.dist, n.at_time)
   order by n.dist
   limit p_limit
$$;

-- a probation workshop that completes 10 jobs becomes active
create function public.bookings_job_completed() returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.workshop_id is not null then
    update public.workshops
       set completed_jobs = completed_jobs + 1,
           stage = case when stage = 'probation' and completed_jobs + 1 >= 10 then 'active' else stage end
     where id = new.workshop_id;
  end if;
  return null;
end $$;

create trigger bookings_job_completed
  after update of status on public.bookings
  for each row execute function public.bookings_job_completed();

-- ---------------------------------------------------------------------------
-- application pipeline
-- ---------------------------------------------------------------------------
create type public.application_stage as enum ('applied', 'documents', 'review', 'approved', 'rejected');
create type public.document_kind as enum
  ('owner_id', 'shop_photo_outside', 'shop_photo_bay', 'gstin', 'pan', 'bank', 'upi');

create table public.workshop_applications (
  id            uuid primary key default gen_random_uuid(),
  applicant_id  uuid not null references public.profiles (id) on delete cascade,
  shop_name     text not null,
  owner_name    text not null,
  phone         text not null,
  city          text not null,
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  service_ids   uuid[] not null default '{}',
  staff_count   integer not null check (staff_count > 0),
  open_hours    jsonb,
  stage         public.application_stage not null default 'applied',
  reviewer_id   uuid references public.profiles (id),
  decision_reason text,
  review_due_at timestamptz,
  workshop_id   uuid references public.workshops (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index applications_one_open_per_applicant
  on public.workshop_applications (applicant_id) where stage in ('applied', 'documents', 'review');
create index applications_stage_idx on public.workshop_applications (stage, review_due_at);

create table public.workshop_documents (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.workshop_applications (id) on delete cascade,
  kind           public.document_kind not null,
  storage_path   text,
  number         text,
  created_at     timestamptz not null default now(),
  unique (application_id, kind)
);

create table public.kyc_checks (
  id             bigserial primary key,
  application_id uuid not null references public.workshop_applications (id) on delete cascade,
  check_name     text not null,
  passed         boolean not null,
  blocking       boolean not null default true,
  detail         jsonb not null default '{}'::jsonb,
  at             timestamptz not null default now()
);
create index kyc_checks_application_idx on public.kyc_checks (application_id, at);

-- payout destinations: the API encrypts them, the database only ever holds ciphertext
create table public.payout_accounts (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid references public.workshop_applications (id) on delete cascade,
  workshop_id    uuid references public.workshops (id) on delete cascade,
  kind           text not null check (kind in ('upi', 'bank')),
  ciphertext     text not null,
  fingerprint    text not null,
  last4          text not null,
  created_at     timestamptz not null default now()
);
create index payout_accounts_fingerprint_idx on public.payout_accounts (fingerprint);

create function public.create_application(
  p_applicant uuid, p_shop_name text, p_owner_name text, p_phone text, p_city text,
  p_lat double precision, p_lng double precision, p_service_ids uuid[], p_staff integer, p_hours jsonb
) returns public.workshop_applications language plpgsql as $$
declare
  prof public.profiles;
  app  public.workshop_applications;
begin
  select * into prof from public.profiles where id = p_applicant;
  if not found then
    raise exception 'profile not found';
  end if;
  if not prof.phone_verified then
    raise exception 'verify your phone number with an OTP before applying';
  end if;
  if prof.role = 'mechanic' then
    raise exception 'you already have a workshop';
  end if;

  insert into public.workshop_applications
    (applicant_id, shop_name, owner_name, phone, city, lat, lng, service_ids, staff_count, open_hours)
  values (p_applicant, p_shop_name, p_owner_name, p_phone, p_city, p_lat, p_lng,
          coalesce(p_service_ids, '{}'), p_staff, p_hours)
  returning * into app;
  return app;
end $$;

create function public.attach_document(
  p_application uuid, p_applicant uuid, p_kind public.document_kind, p_path text, p_number text
) returns public.workshop_documents language plpgsql as $$
declare d public.workshop_documents;
begin
  perform 1 from public.workshop_applications
   where id = p_application and applicant_id = p_applicant and stage in ('applied', 'documents');
  if not found then
    raise exception 'application not open for documents' using errcode = '42501';
  end if;
  insert into public.workshop_documents (application_id, kind, storage_path, number)
  values (p_application, p_kind, p_path, p_number)
  on conflict (application_id, kind) do update
    set storage_path = excluded.storage_path, number = excluded.number, created_at = now()
  returning * into d;
  update public.workshop_applications set stage = 'documents', updated_at = now()
   where id = p_application and stage = 'applied';
  return d;
end $$;

create function public.record_kyc_check(
  p_application uuid, p_check text, p_passed boolean, p_blocking boolean, p_detail jsonb
) returns void language sql as $$
  insert into public.kyc_checks (application_id, check_name, passed, blocking, detail)
  values (p_application, p_check, p_passed, p_blocking, coalesce(p_detail, '{}'::jsonb));
$$;

-- duplicate detection across applications and workshops
create function public.find_duplicate_applicants(p_application uuid)
returns table (reason text, other_application uuid) language sql stable as $$
  select 'same phone', o.id
    from public.workshop_applications a
    join public.workshop_applications o on o.phone = a.phone and o.id <> a.id
   where a.id = p_application and o.stage <> 'rejected'
  union all
  select 'same payout account', p2.application_id
    from public.payout_accounts p1
    join public.payout_accounts p2 on p2.fingerprint = p1.fingerprint
         and p2.application_id is distinct from p1.application_id
   where p1.application_id = p_application
$$;

create function public.submit_for_review(p_application uuid, p_applicant uuid)
returns public.workshop_applications language plpgsql as $$
declare
  app public.workshop_applications;
  missing text[];
  failed  text[];
begin
  select * into app from public.workshop_applications
   where id = p_application and applicant_id = p_applicant for update;
  if not found then
    raise exception 'application not found' using errcode = '42501';
  end if;
  if app.stage not in ('applied', 'documents') then
    raise exception 'application is already %', app.stage;
  end if;

  select array_agg(t.k::text order by t.ord) into missing
    from unnest(array['owner_id', 'shop_photo_outside', 'shop_photo_bay', 'pan'])
         with ordinality as t(k, ord)
   where not exists (select 1 from public.workshop_documents d
                      where d.application_id = p_application and d.kind::text = t.k);
  if missing is not null then
    raise exception 'missing documents: %', array_to_string(missing, ', ');
  end if;
  if not exists (select 1 from public.workshop_documents d
                  where d.application_id = p_application and d.kind in ('bank', 'upi')) then
    raise exception 'missing documents: a bank account or UPI id for payouts';
  end if;

  -- the latest result of each blocking check must have passed
  select array_agg(c.check_name) into failed
    from (select distinct on (check_name) check_name, passed, blocking
            from public.kyc_checks where application_id = p_application
           order by check_name, id desc) c
   where c.blocking and not c.passed;
  if failed is not null then
    raise exception 'checks failed: %', array_to_string(failed, ', ');
  end if;

  update public.workshop_applications
     set stage = 'review', review_due_at = now() + interval '48 hours', updated_at = now()
   where id = p_application returning * into app;
  return app;
end $$;

create function public.approve_application(p_application uuid, p_admin uuid)
returns public.workshops language plpgsql as $$
declare
  app public.workshop_applications;
  w   public.workshops;
begin
  select * into app from public.workshop_applications where id = p_application for update;
  if not found or app.stage <> 'review' then
    raise exception 'only an application in review can be approved';
  end if;

  insert into public.workshops
    (owner_id, name, phone, city, lat, lng, staff_count, open_hours, stage, verified_at,
     gst_registered, vehicle_kinds)
  values (app.applicant_id, app.shop_name, app.phone, app.city, app.lat, app.lng, app.staff_count,
          coalesce(app.open_hours, '{"mon":["09:00","19:00"],"tue":["09:00","19:00"],"wed":["09:00","19:00"],"thu":["09:00","19:00"],"fri":["09:00","19:00"],"sat":["09:00","19:00"]}'::jsonb),
          'probation', now(),
          exists (select 1 from public.workshop_documents d
                   where d.application_id = app.id and d.kind = 'gstin'),
          coalesce((select array_agg(distinct s.vehicle_kind) from public.services s
                     where s.id = any (app.service_ids)), '{car,bike}'::public.vehicle_kind[]))
  returning * into w;

  insert into public.workshop_services (workshop_id, service_id)
  select w.id, s from unnest(app.service_ids) s;

  update public.payout_accounts set workshop_id = w.id where application_id = app.id;
  update public.profiles set role = 'mechanic' where id = app.applicant_id;
  update public.workshop_applications
     set stage = 'approved', reviewer_id = p_admin, workshop_id = w.id, updated_at = now()
   where id = app.id;

  insert into public.ts_actions (actor_id, workshop_id, action, reason)
  values (p_admin, w.id, 'approve_application', 'moved to probation');
  return w;
end $$;

create function public.reject_application(p_application uuid, p_admin uuid, p_reason text)
returns public.workshop_applications language plpgsql as $$
declare app public.workshop_applications;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;
  update public.workshop_applications
     set stage = 'rejected', reviewer_id = p_admin, decision_reason = p_reason, updated_at = now()
   where id = p_application and stage in ('applied', 'documents', 'review')
  returning * into app;
  if not found then
    raise exception 'application cannot be rejected in its current stage';
  end if;
  insert into public.ts_actions (actor_id, action, reason, ref)
  values (p_admin, 'reject_application', p_reason, jsonb_build_object('application_id', p_application));
  return app;
end $$;

-- ---------------------------------------------------------------------------
-- trust & safety
-- ---------------------------------------------------------------------------
create type public.incident_type as enum
  ('no_show', 'overcharge', 'damage', 'safety', 'off_platform', 'fake_review', 'other');
create type public.incident_status as enum ('open', 'upheld', 'rejected');
create type public.dispute_status  as enum ('open', 'upheld', 'partial', 'rejected');

create table public.incidents (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid references public.bookings (id),
  workshop_id uuid references public.workshops (id),
  reporter_id uuid references public.profiles (id),
  type        public.incident_type not null,
  description text,
  evidence    jsonb not null default '[]'::jsonb,
  status      public.incident_status not null default 'open',
  resolution  text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id)
);
create index incidents_status_idx on public.incidents (status, created_at);

create table public.strikes (
  id           uuid primary key default gen_random_uuid(),
  workshop_id  uuid references public.workshops (id),
  customer_id  uuid references public.profiles (id),
  incident_id  uuid references public.incidents (id),
  kind         text not null,
  reason       text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '90 days',
  revoked_at   timestamptz,
  appealed_at  timestamptz,
  appeal_text  text,
  appeal_outcome text,
  check (workshop_id is not null or customer_id is not null)
);
create index strikes_workshop_idx on public.strikes (workshop_id, created_at);
create index strikes_customer_idx on public.strikes (customer_id, created_at);

create table public.disputes (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id),
  opened_by     uuid not null references public.profiles (id),
  reason        text not null,
  evidence      jsonb not null default '[]'::jsonb,
  status        public.dispute_status not null default 'open',
  refund_amount numeric(10, 2) not null default 0,
  resolution    text,
  return_status public.booking_status,
  opened_at     timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references public.profiles (id)
);
create unique index disputes_one_open_per_booking on public.disputes (booking_id) where status = 'open';

-- every action taken, with who and why
create table public.ts_actions (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  workshop_id uuid,
  customer_id uuid,
  action      text not null,
  reason      text,
  ref         jsonb not null default '{}'::jsonb
);

create function public.active_strikes(p_workshop uuid) returns integer language sql stable as $$
  select count(*)::integer from public.strikes
   where workshop_id = p_workshop and revoked_at is null and expires_at > now()
$$;

create function public.suspend_workshop(p_workshop uuid, p_reason text, p_actor uuid default null)
returns void language plpgsql as $$
declare w public.workshops;
begin
  update public.workshops
     set stage = 'suspended', suspension_reason = p_reason
   where id = p_workshop and stage <> 'suspended'
  returning * into w;
  if not found then
    return;
  end if;
  insert into public.ts_actions (actor_id, workshop_id, action, reason)
  values (p_actor, p_workshop, 'suspend_workshop', p_reason);
  if w.owner_id is not null then
    perform public.enqueue_job('notify', 'ts.notice',
      jsonb_build_object('user_id', w.owner_id,
                         'message', 'Your workshop is suspended pending review: ' || p_reason),
      'ts:suspend:' || p_workshop || ':' || extract(epoch from now())::bigint);
  end if;
end $$;

create function public.add_strike(
  p_workshop uuid, p_customer uuid, p_incident uuid, p_kind text, p_actor uuid, p_reason text
) returns public.strikes language plpgsql as $$
declare
  s public.strikes;
begin
  insert into public.strikes (workshop_id, customer_id, incident_id, kind, reason)
  values (p_workshop, p_customer, p_incident, p_kind, p_reason)
  returning * into s;

  insert into public.ts_actions (actor_id, workshop_id, customer_id, action, reason, ref)
  values (p_actor, p_workshop, p_customer, 'strike', p_reason,
          jsonb_build_object('strike_id', s.id, 'kind', p_kind));

  -- 3 strikes in 90 days: suspended pending review
  if p_workshop is not null and public.active_strikes(p_workshop) >= 3 then
    perform public.suspend_workshop(p_workshop, '3 strikes in 90 days', p_actor);
  end if;
  return s;
end $$;

create function public.customer_requires_prepayment(p_customer uuid) returns boolean
language sql stable as $$
  select count(*) >= 2 from public.strikes
   where customer_id = p_customer and kind in ('no_show', 'fake_utr')
     and revoked_at is null and expires_at > now()
$$;

-- No-show: an accepted job not started within 60 minutes of its scheduled time.
-- The customer is re-matched automatically.
create function public.process_no_shows() returns integer language plpgsql as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select b.id, b.workshop_id
      from public.bookings b
     where b.status = 'accepted' and not b.frozen
       and coalesce(
             b.scheduled_for,
             (select max(e.at) from public.booking_events e
               where e.booking_id = b.id and e.to_status = 'accepted')
             + make_interval(mins => coalesce(b.eta_min, 0))
           ) < now() - interval '60 minutes'
     for update of b skip locked
  loop
    perform public.add_strike(r.workshop_id, null, null, 'no_show', null,
                              'accepted job not started within 60 minutes');
    perform public.transition_booking(r.id, 'matching', null, 'system',
                                      jsonb_build_object('reason', 'workshop_no_show'));
    perform public.enqueue_job('realtime', 'dispatch.booking',
                               jsonb_build_object('booking_id', r.id),
                               'booking:' || r.id || ':noshow:' || extract(epoch from now())::bigint);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Acceptance floor: under 40% over the last 20 offers lowers the allocation score.
create function public.refresh_acceptance_floor() returns integer language plpgsql as $$
declare
  r record;
  changed integer := 0;
begin
  for r in
    select w.id, w.owner_id, w.low_acceptance,
           (select count(*) filter (where x.response = 'accepted')::numeric / nullif(count(*), 0)
              from (select response from public.offers o
                     where o.workshop_id = w.id and o.response <> 'pending'
                     order by o.offered_at desc limit 20) x) as rate,
           (select count(*) from (select 1 from public.offers o
                                   where o.workshop_id = w.id and o.response <> 'pending'
                                   limit 20) y) as n
      from public.workshops w
  loop
    if r.n >= 20 and r.rate < 0.4 and not r.low_acceptance then
      update public.workshops set low_acceptance = true where id = r.id;
      insert into public.ts_actions (workshop_id, action, reason)
      values (r.id, 'acceptance_warning', 'acceptance rate under 40% over the last 20 offers');
      if r.owner_id is not null then
        perform public.enqueue_job('notify', 'ts.notice',
          jsonb_build_object('user_id', r.owner_id,
                             'message', 'Your acceptance rate is below 40%. You will be offered fewer jobs until it improves.'),
          'ts:accept-floor:' || r.id || ':' || to_char(now(), 'YYYYMMDD'));
      end if;
      changed := changed + 1;
    elsif r.low_acceptance and (r.n < 20 or r.rate >= 0.4) then
      update public.workshops set low_acceptance = false where id = r.id;
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end $$;

-- Reports from customers or the system.
create function public.report_incident(
  p_booking uuid, p_reporter uuid, p_type public.incident_type, p_description text, p_evidence jsonb
) returns public.incidents language plpgsql as $$
declare
  b   public.bookings;
  inc public.incidents;
  prior integer;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or (b.customer_id <> p_reporter and not exists (
        select 1 from public.workshops w where w.id = b.workshop_id and w.owner_id = p_reporter)) then
    raise exception 'booking not found' using errcode = '42501';
  end if;

  insert into public.incidents (booking_id, workshop_id, reporter_id, type, description, evidence)
  values (b.id, b.workshop_id, p_reporter, p_type, p_description, coalesce(p_evidence, '[]'::jsonb))
  returning * into inc;

  if p_type in ('damage', 'safety') then
    -- freeze the job; an admin case is opened and must be handled within 24 hours
    update public.bookings set frozen = true where id = b.id;
    insert into public.ts_actions (actor_id, workshop_id, action, reason, ref)
    values (p_reporter, b.workshop_id, 'freeze_booking', p_type::text,
            jsonb_build_object('incident_id', inc.id, 'respond_by', now() + interval '24 hours'));
  elsif p_type = 'off_platform' and b.workshop_id is not null then
    perform public.add_strike(b.workshop_id, null, inc.id, 'off_platform', null,
                              'asked a customer to pay outside the app');
    select count(*) into prior from public.strikes
     where workshop_id = b.workshop_id and kind = 'off_platform' and revoked_at is null;
    if prior >= 2 then
      perform public.suspend_workshop(b.workshop_id, 'repeated off-platform payment requests', null);
    end if;
  end if;
  return inc;
end $$;

create function public.resolve_incident(
  p_incident uuid, p_admin uuid, p_upheld boolean, p_resolution text
) returns public.incidents language plpgsql as $$
declare inc public.incidents;
begin
  update public.incidents
     set status = case when p_upheld then 'upheld' else 'rejected' end::public.incident_status,
         resolution = p_resolution, resolved_at = now(), resolved_by = p_admin
   where id = p_incident and status = 'open'
  returning * into inc;
  if not found then
    raise exception 'incident is not open';
  end if;

  if inc.type in ('damage', 'safety') and inc.booking_id is not null then
    update public.bookings set frozen = false where id = inc.booking_id;
  end if;
  if p_upheld and inc.workshop_id is not null and inc.type in ('damage', 'safety', 'overcharge') then
    perform public.add_strike(inc.workshop_id, null, inc.id, inc.type::text, p_admin,
                              'incident upheld: ' || coalesce(p_resolution, ''));
  end if;
  insert into public.ts_actions (actor_id, workshop_id, action, reason, ref)
  values (p_admin, inc.workshop_id, 'resolve_incident', p_resolution,
          jsonb_build_object('incident_id', inc.id, 'upheld', p_upheld));
  return inc;
end $$;

create function public.open_dispute(
  p_booking uuid, p_customer uuid, p_reason text, p_evidence jsonb
) returns public.disputes language plpgsql as $$
declare
  b public.bookings;
  d public.disputes;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or b.customer_id <> p_customer then
    raise exception 'booking not found' using errcode = '42501';
  end if;
  perform public.transition_booking(p_booking, 'disputed', p_customer, 'customer',
                                    jsonb_build_object('reason', p_reason));
  insert into public.disputes (booking_id, opened_by, reason, evidence, return_status)
  values (p_booking, p_customer, p_reason, coalesce(p_evidence, '[]'::jsonb), b.status)
  returning * into d;
  return d;
end $$;

-- upheld or partial: the booking is refunded and the workshop gets a strike;
-- rejected: the booking goes back to where it was
create function public.resolve_dispute(
  p_dispute uuid, p_admin uuid, p_outcome public.dispute_status, p_refund numeric, p_resolution text
) returns public.disputes language plpgsql as $$
declare
  d public.disputes;
  b public.bookings;
begin
  if p_outcome = 'open' then
    raise exception 'choose upheld, partial or rejected';
  end if;
  select * into d from public.disputes where id = p_dispute and status = 'open' for update;
  if not found then
    raise exception 'dispute is not open';
  end if;
  select * into b from public.bookings where id = d.booking_id;

  if p_outcome in ('upheld', 'partial') then
    if coalesce(p_refund, 0) <= 0 or p_refund > coalesce(b.final_price, b.quote_high) then
      raise exception 'refund must be between 0 and the booking amount';
    end if;
    perform public.transition_booking(d.booking_id, 'refunded', p_admin, 'admin',
                                      jsonb_build_object('dispute_id', d.id, 'refund', p_refund));
    if b.workshop_id is not null then
      perform public.add_strike(b.workshop_id, null, null, 'dispute_upheld', p_admin,
                                'dispute upheld: ' || coalesce(p_resolution, ''));
    end if;
  else
    perform public.transition_booking(d.booking_id, coalesce(d.return_status, 'paid'), p_admin, 'admin',
                                      jsonb_build_object('dispute_id', d.id));
  end if;

  update public.disputes
     set status = p_outcome, refund_amount = case when p_outcome = 'rejected' then 0 else p_refund end,
         resolution = p_resolution, resolved_at = now(), resolved_by = p_admin
   where id = d.id returning * into d;
  return d;
end $$;

-- A workshop may appeal a strike once.
create function public.appeal_strike(p_strike uuid, p_owner uuid, p_text text)
returns public.strikes language plpgsql as $$
declare s public.strikes;
begin
  update public.strikes st
     set appealed_at = now(), appeal_text = p_text
   where st.id = p_strike and st.appealed_at is null and st.revoked_at is null
     and exists (select 1 from public.workshops w where w.id = st.workshop_id and w.owner_id = p_owner)
  returning * into s;
  if not found then
    raise exception 'strike cannot be appealed (already appealed, revoked, or not yours)';
  end if;
  return s;
end $$;

create function public.decide_appeal(p_strike uuid, p_admin uuid, p_accept boolean, p_note text)
returns public.strikes language plpgsql as $$
declare s public.strikes;
begin
  update public.strikes
     set appeal_outcome = case when p_accept then 'accepted' else 'declined' end,
         revoked_at = case when p_accept then now() else revoked_at end
   where id = p_strike and appealed_at is not null and appeal_outcome is null
  returning * into s;
  if not found then
    raise exception 'no open appeal for this strike';
  end if;
  insert into public.ts_actions (actor_id, workshop_id, action, reason, ref)
  values (p_admin, s.workshop_id, 'decide_appeal', p_note,
          jsonb_build_object('strike_id', s.id, 'accepted', p_accept));
  return s;
end $$;

-- A review from an account linked to the workshop is hidden and costs a strike.
create function public.reviews_link_check() returns trigger language plpgsql as $$
declare
  w public.workshops;
  c public.profiles;
begin
  select * into w from public.workshops where id = new.workshop_id;
  select * into c from public.profiles where id = new.customer_id;
  if w.owner_id = new.customer_id
     or (c.phone is not null and (c.phone = w.phone or c.phone = (
           select p.phone from public.profiles p where p.id = w.owner_id)))
     or exists (select 1 from public.payout_accounts pa1
                  join public.payout_accounts pa2 on pa2.fingerprint = pa1.fingerprint
                 where pa1.workshop_id = w.id and pa2.id <> pa1.id and pa2.workshop_id is null) then
    new.hidden := true;
    perform public.add_strike(w.id, null, null, 'fake_review', null, 'review from a linked account');
  end if;
  return new;
end $$;

create trigger reviews_link_check
  before insert on public.reviews
  for each row execute function public.reviews_link_check();

-- Re-verification: every 12 months, or at once when payout details change.
create function public.flag_reverification() returns integer language plpgsql as $$
declare n integer;
begin
  update public.workshops set stage = 'review'
   where stage = 'active' and verified_at < now() - interval '12 months';
  get diagnostics n = row_count;
  return n;
end $$;

create function public.payout_account_changed() returns trigger language plpgsql as $$
begin
  if new.workshop_id is not null then
    update public.workshops set stage = 'review'
     where id = new.workshop_id and stage in ('probation', 'active');
  end if;
  return new;
end $$;

create trigger payout_account_changed
  after insert on public.payout_accounts
  for each row when (new.workshop_id is not null)
  execute function public.payout_account_changed();

-- the admin's queue, oldest first
create view public.admin_review_queue as
  select a.id, a.shop_name, a.city, a.stage, a.created_at, a.review_due_at,
         (a.review_due_at < now()) as overdue,
         (select count(*) from public.kyc_checks k where k.application_id = a.id and not k.passed) as failed_checks
    from public.workshop_applications a
   where a.stage = 'review'
   order by a.review_due_at;

create function public.admin_review_queue() returns setof public.admin_review_queue
language sql stable as $$ select * from public.admin_review_queue $$;

create function public.admin_dead_letters() returns setof public.outbox
language sql stable as $$
  select * from public.outbox where status = 'dead' order by created_at desc limit 200
$$;

create function public.admin_open_cases() returns table (kind text, id uuid, booking_id uuid, summary text, opened_at timestamptz)
language sql stable as $$
  select 'incident', i.id, i.booking_id, i.type::text || ': ' || coalesce(i.description, ''), i.created_at
    from public.incidents i where i.status = 'open'
  union all
  select 'dispute', d.id, d.booking_id, d.reason, d.opened_at
    from public.disputes d where d.status = 'open'
  union all
  select 'appeal', s.id, null, s.kind || ': ' || coalesce(s.appeal_text, ''), s.appealed_at
    from public.strikes s where s.appealed_at is not null and s.appeal_outcome is null
  order by 5
$$;

-- ---------------------------------------------------------------------------
-- access
-- ---------------------------------------------------------------------------
alter table public.workshop_applications enable row level security;
alter table public.workshop_documents    enable row level security;
alter table public.kyc_checks            enable row level security;
alter table public.payout_accounts       enable row level security;
alter table public.incidents             enable row level security;
alter table public.strikes               enable row level security;
alter table public.disputes              enable row level security;
alter table public.ts_actions            enable row level security;

create policy applications_own on public.workshop_applications
  for select using (applicant_id = auth.uid());
create policy applications_admin on public.workshop_applications
  for select using (public.is_admin());
create policy documents_own on public.workshop_documents
  for select using (exists (select 1 from public.workshop_applications a
                             where a.id = application_id and a.applicant_id = auth.uid()));
create policy documents_admin on public.workshop_documents
  for select using (public.is_admin());
create policy kyc_admin on public.kyc_checks for select using (public.is_admin());
-- payout_accounts: no client policy at all (ciphertext never leaves the server)

create policy incidents_reporter on public.incidents
  for select using (reporter_id = auth.uid());
create policy incidents_workshop on public.incidents
  for select using (workshop_id is not null and public.owns_workshop(workshop_id));
create policy incidents_admin on public.incidents for select using (public.is_admin());

create policy strikes_workshop on public.strikes
  for select using (workshop_id is not null and public.owns_workshop(workshop_id));
create policy strikes_admin on public.strikes for select using (public.is_admin());

create policy disputes_party on public.disputes
  for select using (opened_by = auth.uid()
    or exists (select 1 from public.bookings b where b.id = booking_id
               and b.workshop_id is not null and public.owns_workshop(b.workshop_id)));
create policy disputes_admin on public.disputes for select using (public.is_admin());
create policy ts_actions_admin on public.ts_actions for select using (public.is_admin());

revoke insert, update, delete on public.workshop_applications, public.workshop_documents,
  public.kyc_checks, public.incidents, public.strikes, public.disputes, public.ts_actions
  from anon, authenticated;
revoke all on public.payout_accounts from anon, authenticated;
revoke all on public.admin_review_queue from anon, authenticated;

revoke execute on function
  public.create_application(uuid, text, text, text, text, double precision, double precision, uuid[], integer, jsonb),
  public.attach_document(uuid, uuid, public.document_kind, text, text),
  public.record_kyc_check(uuid, text, boolean, boolean, jsonb),
  public.find_duplicate_applicants(uuid),
  public.submit_for_review(uuid, uuid),
  public.approve_application(uuid, uuid),
  public.reject_application(uuid, uuid, text),
  public.suspend_workshop(uuid, text, uuid),
  public.add_strike(uuid, uuid, uuid, text, uuid, text),
  public.process_no_shows(),
  public.refresh_acceptance_floor(),
  public.report_incident(uuid, uuid, public.incident_type, text, jsonb),
  public.resolve_incident(uuid, uuid, boolean, text),
  public.open_dispute(uuid, uuid, text, jsonb),
  public.resolve_dispute(uuid, uuid, public.dispute_status, numeric, text),
  public.appeal_strike(uuid, uuid, text),
  public.decide_appeal(uuid, uuid, boolean, text),
  public.flag_reverification(),
  public.admin_review_queue(),
  public.admin_dead_letters(),
  public.admin_open_cases()
from public, anon, authenticated;

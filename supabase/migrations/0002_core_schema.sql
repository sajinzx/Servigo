-- 0002: core domain tables.
-- Locations are stored as plain lat/lng here so the schema works anywhere; the
-- PostGIS migration adds a generated geography column and GiST indexes on top.

create type public.vehicle_kind   as enum ('car', 'bike');
create type public.booking_mode   as enum ('workshop', 'doorstep');
create type public.offer_response as enum ('pending', 'accepted', 'rejected', 'expired');
create type public.booking_status as enum (
  'requested', 'matching', 'offered', 'accepted', 'in_progress', 'completed',
  'payment_pending_verification', 'paid', 'reviewed',
  'cancelled', 'no_match', 'disputed', 'refunded'
);

create table public.addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  label      text not null default 'home',
  line1      text not null,
  city       text not null,
  pincode    text check (pincode ~ '^[1-9][0-9]{5}$'),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);

create table public.vehicle_models (
  id        uuid primary key default gen_random_uuid(),
  kind      public.vehicle_kind not null,
  make      text not null,
  model     text not null,
  fuel      text not null default 'petrol',
  segment   text not null,
  engine_cc integer,
  seats     integer,
  unique (kind, make, model, fuel)
);

create table public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  registration_no text not null unique
                  check (registration_no ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$'),
  model_id        uuid not null references public.vehicle_models (id),
  year            integer not null check (year between 1980 and 2100),
  odometer_km     integer not null default 0 check (odometer_km >= 0),
  last_service_at timestamptz,
  created_at      timestamptz not null default now()
);
create index vehicles_owner_idx on public.vehicles (owner_id);

create table public.workshops (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid unique references public.profiles (id) on delete set null,
  name              text not null,
  phone             text,
  address_line      text,
  city              text not null,
  lat               double precision not null check (lat between -90 and 90),
  lng               double precision not null check (lng between -180 and 180),
  service_radius_km numeric(5, 1) not null default 10 check (service_radius_km > 0),
  staff_count       integer not null default 1 check (staff_count > 0),
  open_hours        jsonb not null default
    '{"mon":["09:00","19:00"],"tue":["09:00","19:00"],"wed":["09:00","19:00"],"thu":["09:00","19:00"],"fri":["09:00","19:00"],"sat":["09:00","19:00"]}'::jsonb,
  vehicle_kinds     public.vehicle_kind[] not null default '{car,bike}',
  offers_doorstep   boolean not null default false,
  rating_sum        integer not null default 0 check (rating_sum >= 0),
  rating_count      integer not null default 0 check (rating_count >= 0),
  is_active         boolean not null default true,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now()
);
create index workshops_city_idx on public.workshops (city);
create index workshops_latlng_idx on public.workshops (lat, lng);

create table public.services (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name               text not null,
  vehicle_kind       public.vehicle_kind not null,
  category           text not null,
  base_price         numeric(10, 2) not null check (base_price >= 0),
  base_duration_min  integer not null check (base_duration_min > 0),
  is_active          boolean not null default true
);

create table public.workshop_services (
  workshop_id    uuid not null references public.workshops (id) on delete cascade,
  service_id     uuid not null references public.services (id),
  price_override numeric(10, 2) check (price_override >= 0),
  is_paused      boolean not null default false,
  primary key (workshop_id, service_id)
);

-- price multiplier by vehicle class; applied on top of the catalogue price
create table public.segment_factors (
  vehicle_kind public.vehicle_kind not null,
  segment      text not null,
  factor       numeric(4, 2) not null check (factor > 0),
  primary key (vehicle_kind, segment)
);

create sequence public.booking_ref_seq start 10001;

create table public.bookings (
  id                     uuid primary key default gen_random_uuid(),
  ref                    text not null unique
                         default ('BK-' || nextval('public.booking_ref_seq')),
  customer_id            uuid not null references public.profiles (id),
  vehicle_id             uuid not null references public.vehicles (id),
  service_id             uuid not null references public.services (id),
  workshop_id            uuid references public.workshops (id),
  status                 public.booking_status not null default 'requested',
  mode                   public.booking_mode not null default 'workshop',
  pickup_lat             double precision not null,
  pickup_lng             double precision not null,
  scheduled_for          timestamptz,
  symptom_text           text check (char_length(symptom_text) <= 1000),
  quote_low              numeric(10, 2) not null check (quote_low >= 0),
  quote_high             numeric(10, 2) not null,
  predicted_duration_min integer,
  labour_amount          numeric(10, 2),
  parts_amount           numeric(10, 2),
  final_price            numeric(10, 2),
  needs_price_approval   boolean not null default false,
  price_approved_at      timestamptz,
  search_radius_km       integer not null default 5,
  miss_count             integer not null default 0,
  eta_min                integer,
  distance_km            numeric(6, 2),
  started_at             timestamptz,
  completed_at           timestamptz,
  cancelled_reason       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (quote_high >= quote_low)
);
create index bookings_workshop_status_idx on public.bookings (workshop_id, status);
create index bookings_customer_created_idx on public.bookings (customer_id, created_at desc);
create index bookings_status_idx on public.bookings (status);

-- Which status moves exist, and which kind of actor may make each one.
create table public.booking_transitions (
  from_status public.booking_status not null,
  to_status   public.booking_status not null,
  actors      text[] not null,
  primary key (from_status, to_status)
);

create table public.booking_events (
  id          bigserial primary key,
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  from_status public.booking_status,
  to_status   public.booking_status not null,
  actor_id    uuid,
  actor_role  text not null,
  at          timestamptz not null default now(),
  meta        jsonb not null default '{}'::jsonb
);
create index booking_events_booking_idx on public.booking_events (booking_id, at);

create table public.offers (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  workshop_id  uuid not null references public.workshops (id),
  score        numeric(6, 4) not null,
  rank         integer not null,
  features     jsonb not null default '{}'::jsonb,
  offered_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  responded_at timestamptz,
  response     public.offer_response not null default 'pending'
);
create index offers_booking_idx on public.offers (booking_id);
create index offers_workshop_idx on public.offers (workshop_id, offered_at desc);
create unique index offers_one_pending_per_booking
  on public.offers (booking_id) where response = 'pending';

create table public.reviews (
  booking_id  uuid primary key references public.bookings (id) on delete cascade,
  customer_id uuid not null references public.profiles (id),
  workshop_id uuid not null references public.workshops (id),
  rating      integer not null check (rating between 1 and 5),
  comment     text check (char_length(comment) <= 1000),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index reviews_workshop_idx on public.reviews (workshop_id);

-- Transactional outbox: side effects are written here in the same transaction
-- as the change that caused them, and delivered by the worker (see 0005).
create table public.outbox (
  id              bigserial primary key,
  queue           text not null default 'notify'
                  check (queue in ('realtime', 'notify', 'billing', 'batch')),
  event_type      text not null,
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status          text not null default 'pending' check (status in ('pending', 'done', 'dead')),
  attempts        integer not null default 0,
  next_run_at     timestamptz not null default now(),
  locked_until    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);
create index outbox_due_idx on public.outbox (queue, next_run_at) where status = 'pending';

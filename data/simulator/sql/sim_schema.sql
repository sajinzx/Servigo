-- Separate schema so synthetic rows never mix with real ones.
create schema if not exists sim;

create table if not exists sim.workshops (
  workshop_id text primary key, name text, lat double precision, lng double precision,
  staff_count integer, kinds text, efficiency double precision, markup double precision,
  offers_doorstep boolean, open_hour integer, close_hour integer, closed_sunday boolean,
  accept_effect double precision, h3_cell text
);
create table if not exists sim.customers (
  customer_id text primary key, lat double precision, lng double precision, locality text
);
create table if not exists sim.vehicles (
  vehicle_id text primary key, customer_id text, kind text, make text, model text, fuel text,
  segment text, age_years double precision, km_per_day double precision, odometer_km double precision,
  initial_days_since_service double precision, lat double precision, lng double precision, h3_cell text
);
create table if not exists sim.bookings (
  booking_id text primary key, created_at timestamp, h3_cell text, lat double precision,
  lng double precision, customer_id text, vehicle_id text, vehicle_kind text, segment text,
  vehicle_age double precision, km_since_service double precision, service_code text,
  category text, symptom_text text, mode text, hour integer, weekday integer, is_holiday boolean,
  quote_low double precision, quote_high double precision, n_offers integer, status text,
  workshop_id text, eta_min double precision, distance_km double precision,
  duration_min double precision, final_price double precision, rating integer, wait_min double precision
);
create table if not exists sim.offers (
  offer_id text primary key, booking_id text, workshop_id text, rank integer,
  distance_km double precision, active_jobs integer, staff_count integer, hour integer,
  weekday integer, night integer, markup double precision, p_true double precision,
  response text, offered_at timestamp
);

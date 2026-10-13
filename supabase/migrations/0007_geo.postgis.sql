-- 0007: PostGIS. Only applied on Supabase (or any Postgres with the extension);
-- the in-process test database skips *.postgis.sql files.
--
-- lat/lng stay the source of truth; geom is derived from them so the two can
-- never disagree. The ST_DWithin version of find_candidates() lives in the last
-- migration (see supabase/tools/gen_postgis_find_candidates.py).

create extension if not exists postgis;

alter table public.workshops
  add column geom geography(Point, 4326)
  generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored;
alter table public.addresses
  add column geom geography(Point, 4326)
  generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored;
alter table public.bookings
  add column pickup_geom geography(Point, 4326)
  generated always as (st_setsrid(st_makepoint(pickup_lng, pickup_lat), 4326)::geography) stored;

create index workshops_geom_gix on public.workshops using gist (geom);
create index addresses_geom_gix on public.addresses using gist (geom);
create index bookings_pickup_geom_gix on public.bookings using gist (pickup_geom);

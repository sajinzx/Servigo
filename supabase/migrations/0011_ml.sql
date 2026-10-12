-- 0011: tables the ML service and the pilot report write to (plan sections 3, 5, 11).
-- The ML service never writes to core tables; it writes only here.

create table public.model_registry (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  version       text not null,
  metrics       jsonb not null default '{}'::jsonb,
  artifact_path text,
  is_active     boolean not null default false,
  promotion     jsonb,
  created_at    timestamptz not null default now(),
  promoted_at   timestamptz,
  unique (name, version)
);
-- at most one active version per model
create unique index model_registry_one_active on public.model_registry (name) where is_active;

create table public.prediction_log (
  id         bigserial primary key,
  model      text not null,
  version    text not null,
  inputs     jsonb,
  output     jsonb,
  latency_ms numeric(8, 2),
  at         timestamptz not null default now()
);
create index prediction_log_model_idx on public.prediction_log (model, at desc);

create table public.demand_forecasts (
  h3_cell       text not null,
  category      text not null,
  hour_ts       timestamptz not null,
  yhat          real not null,
  yhat_lo       real not null,
  yhat_hi       real not null,
  model_version text not null,
  created_at    timestamptz not null default now(),
  primary key (h3_cell, category, hour_ts)
);
create index demand_forecasts_hour_idx on public.demand_forecasts (hour_ts);

-- pilot and simulation KPIs side by side; a synthetic number is never stored as `real`
create table public.pilot_metrics (
  id         uuid primary key default gen_random_uuid(),
  metric     text not null,
  source     text not null check (source in ('real', 'sim')),
  period     text not null,              -- e.g. 2026-w43 or pilot
  value      double precision not null,
  n          integer not null check (n >= 0),
  ci_low     double precision,
  ci_high    double precision,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (metric, source, period)
);

-- service reminders (M6): at most one per vehicle per month
create table public.service_reminders (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  month      text not null,
  p_due      real not null,
  days_left  real,
  sent_at    timestamptz not null default now(),
  unique (vehicle_id, month)
);

-- What the reminder job needs for each vehicle: kind, age, how fast it is driven, time since service.
create function public.service_due_candidates(p_limit integer default 500)
returns table (
  vehicle_id uuid, owner_id uuid, kind public.vehicle_kind, label text,
  age_years double precision, km_per_day double precision, days_since_service double precision
) language sql stable as $$
  select v.id, v.owner_id, vm.kind, vm.make || ' ' || vm.model,
         extract(year from now())::double precision - v.year,
         greatest(v.odometer_km::double precision
                  / greatest((extract(year from now())::double precision - v.year) * 365, 30), 1),
         extract(epoch from (now() - coalesce(v.last_service_at, make_date(v.year, 1, 1)::timestamptz))) / 86400
    from public.vehicles v
    join public.vehicle_models vm on vm.id = v.model_id
   where not exists (select 1 from public.service_reminders r
                      where r.vehicle_id = v.id and r.month = to_char(now(), 'YYYY-MM'))
   order by v.last_service_at nulls first
   limit p_limit
$$;

alter table public.model_registry   enable row level security;
alter table public.prediction_log   enable row level security;
alter table public.demand_forecasts enable row level security;
alter table public.pilot_metrics    enable row level security;
alter table public.service_reminders enable row level security;

create policy model_registry_admin on public.model_registry for select using (public.is_admin());
create policy prediction_log_admin on public.prediction_log for select using (public.is_admin());
create policy pilot_metrics_admin on public.pilot_metrics for select using (public.is_admin());
-- forecasts are not sensitive: workshops use them for the "busy hours next week" strip
create policy demand_forecasts_read on public.demand_forecasts for select using (auth.uid() is not null);
create policy reminders_owner on public.service_reminders for select
  using (exists (select 1 from public.vehicles v where v.id = vehicle_id and v.owner_id = auth.uid()));

revoke insert, update, delete on public.model_registry, public.prediction_log, public.demand_forecasts,
  public.pilot_metrics, public.service_reminders from anon, authenticated;
revoke execute on function public.service_due_candidates(integer) from public, anon, authenticated;

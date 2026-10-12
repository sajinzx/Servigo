-- 0004: row level security for the core tables.
-- Clients may read what is theirs and manage their own garage and addresses.
-- Every booking write goes through the API with the service role.

create function public.owns_workshop(p_workshop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workshops where id = p_workshop and owner_id = auth.uid());
$$;

alter table public.addresses            enable row level security;
alter table public.vehicle_models       enable row level security;
alter table public.vehicles             enable row level security;
alter table public.workshops            enable row level security;
alter table public.services             enable row level security;
alter table public.workshop_services    enable row level security;
alter table public.segment_factors      enable row level security;
alter table public.bookings             enable row level security;
alter table public.booking_transitions  enable row level security;
alter table public.booking_events       enable row level security;
alter table public.offers               enable row level security;
alter table public.reviews              enable row level security;
alter table public.outbox               enable row level security;

-- addresses and vehicles: the owner has full control
create policy addresses_owner on public.addresses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy addresses_admin_read on public.addresses
  for select using (public.is_admin());

create policy vehicles_owner on public.vehicles
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy vehicles_admin_read on public.vehicles
  for select using (public.is_admin());

-- catalogues are readable by any signed-in user; only admins change them
create policy vehicle_models_read on public.vehicle_models for select using (true);
create policy vehicle_models_admin on public.vehicle_models
  for all using (public.is_admin()) with check (public.is_admin());

create policy services_read on public.services for select using (true);
create policy services_admin on public.services
  for all using (public.is_admin()) with check (public.is_admin());

create policy segment_factors_read on public.segment_factors for select using (true);
create policy segment_factors_admin on public.segment_factors
  for all using (public.is_admin()) with check (public.is_admin());

create policy transitions_read on public.booking_transitions
  for select using (auth.uid() is not null);

-- workshops: public directory of active shops; owners edit their own
create policy workshops_read on public.workshops
  for select using (is_active or owner_id = auth.uid() or public.is_admin());
create policy workshops_owner_update on public.workshops
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy workshops_admin on public.workshops
  for all using (public.is_admin()) with check (public.is_admin());

create policy workshop_services_read on public.workshop_services for select using (true);
create policy workshop_services_owner on public.workshop_services
  for all using (public.owns_workshop(workshop_id)) with check (public.owns_workshop(workshop_id));

-- bookings: customers see theirs, workshops see ones offered or assigned to them
create policy bookings_customer_read on public.bookings
  for select using (customer_id = auth.uid());
create policy bookings_workshop_read on public.bookings
  for select using (workshop_id is not null and public.owns_workshop(workshop_id));
create policy bookings_admin_read on public.bookings
  for select using (public.is_admin());

create policy booking_events_read on public.booking_events
  for select using (
    exists (select 1 from public.bookings b where b.id = booking_id
            and (b.customer_id = auth.uid()
                 or (b.workshop_id is not null and public.owns_workshop(b.workshop_id))))
    or public.is_admin()
  );

create policy offers_workshop_read on public.offers
  for select using (public.owns_workshop(workshop_id) or public.is_admin());

create policy reviews_read on public.reviews
  for select using (not hidden or customer_id = auth.uid() or public.is_admin());

-- outbox: no policies at all, so only the service role can touch it

-- belt and braces: a client can never write to these directly
revoke insert, update, delete on public.bookings, public.booking_events, public.offers,
                                 public.reviews, public.booking_transitions
  from anon, authenticated;
revoke all on public.outbox from anon, authenticated;

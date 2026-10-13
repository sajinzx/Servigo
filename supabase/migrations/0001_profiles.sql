-- 0001: profiles, roles and the auth hook that creates them.
-- Supabase Auth owns passwords and sessions. profiles.id is auth.users.id.

create type public.user_role as enum ('customer', 'mechanic', 'admin');

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  role           public.user_role not null default 'customer',
  full_name      text,
  phone          text unique,
  phone_verified boolean not null default false,
  whatsapp_opt_in boolean not null default false,
  onboarded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Roles are never read from client-controlled metadata. Every new account is a
-- customer; mechanics get their role when a workshop application is approved,
-- admins are promoted by hand with the service role.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, phone_verified)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when coalesce(new.phone, '') = '' then null else '+' || ltrim(new.phone, '+') end,
    new.phone_confirmed_at is not null
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create function public.current_role_name() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- A user may edit their own name and notification choices, and nothing that says
-- who they are or what they have proven: role, phone, phone_verified and
-- onboarded_at change only through Supabase Auth or the service role.
create function public.profiles_guard() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  -- `servigo.trusted` is set (transaction-locally) only inside SECURITY DEFINER functions that
  -- have done their own checks, such as complete_onboarding(). Clients cannot run set_config.
  if coalesce(auth.role(), 'service_role') <> 'service_role'
     and coalesce(current_setting('servigo.trusted', true), '') <> 'on' then
    if new.role is distinct from old.role then
      raise exception 'role can only be changed by the service role' using errcode = '42501';
    end if;
    if new.phone is distinct from old.phone
       or new.phone_verified is distinct from old.phone_verified
       or new.onboarded_at is distinct from old.onboarded_at then
      raise exception 'phone and onboarding status are set by verification, not by editing'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select using (public.is_admin());

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- A phone confirmed through Supabase Auth (OTP) is the only way phone_verified becomes true.
create function public.sync_profile_phone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set phone = case when coalesce(new.phone, '') = '' then null else '+' || ltrim(new.phone, '+') end,
         phone_verified = new.phone_confirmed_at is not null and coalesce(new.phone, '') <> ''
   where id = new.id;
  return new;
end $$;

create trigger on_auth_user_phone_changed
  after update of phone, phone_confirmed_at on auth.users
  for each row
  when (old.phone is distinct from new.phone or old.phone_confirmed_at is distinct from new.phone_confirmed_at)
  execute function public.sync_profile_phone();

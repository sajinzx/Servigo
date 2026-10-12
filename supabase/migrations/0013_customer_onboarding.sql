-- 0013: the customer's three onboarding steps (plan 9.1) are finished by the database,
-- not by the browser: onboarded_at is only stamped when every step really happened.

create function public.complete_onboarding() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  done timestamptz;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if coalesce(trim(me.full_name), '') = '' then
    raise exception 'add your name first';
  end if;
  if not me.phone_verified then
    raise exception 'verify your phone number first';
  end if;
  if not exists (select 1 from public.addresses where user_id = me.id) then
    raise exception 'add an address first';
  end if;
  if not exists (select 1 from public.vehicles where owner_id = me.id) then
    raise exception 'add your first vehicle first';
  end if;

  -- all four checks passed: this function, and only this one, may stamp onboarded_at
  perform set_config('servigo.trusted', 'on', true);
  update public.profiles set onboarded_at = coalesce(onboarded_at, now())
   where id = me.id returning onboarded_at into done;
  perform set_config('servigo.trusted', 'off', true);
  return done;
end $$;

revoke execute on function public.complete_onboarding() from public, anon;
grant execute on function public.complete_onboarding() to authenticated;

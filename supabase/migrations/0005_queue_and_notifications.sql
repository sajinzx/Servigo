-- 0005: durable job queue on top of the outbox, and the notification log.
--
-- The outbox row *is* the queue message. A worker claims rows with
-- FOR UPDATE SKIP LOCKED and a visibility timeout, so a crashed worker's job
-- simply becomes claimable again. Same semantics as pgmq, with nothing extra
-- to install, and it can be tested on plain Postgres.

create function public.claim_jobs(
  p_queues             text[],
  p_limit              integer default 10,
  p_visibility_seconds integer default 30,
  p_max_attempts       integer default 5
) returns setof public.outbox
language plpgsql as $$
begin
  -- jobs whose worker crashed on their last allowed attempt go to the dead letter
  update public.outbox
     set status = 'dead',
         last_error = coalesce(last_error, 'worker stopped responding'),
         locked_until = null
   where status = 'pending' and attempts >= p_max_attempts
     and locked_until is not null and locked_until < now();

  return query
  with due as (
    select id from public.outbox
     where status = 'pending'
       and queue = any (p_queues)
       and next_run_at <= now()
       and (locked_until is null or locked_until < now())
     order by next_run_at, id
     limit p_limit
     for update skip locked
  )
  update public.outbox o
     set locked_until = now() + make_interval(secs => p_visibility_seconds),
         attempts = o.attempts + 1
    from due
   where o.id = due.id
  returning o.*;
end $$;

create function public.complete_job(p_id bigint) returns void language sql as $$
  update public.outbox
     set status = 'done', processed_at = now(), locked_until = null
   where id = p_id;
$$;

-- retry schedule: 10 s, 1 min, 5 min, 30 min, 2 h, each with +/-20% jitter;
-- a job that has used all its attempts moves to the dead letter
create function public.fail_job(p_id bigint, p_error text, p_max_attempts integer default 5)
returns public.outbox language plpgsql as $$
declare
  j      public.outbox;
  steps  integer[] := array[10, 60, 300, 1800, 7200];
  base   integer;
begin
  select * into j from public.outbox where id = p_id for update;
  if not found then
    return null;
  end if;

  if j.attempts >= p_max_attempts then
    update public.outbox
       set status = 'dead', last_error = left(p_error, 1000), locked_until = null
     where id = p_id returning * into j;
  else
    base := steps[least(j.attempts, array_length(steps, 1))];
    update public.outbox
       set next_run_at = now() + make_interval(secs => base * (0.8 + random() * 0.4)),
           last_error = left(p_error, 1000),
           locked_until = null
     where id = p_id returning * into j;
  end if;
  return j;
end $$;

create function public.requeue_dead_job(p_id bigint) returns void language sql as $$
  update public.outbox
     set status = 'pending', attempts = 0, next_run_at = now(), locked_until = null
   where id = p_id and status = 'dead';
$$;

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create type public.notification_channel as enum ('in_app', 'push', 'whatsapp', 'sms', 'email');
create type public.notification_status  as enum ('queued', 'sent', 'delivered', 'read', 'failed');

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  channel         public.notification_channel not null,
  template        text not null,
  template_version integer not null default 1,
  payload         jsonb not null default '{}'::jsonb,
  status          public.notification_status not null default 'queued',
  provider_msg_id text,
  idempotency_key text not null unique,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_provider_idx on public.notifications (provider_msg_id)
  where provider_msg_id is not null;

create table public.notification_prefs (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  channel    public.notification_channel not null,
  enabled    boolean not null default true,
  consented_at timestamptz,
  primary key (user_id, channel)
);

create table public.device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null unique,
  platform   text not null default 'web',
  created_at timestamptz not null default now()
);

alter table public.notifications      enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.device_tokens      enable row level security;

create policy notifications_read_own on public.notifications
  for select using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_admin on public.notifications
  for select using (public.is_admin());

create policy prefs_own on public.notification_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy device_tokens_own on public.device_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke insert, delete on public.notifications from anon, authenticated;
revoke execute on function
  public.claim_jobs(text[], integer, integer, integer),
  public.complete_job(bigint),
  public.fail_job(bigint, text, integer),
  public.requeue_dead_job(bigint)
from public, anon, authenticated;

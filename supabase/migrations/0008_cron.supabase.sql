-- 0008: scheduled jobs. Supabase only (pg_cron); skipped by the test database.

create extension if not exists pg_cron;

-- safety net for offers: the delayed offer.timeout job normally expires them first
select cron.schedule('expire-stale-offers', '* * * * *', $$select public.expire_stale_offers()$$);

-- trust & safety sweeps (plan 9.3)
select cron.schedule('process-no-shows', '*/5 * * * *', $$select public.process_no_shows()$$);
select cron.schedule('acceptance-floor', '7 * * * *', $$select public.refresh_acceptance_floor()$$);
select cron.schedule('reverification', '0 3 * * *', $$select public.flag_reverification()$$);

-- 0008: scheduled jobs. Supabase only (pg_cron); skipped by the test database.

create extension if not exists pg_cron;

-- safety net for offers: the delayed offer.timeout job normally expires them first
select cron.schedule('expire-stale-offers', '* * * * *', $$select public.expire_stale_offers()$$);

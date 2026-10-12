-- 0008: scheduled jobs. Supabase only (pg_cron); skipped by the test database.

create extension if not exists pg_cron;

-- safety net for offers: the delayed offer.timeout job normally expires them first
select cron.schedule('expire-stale-offers', '* * * * *', $$select public.expire_stale_offers()$$);

-- trust & safety sweeps (plan 9.3)
select cron.schedule('process-no-shows', '*/5 * * * *', $$select public.process_no_shows()$$);
select cron.schedule('acceptance-floor', '7 * * * *', $$select public.refresh_acceptance_floor()$$);
select cron.schedule('reverification', '0 3 * * *', $$select public.flag_reverification()$$);

-- payments (plan section 10)
select cron.schedule('flag-overdue-payments', '15 * * * *', $$select public.flag_overdue_payments()$$);
-- every Monday 06:00 IST (00:30 UTC): prepare the payout list; an admin marks each transfer paid
select cron.schedule('plan-payouts', '30 0 * * 1', $$select public.plan_payouts()$$);

-- ML (plan section 5): nightly service-due reminders; the forecast and retraining run in GitHub Actions
select cron.schedule('service-due-reminders', '0 4 * * *',
  $$select public.enqueue_job('batch', 'reminders.service_due', '{}'::jsonb,
                              'reminders:' || to_char(now(), 'YYYY-MM-DD'))$$);

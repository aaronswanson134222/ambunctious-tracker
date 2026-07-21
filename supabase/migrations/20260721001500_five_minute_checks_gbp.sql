ALTER TABLE public.tracked_products
  ADD COLUMN IF NOT EXISTS last_price_gbp NUMERIC;

ALTER TABLE public.price_history
  ADD COLUMN IF NOT EXISTS price_gbp NUMERIC;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('tracker-run-checks-hourly', 'tracker-run-checks-every-five-minutes');

SELECT cron.schedule(
  'tracker-run-checks-every-five-minutes',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ambunctious-tracker.lovable.app/api/public/run-checks',
    headers := '{"Content-Type":"application/json","X-Tracker-Source":"cron"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

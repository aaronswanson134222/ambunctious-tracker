create table if not exists public.tracker_hourly_reports (
  hour_start timestamptz primary key,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  activity_count integer not null default 0
);

alter table public.tracker_hourly_reports enable row level security;
revoke all on public.tracker_hourly_reports from anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'tracker-hourly-discord-summary';

select cron.schedule(
  'tracker-hourly-discord-summary',
  '2 * * * *',
  $$
  select net.http_post(
    url := 'https://ambunctious-tracker.lovable.app/api/public/hourly-summary',
    headers := '{"Content-Type":"application/json","X-Tracker-Source":"cron"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

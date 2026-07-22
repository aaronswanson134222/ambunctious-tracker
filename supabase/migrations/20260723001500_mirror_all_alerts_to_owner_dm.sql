create table if not exists public.tracker_dm_deliveries (
  source_type text not null,
  source_id text not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  primary key (source_type, source_id, fingerprint)
);

alter table public.tracker_dm_deliveries enable row level security;
revoke all on public.tracker_dm_deliveries from anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'tracker-mirror-alerts-to-owner-dm';

select cron.schedule(
  'tracker-mirror-alerts-to-owner-dm',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ambunctious-tracker.lovable.app/api/public/mirror-dms',
    headers := '{"Content-Type":"application/json","X-Tracker-Source":"cron"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

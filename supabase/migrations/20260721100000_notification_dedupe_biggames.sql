create table if not exists public.tracked_websites (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  url text not null unique,
  last_item_url text,
  last_item_title text,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tracked_websites enable row level security;
revoke all on table public.tracked_websites from anon, authenticated;
grant all on table public.tracked_websites to service_role;

insert into public.tracked_websites (label, url, last_item_url, last_item_title)
values (
  'BIG Games developer blogs',
  'https://www.biggames.io/post',
  'https://www.biggames.io/post/pet-simulator-99-update-85',
  'Tap Gauntlet!'
)
on conflict (url) do nothing;

create table if not exists public.tracker_notification_events (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (source_type, source_id, fingerprint)
);

alter table public.tracker_notification_events enable row level security;
revoke all on table public.tracker_notification_events from anon, authenticated;
grant all on table public.tracker_notification_events to service_role;

create index if not exists tracker_notification_events_created_idx
  on public.tracker_notification_events (created_at desc);

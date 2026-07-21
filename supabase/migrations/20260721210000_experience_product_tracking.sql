create table if not exists public.tracked_roblox_experiences (
  id uuid primary key default gen_random_uuid(),
  place_id bigint not null unique check (place_id > 0),
  universe_id bigint not null unique check (universe_id > 0),
  label text not null check (length(label) between 1 and 120),
  lookback_days integer not null default 30 check (lookback_days in (7,30,90,365)),
  known_item_keys text[] not null default array[]::text[],
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tracked_roblox_experiences enable row level security;
revoke all on table public.tracked_roblox_experiences from anon;
grant select, insert, update, delete on table public.tracked_roblox_experiences to authenticated;
grant all on table public.tracked_roblox_experiences to service_role;

drop policy if exists "Owner manages Roblox experiences" on public.tracked_roblox_experiences;
create policy "Owner manages Roblox experiences"
on public.tracked_roblox_experiences
for all to authenticated
using (public.tracker_is_owner())
with check (public.tracker_is_owner());

create index if not exists tracked_roblox_experiences_checked_idx
  on public.tracked_roblox_experiences (last_checked_at desc);

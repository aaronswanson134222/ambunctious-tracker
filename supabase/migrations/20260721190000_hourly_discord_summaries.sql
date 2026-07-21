create table if not exists public.tracker_scan_runs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  x_checked integer not null default 0 check (x_checked >= 0),
  x_new_posts integer not null default 0 check (x_new_posts >= 0),
  products_checked integer not null default 0 check (products_checked >= 0),
  price_drops integer not null default 0 check (price_drops >= 0),
  websites_checked integer not null default 0 check (websites_checked >= 0),
  website_updates integer not null default 0 check (website_updates >= 0),
  roblox_checked integer not null default 0 check (roblox_checked >= 0),
  roblox_new_items integer not null default 0 check (roblox_new_items >= 0),
  error_count integer not null default 0 check (error_count >= 0)
);

alter table public.tracker_scan_runs enable row level security;
revoke all on table public.tracker_scan_runs from anon, authenticated;
grant all on table public.tracker_scan_runs to service_role;
grant usage, select on sequence public.tracker_scan_runs_id_seq to service_role;

create index if not exists tracker_scan_runs_created_at_idx
  on public.tracker_scan_runs (created_at desc);

create or replace function public.delete_old_tracker_scan_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tracker_scan_runs
  where created_at < now() - interval '8 days';
  return new;
end;
$$;

drop trigger if exists tracker_scan_runs_retention on public.tracker_scan_runs;
create trigger tracker_scan_runs_retention
after insert on public.tracker_scan_runs
for each statement execute function public.delete_old_tracker_scan_runs();

revoke all on function public.delete_old_tracker_scan_runs() from public, anon, authenticated;

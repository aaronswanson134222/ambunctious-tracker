alter table public.tracked_roblox_entities
  add column if not exists scan_types text[] not null default array['catalog','experience']::text[],
  add column if not exists baselined_scan_types text[] not null default array['catalog','experience']::text[],
  add column if not exists lookback_days integer not null default 30;

alter table public.tracked_roblox_entities
  drop constraint if exists tracked_roblox_scan_types_valid,
  drop constraint if exists tracked_roblox_baselines_valid,
  drop constraint if exists tracked_roblox_lookback_valid;

alter table public.tracked_roblox_entities
  add constraint tracked_roblox_scan_types_valid check (
    cardinality(scan_types) between 1 and 4
    and scan_types <@ array['catalog','experience','game_pass','developer_product']::text[]
  ),
  add constraint tracked_roblox_baselines_valid check (
    baselined_scan_types <@ array['catalog','experience','game_pass','developer_product']::text[]
  ),
  add constraint tracked_roblox_lookback_valid check (lookback_days in (7,30,90,365));

create or replace function public.tracker_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) =
         lower(coalesce((
           select decrypted_secret
           from vault.decrypted_secrets
           where name = 'tracker_owner_email'
           limit 1
         ), ''));
$$;

revoke all on function public.tracker_is_owner() from public, anon;
grant execute on function public.tracker_is_owner() to authenticated, service_role;

create table if not exists public.tracked_roblox_entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('user', 'group')),
  entity_id bigint not null check (entity_id > 0),
  label text not null check (char_length(label) between 1 and 120),
  known_item_keys jsonb not null default '[]'::jsonb check (jsonb_typeof(known_item_keys) = 'array'),
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id)
);

alter table public.tracked_roblox_entities enable row level security;
revoke all on table public.tracked_roblox_entities from anon, authenticated;
grant select, insert, update, delete on table public.tracked_roblox_entities to authenticated;
grant all on table public.tracked_roblox_entities to service_role;

drop policy if exists "Owner manages Roblox trackers" on public.tracked_roblox_entities;
create policy "Owner manages Roblox trackers"
on public.tracked_roblox_entities
for all
to authenticated
using (public.tracker_is_owner())
with check (public.tracker_is_owner());

create or replace function public.trim_tracker_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.price_history
  where id in (
    select id from public.price_history
    where product_id = new.product_id
    order by checked_at desc, id desc
    offset 1000
  );
  delete from public.tracker_notification_events
  where created_at < now() - interval '180 days';
  return new;
end;
$$;

revoke all on function public.trim_tracker_history() from public, anon, authenticated;
grant execute on function public.trim_tracker_history() to service_role;

drop trigger if exists trim_tracker_history_after_insert on public.price_history;
create trigger trim_tracker_history_after_insert
after insert on public.price_history
for each row execute function public.trim_tracker_history();

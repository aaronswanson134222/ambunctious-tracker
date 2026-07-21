create table if not exists public.roblox_account_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  roblox_user_id text not null unique,
  username text not null,
  display_name text not null,
  avatar_url text,
  profile_url text,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roblox_account_connections enable row level security;

create policy "Users can read their own Roblox connection"
on public.roblox_account_connections
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can unlink their own Roblox connection"
on public.roblox_account_connections
for delete
to authenticated
using (auth.uid() = user_id);

revoke insert, update on public.roblox_account_connections from anon, authenticated;
grant select, delete on public.roblox_account_connections to authenticated;

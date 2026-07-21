create table if not exists public.tracker_pin_attempts (
  id boolean primary key default true check (id),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.tracker_pin_attempts (id) values (true) on conflict (id) do nothing;
alter table public.tracker_pin_attempts enable row level security;
revoke all on table public.tracker_pin_attempts from public, anon, authenticated;
grant all on table public.tracker_pin_attempts to service_role;

create or replace function public.authenticate_tracker_pin(candidate text)
returns table(owner_email text, internal_password text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.tracker_pin_attempts%rowtype;
  stored_hash text;
begin
  select * into attempt
  from public.tracker_pin_attempts
  where id = true
  for update;

  if attempt.locked_until is not null and attempt.locked_until > now() then
    return;
  end if;

  if candidate !~ '^[0-9]{6}$' then
    candidate := '';
  end if;

  select decrypted_secret into stored_hash
  from vault.decrypted_secrets
  where name = 'tracker_pin_hash'
  limit 1;

  if stored_hash is not null and extensions.crypt(candidate, stored_hash) = stored_hash then
    update public.tracker_pin_attempts
    set failed_attempts = 0, locked_until = null, updated_at = now()
    where id = true;
    return query
      select
        (select decrypted_secret from vault.decrypted_secrets where name = 'tracker_owner_email' limit 1),
        (select decrypted_secret from vault.decrypted_secrets where name = 'tracker_internal_auth_password' limit 1);
    return;
  end if;

  update public.tracker_pin_attempts
  set
    failed_attempts = case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end,
    locked_until = case
      when (case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end) >= 5
      then now() + interval '15 minutes'
      else null
    end,
    updated_at = now()
  where id = true;
end;
$$;

revoke all on function public.authenticate_tracker_pin(text) from public, anon, authenticated;
grant execute on function public.authenticate_tracker_pin(text) to service_role;

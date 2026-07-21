create or replace function public.set_roblox_open_cloud_key(candidate text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
begin
  if candidate is null
     or length(candidate) < 20
     or length(candidate) > 8192
     or candidate ~ '[[:space:]]' then
    return false;
  end if;
  select id into existing_id
  from vault.secrets
  where name = 'roblox_open_cloud_api_key'
  limit 1;
  if existing_id is null then
    perform vault.create_secret(candidate, 'roblox_open_cloud_api_key', 'Roblox Open Cloud read-only monitoring key');
  else
    perform vault.update_secret(existing_id, candidate);
  end if;
  return true;
end;
$$;

revoke all on function public.set_roblox_open_cloud_key(text) from public, anon, authenticated;
grant execute on function public.set_roblox_open_cloud_key(text) to service_role;

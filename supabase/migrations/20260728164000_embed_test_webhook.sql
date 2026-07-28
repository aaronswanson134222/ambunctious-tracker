-- Dedicated Discord webhook for manual embed tests.
-- Stored in Supabase Vault and only accessible through service-role RPCs.

create or replace function public.has_embed_test_webhook()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from vault.decrypted_secrets
    where name = 'embed_test_discord_webhook'
      and decrypted_secret is not null
      and length(decrypted_secret) > 20
  );
$$;

create or replace function public.get_embed_test_webhook()
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'embed_test_discord_webhook'
  limit 1;
$$;

create or replace function public.set_embed_test_webhook(candidate text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing_id uuid;
begin
  if candidate is null
    or length(candidate) > 500
    or candidate !~ '^https://(canary\.|ptb\.)?(discord|discordapp)\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]+/?$'
  then
    return false;
  end if;

  select id into existing_id
  from vault.secrets
  where name = 'embed_test_discord_webhook'
  limit 1;

  if existing_id is null then
    perform vault.create_secret(candidate, 'embed_test_discord_webhook', 'Dedicated webhook for Ambunctious Tracker embed tests');
  else
    perform vault.update_secret(existing_id, candidate, 'embed_test_discord_webhook', 'Dedicated webhook for Ambunctious Tracker embed tests');
  end if;

  return true;
end;
$$;

revoke all on function public.has_embed_test_webhook() from public, anon, authenticated;
revoke all on function public.get_embed_test_webhook() from public, anon, authenticated;
revoke all on function public.set_embed_test_webhook(text) from public, anon, authenticated;
grant execute on function public.has_embed_test_webhook() to service_role;
grant execute on function public.get_embed_test_webhook() to service_role;
grant execute on function public.set_embed_test_webhook(text) to service_role;

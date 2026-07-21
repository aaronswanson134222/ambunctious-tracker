-- Security boundary for the private Ambunctious Tracker dashboard.
-- Owner identity and cron credentials live in Supabase Vault, never in source control.

CREATE TABLE IF NOT EXISTS public.tracker_run_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  lock_until TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
  last_started_at TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0)
);
REVOKE ALL ON public.tracker_run_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tracker_run_state TO service_role;
ALTER TABLE public.tracker_run_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.verify_tracker_cron_secret(candidate TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT candidate IS NOT NULL
    AND length(candidate) = 64
    AND candidate = COALESCE(
      (SELECT decrypted_secret
       FROM vault.decrypted_secrets
       WHERE name = 'tracker_cron_secret'
       LIMIT 1),
      ''
    );
$$;

CREATE OR REPLACE FUNCTION public.verify_tracker_owner_email(candidate TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT candidate IS NOT NULL
    AND lower(candidate) = lower(COALESCE(
      (SELECT decrypted_secret
       FROM vault.decrypted_secrets
       WHERE name = 'tracker_owner_email'
       LIMIT 1),
      ''
    ));
$$;

CREATE OR REPLACE FUNCTION public.is_tracker_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT public.verify_tracker_owner_email(auth.jwt() ->> 'email');
$$;

CREATE OR REPLACE FUNCTION public.acquire_tracker_run_lock()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  acquired BOOLEAN;
BEGIN
  INSERT INTO public.tracker_run_state(singleton, lock_until, last_started_at)
  VALUES (true, now() + interval '4 minutes', now())
  ON CONFLICT (singleton) DO UPDATE
    SET lock_until = EXCLUDED.lock_until,
        last_started_at = EXCLUDED.last_started_at
    WHERE public.tracker_run_state.lock_until <= now()
      AND public.tracker_run_state.last_started_at <= now() - interval '30 seconds'
  RETURNING true INTO acquired;

  RETURN COALESCE(acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_tracker_run_lock()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public.tracker_run_state
  SET lock_until = now()
  WHERE singleton = true;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_tracker_cron_secret(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_tracker_owner_email(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_tracker_owner() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acquire_tracker_run_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_tracker_run_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_tracker_cron_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_tracker_owner_email(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_tracker_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_tracker_run_lock() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_tracker_run_lock() TO service_role;

-- Remove all anonymous database access.
REVOKE ALL ON public.tracked_x_accounts FROM anon;
REVOKE ALL ON public.tracked_products FROM anon;
REVOKE ALL ON public.price_history FROM anon;
REVOKE ALL ON public.tracker_api_releases FROM anon, authenticated;

-- Replace permissive policies with owner-only policies.
DROP POLICY IF EXISTS "Public read tracked_x_accounts" ON public.tracked_x_accounts;
DROP POLICY IF EXISTS "Public write tracked_x_accounts" ON public.tracked_x_accounts;
DROP POLICY IF EXISTS "Public update tracked_x_accounts" ON public.tracked_x_accounts;
DROP POLICY IF EXISTS "Public delete tracked_x_accounts" ON public.tracked_x_accounts;
DROP POLICY IF EXISTS "Owner access tracked_x_accounts" ON public.tracked_x_accounts;
CREATE POLICY "Owner access tracked_x_accounts"
ON public.tracked_x_accounts
FOR ALL
TO authenticated
USING (public.is_tracker_owner())
WITH CHECK (public.is_tracker_owner());

DROP POLICY IF EXISTS "Public read tracked_products" ON public.tracked_products;
DROP POLICY IF EXISTS "Public write tracked_products" ON public.tracked_products;
DROP POLICY IF EXISTS "Public update tracked_products" ON public.tracked_products;
DROP POLICY IF EXISTS "Public delete tracked_products" ON public.tracked_products;
DROP POLICY IF EXISTS "Owner access tracked_products" ON public.tracked_products;
CREATE POLICY "Owner access tracked_products"
ON public.tracked_products
FOR ALL
TO authenticated
USING (public.is_tracker_owner())
WITH CHECK (public.is_tracker_owner());

DROP POLICY IF EXISTS "Public read price_history" ON public.price_history;
DROP POLICY IF EXISTS "Owner read price_history" ON public.price_history;
CREATE POLICY "Owner read price_history"
ON public.price_history
FOR SELECT
TO authenticated
USING (public.is_tracker_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_x_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_products TO authenticated;
GRANT SELECT ON public.price_history TO authenticated;

-- Enforce the same input restrictions at the database boundary.
ALTER TABLE public.tracked_x_accounts
  DROP CONSTRAINT IF EXISTS tracked_x_accounts_handle_format,
  ADD CONSTRAINT tracked_x_accounts_handle_format
    CHECK (handle ~ '^[A-Za-z0-9_]{1,15}$');

ALTER TABLE public.tracked_products
  DROP CONSTRAINT IF EXISTS tracked_products_safe_url,
  ADD CONSTRAINT tracked_products_safe_url
    CHECK (
      url ~ '^https://([A-Za-z0-9-]+\.)*eldorado\.gg(/|$)'
      AND length(url) <= 2048
      AND length(label) BETWEEN 1 AND 120
    );

ALTER TABLE public.tracked_products
  DROP CONSTRAINT IF EXISTS tracked_products_price_nonnegative,
  ADD CONSTRAINT tracked_products_price_nonnegative
    CHECK (last_price IS NULL OR last_price >= 0);

ALTER TABLE public.price_history
  DROP CONSTRAINT IF EXISTS price_history_price_nonnegative,
  ADD CONSTRAINT price_history_price_nonnegative
    CHECK (price >= 0);

-- Replace the spoofable public cron request with a Vault-authorized request.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('tracker-run-checks-hourly', 'tracker-run-checks-every-five-minutes');

SELECT cron.schedule(
  'tracker-run-checks-every-five-minutes',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://ambunctious-tracker.lovable.app/api/public/run-checks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'tracker_cron_secret'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

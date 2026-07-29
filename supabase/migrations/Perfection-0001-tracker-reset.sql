-- Perfection migration: tracker lockout + secret cleanup
-- WARNING: Do NOT put real secret values into this file or commit them.
-- Use the Supabase SQL editor or an admin psql session to run the vault.create_secret calls with real secrets.

-- Ensure the lockout row exists (singleton row)
INSERT INTO public.tracker_pin_attempts (
  id,
  failed_attempts,
  locked_until,
  updated_at
)
VALUES (
  true,
  0,
  null,
  now()
)
ON CONFLICT (id) DO UPDATE
SET
  failed_attempts = 0,
  locked_until = null,
  updated_at = now();

-- Remove any old tracked secrets. This is safe to run in CI / migrations.
DELETE FROM vault.secrets
WHERE name in (
  'tracker_pin_hash',
  'tracker_owner_email',
  'tracker_internal_auth_password'
);

-- The following commands create new secrets in the database vault. THEY ARE COMMENTED OUT
-- to avoid committing real secret values. Run them manually in the Supabase SQL editor or
-- via a secure psql session using the SERVICE_ROLE key.
--
-- Example (replace <REAL_VALUE> with the secret value):
-- SELECT vault.create_secret('<REAL_PIN_HASH_OR_VALUE>', 'tracker_pin_hash');
-- SELECT vault.create_secret('<OWNER_EMAIL>', 'tracker_owner_email');
-- SELECT vault.create_secret('<INTERNAL_AUTH_PASSWORD>', 'tracker_internal_auth_password');
--
-- IMPORTANT:
-- - Do NOT commit real secret values into source control.
-- - Prefer creating secrets interactively via the Supabase Dashboard or a secure admin shell.
-- - After running these, restart the application (or redeploy) so server env/clients pick up changes.

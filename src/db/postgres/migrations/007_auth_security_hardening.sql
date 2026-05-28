-- ============================================================================
-- 007_auth_security_hardening.sql
-- ============================================================================
-- Enterprise-grade hardening for the auth module. Addresses:
--   * Removes Clerk integration (clerk_user_id column unused).
--   * Introduces real platform-admin role via users.is_admin column with audit.
--   * Adds refresh-token reuse detection via previous_refresh_token_hash.
--   * Splits email_verifications into purpose-bound rows (verification vs reset)
--     to prevent token-state collisions when both flows are active for a user.
--   * Removes the destructive check_login_attempts() trigger that permanently
--     suspended any user with 5 failed login attempts and instead relies on
--     application-driven exponential lockouts.
--   * Tracks failed login IP separately so security_events evidence is accurate.
--   * Tombstones the email of soft-deleted users so a fresh registration with
--     the same address does not collide with a future restore.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Drop the destructive login-attempt trigger (replaced by service logic)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_check_login_attempts ON users;
DROP FUNCTION IF EXISTS check_login_attempts();

-- ----------------------------------------------------------------------------
-- 2) Drop the unused Clerk integration column
-- ----------------------------------------------------------------------------
ALTER TABLE users DROP COLUMN IF EXISTS clerk_user_id;

-- ----------------------------------------------------------------------------
-- 3) Real platform-admin flag (defaults to false, never inferred from any cast)
-- ----------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_admin
  ON users(is_admin)
  WHERE is_admin = TRUE AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 4) Track failed login IP separately so successful-login fields are not
--    polluted by attacker-controlled values during failures.
-- ----------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_failed_login_ip INET;

-- ----------------------------------------------------------------------------
-- 5) Refresh-token reuse detection
--    previous_refresh_token_hash stores the prior rotated value so a replay
--    attempt with an old token can be detected and the entire session family
--    revoked.
-- ----------------------------------------------------------------------------
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS previous_refresh_token_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_sessions_previous_refresh_token
  ON user_sessions(previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6) Purpose-bind email_verifications rows so password-reset and verification
--    flows do not overwrite each other through the (user_id, email) UNIQUE
--    constraint. The application also purpose-hashes the token, but storing
--    the purpose explicitly makes lookups cheap and audits clear.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_verifications' AND column_name = 'purpose'
  ) THEN
    ALTER TABLE email_verifications
      ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'email_verification';
  END IF;
END $$;

-- Drop the old (user_id, email) unique constraint if present.
ALTER TABLE email_verifications DROP CONSTRAINT IF EXISTS email_verifications_user_id_email_key;

-- Replace with a (user_id, email, purpose) constraint so each purpose owns
-- its own active row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_verifications_user_purpose_email_key'
  ) THEN
    ALTER TABLE email_verifications
      ADD CONSTRAINT email_verifications_user_purpose_email_key
      UNIQUE (user_id, email, purpose);
  END IF;
END $$;

-- Allow only one active token per (user, purpose) at a time. Older active
-- tokens for the same purpose will be marked verified_at on insert by the app.
DROP INDEX IF EXISTS idx_email_verifications_active_token_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_active_token_hash
  ON email_verifications(token_hash)
  WHERE verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_verifications_user_purpose_active
  ON email_verifications(user_id, purpose)
  WHERE verified_at IS NULL;

-- ----------------------------------------------------------------------------
-- 7) Soft-delete tombstoning: the unique index on email_hash already filters
--    deleted_at IS NULL, so a new registration with the same email succeeds.
--    To prevent a later restore() from violating that index, we mutate the
--    email of soft-deleted users to a tombstone form. The generated email_hash
--    column recalculates automatically because email is the source.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tombstone_deleted_email()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when transitioning into deleted state.
  IF NEW.deleted_at IS NOT NULL
     AND (OLD.deleted_at IS NULL OR OLD.email = NEW.email)
     AND NEW.email NOT LIKE 'deleted+%@tombstone.local'
  THEN
    NEW.email := 'deleted+' || NEW.id::text || '@tombstone.local';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_tombstone_on_delete ON users;
CREATE TRIGGER users_tombstone_on_delete
  BEFORE UPDATE OF deleted_at ON users
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION tombstone_deleted_email();

-- ----------------------------------------------------------------------------
-- 8) MFA primary-device constraint already corrected in 004. This migration
--    additionally guarantees backup_codes_hash defaults to an empty array so
--    application code can always treat the column as a JSONB array.
-- ----------------------------------------------------------------------------
ALTER TABLE user_mfa_devices
  ALTER COLUMN backup_codes_hash SET DEFAULT '[]'::jsonb;

UPDATE user_mfa_devices
   SET backup_codes_hash = '[]'::jsonb
 WHERE backup_codes_hash IS NULL;

-- ----------------------------------------------------------------------------
-- 9) Helpful index for cleanup workers
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sessions_cleanup
  ON user_sessions(expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_email_verifications_cleanup
  ON email_verifications(expires_at)
  WHERE verified_at IS NULL;

COMMIT;

-- ============================================================================
-- 009_fix_audit_logs_and_email_mfa.sql
-- ----------------------------------------------------------------------------
-- Fixes:
--   1. audit_logs schema mismatch — the running DB has an `entity_type NOT NULL`
--      column that the audit-logger.ts writer never populates. This migration
--      drops the old table (if it has the wrong schema) and recreates it to
--      match the canonical schema in 008_auth_canonical.sql / audit-logger.ts.
--
--   2. email_mfa_otps table — new table to store short-lived OTP codes for
--      email-based MFA. The application generates a 6-digit code, stores its
--      SHA-256 hash here, and emails the plaintext to the user.
--
-- Safe to run on top of 008_auth_canonical.sql. All operations are idempotent.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Fix audit_logs
--    If the table exists with the wrong schema (entity_type NOT NULL column),
--    drop and recreate it. If it already matches 008, the IF NOT EXISTS guards
--    are no-ops.
-- ----------------------------------------------------------------------------

-- Drop the broken table only if it has the entity_type column that causes
-- the NOT NULL violation. We detect this via information_schema.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'audit_logs'
      AND column_name  = 'entity_type'
  ) THEN
    DROP TABLE IF EXISTS audit_logs CASCADE;
    RAISE NOTICE 'Dropped old audit_logs table (had entity_type column)';
  END IF;
END $$;

-- Recreate with the canonical schema that matches audit-logger.ts exactly.
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Actor
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    org_id UUID,
    impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Event
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id UUID,

    -- Request context
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(64),

    -- Free-form metadata. Application code never logs secrets here.
    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_time
  ON audit_logs(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_org_time
  ON audit_logs(org_id, created_at DESC) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_action_time
  ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_logs(resource_type, resource_id) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_request
  ON audit_logs(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_metadata_gin
  ON audit_logs USING GIN (metadata);

COMMENT ON TABLE audit_logs IS
  'Append-only audit trail. Columns mirror shared/middleware/audit-logger.ts.';

-- ----------------------------------------------------------------------------
-- 2) email_mfa_otps — short-lived OTP codes for email-based MFA
--
--    Flow:
--      a. User has an email MFA device (device_type = 'email').
--      b. On login challenge, service generates a 6-digit code, stores its
--         SHA-256 hash here, and emails the plaintext to the user.
--      c. verifyLoginMFAChallenge hashes the submitted code and compares.
--      d. On match, the row is consumed (used_at = NOW()).
--
--    One active OTP per (user_id, device_id) at a time. A new OTP for the
--    same device invalidates any prior unconsumed one.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_mfa_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES user_mfa_devices(id) ON DELETE CASCADE,

    -- SHA-256 hash of the 6-digit plaintext code. Never store plaintext.
    code_hash VARCHAR(64) NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active (unused) OTP per device at a time. The application
-- invalidates prior unused OTPs (sets used_at = NOW()) before inserting a new
-- one, so this index is never violated. NOTE: the predicate must be IMMUTABLE,
-- so we cannot reference NOW()/expires_at here — `used_at IS NULL` is enough.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_mfa_otps_active_device
  ON email_mfa_otps(device_id)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_mfa_otps_user
  ON email_mfa_otps(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_mfa_otps_cleanup
  ON email_mfa_otps(expires_at) WHERE used_at IS NULL;

COMMENT ON TABLE email_mfa_otps IS
  'Short-lived OTP codes for email-based MFA. Plaintext is never stored.';

COMMIT;

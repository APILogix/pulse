-- ============================================================================
-- 008_auth_canonical.sql
-- ----------------------------------------------------------------------------
-- Canonical, idempotent schema for the AUTH MODULE only.
--
-- Purpose:
--   * Reconciles the divergent partial migrations (001..007 + authtable.sql)
--     into a single safe-to-run-anywhere file.
--   * Adds the missing `audit_logs` table that `shared/middleware/audit-logger.ts`
--     INSERTs into. Without this table every audit write was failing silently.
--   * Adds `previous_refresh_rotated_at` for refresh-token replay grace window.
--   * Adds explicit `suspended_by` / `suspended_at` so suspension is not
--     conflated with `deleted_by` / `deleted_at`.
--   * Records `accepted_terms_version` / `accepted_privacy_version` for GDPR
--     demonstrable consent.
--   * Drops the broken RLS policies. Tenancy/identity is enforced in the app
--     and the runtime DB role does not set `app.current_user_id`, so RLS as
--     written either is silently bypassed (BYPASSRLS role) or rejects every
--     query. Either failure mode is worse than no RLS.
--   * Drops the destructive `check_login_attempts()` trigger — application
--     drives exponential lockout via `recordFailedLogin`.
--   * Tombstones soft-deleted user emails so the unique index on
--     `email_hash WHERE deleted_at IS NULL` does not collide on restore.
--
-- This file is the SOURCE OF TRUTH for the auth schema. New environments
-- should run only this file (after dropping any partial state from 001..007).
-- Existing environments can run this on top of 001..007 safely thanks to
-- the IF NOT EXISTS / IF EXISTS guards.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) ENUM types (idempotent via DO blocks)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'deleted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mfa_type') THEN
    CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'hardware_key', 'backup_codes');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM ('active', 'expired', 'revoked', 'terminated_by_admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_event_type') THEN
    CREATE TYPE security_event_type AS ENUM (
      'brute_force_attempt',
      'suspicious_ip',
      'impossible_travel',
      'credential_stuffing',
      'account_takeover',
      'privilege_escalation',
      'mfa_disable_requested',
      'refresh_token_reuse'
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2) USERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Profile
    email VARCHAR(255) NOT NULL,
    -- email_hash is a generated stored column. It feeds the partial unique
    -- index below. The expression normalizes to lowercase before hashing so
    -- "User@Foo.com" and "user@foo.com" collide on the unique constraint.
    email_hash VARCHAR(64)
      GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,

    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,

    -- Authentication
    password_hash VARCHAR(255),
    last_password_change TIMESTAMPTZ,
    -- Most recent N password hashes; service de-duplicates and caps at 5.
    password_history JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Status & lifecycle
    status user_status NOT NULL DEFAULT 'active',
    status_reason TEXT,

    -- Platform-admin flag (NEVER inferred from a cast; explicit boolean)
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,

    -- Security settings
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_enforced_at TIMESTAMPTZ,
    mfa_backup_codes_generated_at TIMESTAMPTZ,
    login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    last_login_user_agent TEXT,
    last_failed_login_at TIMESTAMPTZ,
    last_failed_login_ip INET,

    -- Preferences
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    locale VARCHAR(10) NOT NULL DEFAULT 'en',
    preferred_mfa_method mfa_type,

    -- GDPR / legal
    accepted_terms_at TIMESTAMPTZ,
    accepted_terms_version VARCHAR(32),
    accepted_privacy_at TIMESTAMPTZ,
    accepted_privacy_version VARCHAR(32),
    marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
    marketing_consent_updated_at TIMESTAMPTZ,
    data_processing_consent BOOLEAN NOT NULL DEFAULT FALSE,

    -- Suspension (separate from soft-delete so audits stay accurate)
    suspended_at TIMESTAMPTZ,
    suspended_by UUID,

    -- Soft delete
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    deletion_reason TEXT,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    version INTEGER NOT NULL DEFAULT 1
);

-- Idempotent additive columns (existing 001 schemas missed some)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin                  BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_ip      INET;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at              TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by              UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_version    VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_privacy_version  VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent         BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_processing_consent   BOOLEAN     NOT NULL DEFAULT FALSE;

-- Defensive: ensure email_hash is generated. In environments where 001 did
-- not declare it as STORED, this won't be re-creatable safely; we only add
-- the column if missing on a fresh install.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email_hash'
  ) THEN
    ALTER TABLE users
      ADD COLUMN email_hash VARCHAR(64)
      GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED;
  END IF;
END $$;

-- Drop legacy Clerk column if it exists (no longer used)
ALTER TABLE users DROP COLUMN IF EXISTS clerk_user_id;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash
  ON users(email_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_status
  ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_locked
  ON users(locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_is_admin
  ON users(is_admin) WHERE is_admin = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_cursor
  ON users(created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3) USER SESSIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Tokens (only hashes are persisted)
    refresh_token_hash VARCHAR(64) NOT NULL,
    previous_refresh_token_hash VARCHAR(64),
    -- When the refresh hash was last rotated. Drives the replay-grace window
    -- in service.refreshAccessToken so legitimate retry storms do not get
    -- treated as theft.
    previous_refresh_rotated_at TIMESTAMPTZ,
    access_token_jti VARCHAR(255),

    -- Device context
    device_fingerprint VARCHAR(64),
    device_name VARCHAR(255),
    device_type VARCHAR(50),
    ip_address INET NOT NULL,
    ip_geo_country VARCHAR(2),
    ip_geo_city VARCHAR(100),
    user_agent TEXT,

    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL,

    -- Status
    status session_status NOT NULL DEFAULT 'active',
    terminated_at TIMESTAMPTZ,
    terminated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    termination_reason TEXT,

    -- MFA context
    mfa_verified_at TIMESTAMPTZ,
    mfa_expires_at TIMESTAMPTZ,

    CONSTRAINT valid_session_dates
      CHECK (expires_at > created_at AND absolute_expires_at > created_at)
);

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS previous_refresh_token_hash VARCHAR(64);
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS previous_refresh_rotated_at TIMESTAMPTZ;

-- Unique on the active hash. Previous hashes have a separate partial unique
-- index so two sessions cannot accidentally hold the same prior hash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token
  ON user_sessions(refresh_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_previous_refresh_token_unique
  ON user_sessions(previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON user_sessions(user_id, last_active_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sessions_cleanup
  ON user_sessions(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sessions_purge
  ON user_sessions(COALESCE(terminated_at, expires_at))
  WHERE status IN ('revoked', 'expired', 'terminated_by_admin');

-- ----------------------------------------------------------------------------
-- 4) MFA DEVICES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_mfa_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    device_type mfa_type NOT NULL,
    device_name VARCHAR(255) NOT NULL,

    -- Encrypted TOTP secret (AES-256-GCM with per-record salt)
    secret_encrypted TEXT,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,

    -- WebAuthn (reserved for future use)
    credential_id TEXT,
    public_key TEXT,
    sign_count INTEGER NOT NULL DEFAULT 0,

    -- Backup codes (hashed; default empty array so app never reads NULL)
    backup_codes_hash JSONB NOT NULL DEFAULT '[]'::jsonb,

    device_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,

    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    disabled_at TIMESTAMPTZ,
    disabled_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The legacy `UNIQUE(user_id, is_primary) DEFERRABLE INITIALLY DEFERRED`
-- prevents both two primary devices AND two non-primary devices per user.
-- Drop it and replace with a partial unique index that is correct.
ALTER TABLE user_mfa_devices DROP CONSTRAINT IF EXISTS one_primary_mfa;
DROP INDEX IF EXISTS one_primary_mfa;
DROP INDEX IF EXISTS one_primary_mfa_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_mfa
  ON user_mfa_devices(user_id)
  WHERE is_primary = TRUE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mfa_devices_user
  ON user_mfa_devices(user_id) WHERE is_active = TRUE;

-- Backfill: ensure no NULL backup_codes_hash from older inserts
UPDATE user_mfa_devices
   SET backup_codes_hash = '[]'::jsonb
 WHERE backup_codes_hash IS NULL;

-- ----------------------------------------------------------------------------
-- 5) EMAIL VERIFICATIONS (single source of truth for all email tokens)
-- ----------------------------------------------------------------------------
-- The application purpose-binds the token hash via
-- `hashEmailFlowToken(purpose, token)`. Storing `purpose` explicitly makes
-- lookups deterministic and audits clear, and lets a single user have one
-- active token per (email, purpose) pair simultaneously.
--
-- Allowed purposes (validated by the application, not the schema):
--   email_verification, password_reset, mfa_disable.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    purpose VARCHAR(32) NOT NULL DEFAULT 'email_verification',
    expires_at TIMESTAMPTZ NOT NULL,

    verified_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_verifications
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(32) NOT NULL DEFAULT 'email_verification';

-- Drop superseded constraints
ALTER TABLE email_verifications DROP CONSTRAINT IF EXISTS email_verifications_user_id_email_key;

-- (user_id, email, purpose) unique so each purpose owns one row at a time
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

-- One active token per (user, purpose) at a time
DROP INDEX IF EXISTS idx_email_verifications_active_token_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_active_token_hash
  ON email_verifications(token_hash) WHERE verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_verifications_user_purpose_active
  ON email_verifications(user_id, purpose) WHERE verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_verifications_cleanup
  ON email_verifications(expires_at) WHERE verified_at IS NULL;

-- Drop the legacy password_resets table if it survived from 001
DROP TABLE IF EXISTS password_resets;

-- ----------------------------------------------------------------------------
-- 6) SECURITY EVENTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    event_type security_event_type NOT NULL,
    severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 10),

    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    ip_address INET NOT NULL,
    ip_country VARCHAR(2),
    user_agent TEXT,
    device_fingerprint VARCHAR(64),

    description TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

    action_taken VARCHAR(100),
    blocked_until TIMESTAMPTZ,

    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    false_positive BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_user_time
  ON security_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_open
  ON security_events(event_type, created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_security_ip_time
  ON security_events(ip_address, created_at DESC);

-- ----------------------------------------------------------------------------
-- 7) AUDIT LOGS  ★ canonical schema matched to audit-logger.ts writer ★
-- ----------------------------------------------------------------------------
-- The auth module's `shared/middleware/audit-logger.ts` emits this exact set
-- of columns. Any column drift here causes silent INSERT failures and the
-- entire audit trail vanishes (it did, in the previous schema set).
--
-- Append-only by convention. Partitioning is recommended once volume passes
-- ~5M rows/month; a stub partitioning shell is left at the bottom of the file
-- as a comment for the next migration.
-- ----------------------------------------------------------------------------
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
  'Append-only audit trail for the auth module. Columns mirror audit-logger.ts.';

-- ----------------------------------------------------------------------------
-- 8) Triggers
-- ----------------------------------------------------------------------------
-- Generic updated_at + version bump
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = TG_TABLE_NAME AND column_name = 'version'
    ) THEN
       NEW.version = COALESCE(OLD.version, 0) + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_mfa_devices_updated_at ON user_mfa_devices;
CREATE TRIGGER update_mfa_devices_updated_at
  BEFORE UPDATE ON user_mfa_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- Drop the destructive auto-suspend trigger from 001. The application
-- (`utils.ts:lockoutDurationSeconds` + `recordFailedLogin`) drives lockout.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_check_login_attempts ON users;
DROP FUNCTION IF EXISTS check_login_attempts();

-- ----------------------------------------------------------------------------
-- Tombstone-on-soft-delete trigger.
-- The unique index on `email_hash WHERE deleted_at IS NULL` allows the same
-- email to be re-registered after a soft delete. To keep `restoreUser` safe
-- from violating the index, mutate the deleted user's email to a tombstoned
-- form. The generated email_hash recomputes automatically.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tombstone_deleted_email()
RETURNS TRIGGER AS $$
BEGIN
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
-- 9) Drop broken RLS policies.
-- The policies created in 001 reference a GUC (`app.current_user_id`) that
-- the auth code does not set. As written the policies either are silently
-- bypassed (BYPASSRLS role) or reject every query. Either way they are not
-- a real security boundary; remove them so future engineers do not assume
-- defense-in-depth that does not exist.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS user_isolation        ON users;
DROP POLICY IF EXISTS session_isolation     ON user_sessions;
DROP POLICY IF EXISTS mfa_device_isolation  ON user_mfa_devices;

ALTER TABLE users              DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa_devices   DISABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================================================
-- FUTURE: PARTITIONING (intentionally not applied here; handled in a later
-- migration once volume justifies it).
--
-- Recommended:
--   ALTER TABLE audit_logs RENAME TO audit_logs_old;
--   CREATE TABLE audit_logs (LIKE audit_logs_old INCLUDING ALL)
--     PARTITION BY RANGE (created_at);
--   -- per-month partitions, INSERT INTO audit_logs SELECT * FROM audit_logs_old;
--   -- attach old data, drop audit_logs_old.
-- ============================================================================

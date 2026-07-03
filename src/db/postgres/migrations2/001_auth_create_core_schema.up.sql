
-- ============================================================================
-- 001_auth_create_core_schema.up.sql
-- ----------------------------------------------------------------------------
-- Single, idempotent, safe-to-run-on-fresh-DB snapshot of the AUTH schema.
-- Consolidates migrations/{008,009,010,011,012,013,014} and supersedes the
-- conflicting orphan files {authtable.sql, 006, 007} in the legacy folder.
--
-- This file ALSO corrects the bugs documented in BUGFIXES.md. It is the
-- authoritative DDL for the auth module going forward and does not depend on
-- any file in migrations/.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) ENUM types
--    BUGFIX #2: the TypeScript `SecurityEventType` union in repository.ts
--    includes 'mfa_recovery_requested', but the enum in 008 did NOT, so any
--    call to recordSecurityEvent({ event_type: 'mfa_recovery_requested', ... })
--    threw a Postgres enum-violation. We add it here (ADD VALUE is only legal
--    outside a transaction block in older PG, so we guard it defensively).
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
    -- BUGFIX #2: 'mfa_recovery_requested' included from creation so the enum
    -- matches repository.ts exactly.
    CREATE TYPE security_event_type AS ENUM (
      'brute_force_attempt',
      'suspicious_ip',
      'impossible_travel',
      'credential_stuffing',
      'account_takeover',
      'privilege_escalation',
      'mfa_disable_requested',
      'mfa_recovery_requested',
      'refresh_token_reuse'
    );
  END IF;
END $$;

-- If the enum already exists (upgrading an existing DB) but is missing the new
-- values, add them. ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block on PG < 12; this DO block is the safe pattern (it raises a notice and
-- continues if the value already exists).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_event_type') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'mfa_recovery_requested'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'security_event_type')
    ) THEN
      ALTER TYPE security_event_type ADD VALUE IF NOT EXISTS 'mfa_recovery_requested';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'refresh_token_reuse'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'security_event_type')
    ) THEN
      ALTER TYPE security_event_type ADD VALUE IF NOT EXISTS 'refresh_token_reuse';
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2) USERS
--    BUGFIX #3: the legacy tombstone trigger (007/008) overwrote users.email
--    with 'deleted+<id>@tombstone.local' on soft-delete, destroying the
--    original address permanently. On restore, users.email was never
--    recovered, so the user could no longer log in and the profile showed a
--    garbage address. We add `original_email` so restore can recover it and
--    rewrite the trigger to preserve it.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Profile
    email VARCHAR(255) NOT NULL,
    -- email_hash is a GENERATED ALWAYS ... STORED column. The app MUST NOT try
    -- to write it (see BUGFIX #1 below for the repository.ts bug this documents).
    email_hash VARCHAR(64)
      GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
    -- BUGFIX #3: preserved at soft-delete so restoreUser can recover the real
    -- address instead of leaking the tombstone value.
    original_email VARCHAR(255),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,

    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,

    -- Authentication
    password_hash VARCHAR(255),
    last_password_change TIMESTAMPTZ,
    password_history JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Status & lifecycle
    status user_status NOT NULL DEFAULT 'active',
    status_reason TEXT,

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

    -- Suspension (distinct from soft-delete)
    suspended_at TIMESTAMPTZ,
    suspended_by UUID,

    -- Scheduled deletion (phase 3)
    deletion_scheduled_at TIMESTAMPTZ,

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

-- Additive columns for upgraded DBs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hash
  VARCHAR(64) GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED;
ALTER TABLE users ADD COLUMN IF NOT EXISTS original_email   VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin          BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_ip INET;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by      UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_version    VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_privacy_version  VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_processing_consent   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_scheduled_at     TIMESTAMPTZ;
ALTER TABLE users DROP COLUMN IF EXISTS clerk_user_id;

-- Indexes
-- BUGFIX #7: the legacy authtable.sql created idx_users_auth_lookup on
-- (email, status, password_hash). Indexing password_hash is pointless for
-- lookups (we never SELECT by it) and subtly leaks a per-user timing
-- distinguisher. We index on email_hash + status only.
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
CREATE INDEX IF NOT EXISTS idx_users_deletion_scheduled
  ON users(deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3) USER SESSIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    refresh_token_hash VARCHAR(64) NOT NULL,
    previous_refresh_token_hash VARCHAR(64),
    previous_refresh_rotated_at TIMESTAMPTZ,
    access_token_jti VARCHAR(255),

    device_fingerprint VARCHAR(64),
    device_name VARCHAR(255),
    device_type VARCHAR(50),
    ip_address INET NOT NULL,
    ip_geo_country VARCHAR(2),
    ip_geo_city VARCHAR(100),
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL,

    status session_status NOT NULL DEFAULT 'active',
    terminated_at TIMESTAMPTZ,
    terminated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    termination_reason TEXT,

    mfa_verified_at TIMESTAMPTZ,
    mfa_expires_at TIMESTAMPTZ,

    -- SSO / SAML context (phase 7)
    sso_provider_id UUID,
    login_method VARCHAR(32),
    saml_name_id TEXT,
    saml_session_index TEXT,

    CONSTRAINT valid_session_dates
      CHECK (expires_at > created_at AND absolute_expires_at > created_at)
);

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS previous_refresh_token_hash VARCHAR(64);
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS previous_refresh_rotated_at TIMESTAMPTZ;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS sso_provider_id   UUID;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS login_method      VARCHAR(32);
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS saml_name_id      TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS saml_session_index TEXT;

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
CREATE INDEX IF NOT EXISTS idx_sessions_saml_name_id
  ON user_sessions(saml_name_id) WHERE saml_name_id IS NOT NULL AND status = 'active';

-- ----------------------------------------------------------------------------
-- 4) MFA DEVICES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_mfa_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    device_type mfa_type NOT NULL,
    device_name VARCHAR(255) NOT NULL,

    secret_encrypted TEXT,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,

    credential_id TEXT,
    public_key TEXT,
    sign_count INTEGER NOT NULL DEFAULT 0,

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

-- The legacy `UNIQUE(user_id, is_primary) DEFERRABLE INITIALLY DEFERRED` is
-- wrong: it forbids TWO non-primary devices as well. Drop it in favour of the
-- partial unique index that only constrains (user_id) where primary+active.
ALTER TABLE user_mfa_devices DROP CONSTRAINT IF EXISTS one_primary_mfa;
DROP INDEX IF EXISTS one_primary_mfa;
DROP INDEX IF EXISTS one_primary_mfa_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_mfa
  ON user_mfa_devices(user_id)
  WHERE is_primary = TRUE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mfa_devices_user
  ON user_mfa_devices(user_id) WHERE is_active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_credential_id
  ON user_mfa_devices(credential_id)
  WHERE credential_id IS NOT NULL AND is_active = TRUE;

UPDATE user_mfa_devices
   SET backup_codes_hash = '[]'::jsonb
 WHERE backup_codes_hash IS NULL;

-- ----------------------------------------------------------------------------
-- 5) EMAIL VERIFICATIONS  (single source of truth for all email-flow tokens)
--    Purposes: email_verification, password_reset, mfa_disable,
--    account_unlock, account_deletion. The app purpose-binds the token hash.
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
ALTER TABLE email_verifications DROP CONSTRAINT IF EXISTS email_verifications_user_id_email_key;

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

DROP INDEX IF EXISTS idx_email_verifications_active_token_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_active_token_hash
  ON email_verifications(token_hash) WHERE verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_purpose_active
  ON email_verifications(user_id, purpose) WHERE verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_verifications_cleanup
  ON email_verifications(expires_at) WHERE verified_at IS NULL;

DROP TABLE IF EXISTS password_resets;

-- ----------------------------------------------------------------------------
-- 6) EMAIL MFA OTPs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_mfa_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES user_mfa_devices(id) ON DELETE CASCADE,

    code_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_mfa_otps_active_device
  ON email_mfa_otps(device_id) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_mfa_otps_user
  ON email_mfa_otps(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_mfa_otps_cleanup
  ON email_mfa_otps(expires_at) WHERE used_at IS NULL;

-- ----------------------------------------------------------------------------
-- 7) SECURITY EVENTS
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
-- 8) AUDIT LOGS  (one canonical definition â€” matches audit-logger.ts exactly)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    org_id UUID,
    impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL,

    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id UUID,

    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(64),

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
-- 9) TRUSTED DEVICES (phase 4)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_trusted_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(64) NOT NULL,
    device_name VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    trusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_active
  ON user_trusted_devices(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 10) LINKED IDENTITIES (phase 6) â€” OAuth social login / linking
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_linked_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),
    profile_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT user_linked_identities_provider_subject_unique
      UNIQUE (provider, provider_subject),
    CONSTRAINT user_linked_identities_user_provider_unique
      UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_linked_identities_user_active
  ON user_linked_identities(user_id) WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 11) AUTH EMAIL OUTBOX (phase 4)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    html TEXT NOT NULL,
    text TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    processing_started_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_pending
  ON auth_email_outbox(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_processing_started
  ON auth_email_outbox(processing_started_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_sent_cleanup
  ON auth_email_outbox(sent_at) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_failed_cleanup
  ON auth_email_outbox(created_at) WHERE status = 'failed';

-- ----------------------------------------------------------------------------
-- 12) Triggers & functions
-- ----------------------------------------------------------------------------

-- updated_at + version bump (generic).
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

-- BUGFIX #4: the destructive auto-suspend trigger from authtable.sql /
-- 001 (permanently 'suspended' any user after 5 failed attempts) is NOT
-- recreated here. Lockout is application-driven (utils.ts
-- lockoutDurationSeconds + repository.recordFailedLogin).
DROP TRIGGER IF EXISTS trigger_check_login_attempts ON users;
DROP FUNCTION IF EXISTS check_login_attempts();

-- BUGFIX #3: tombstone trigger that PRESERVES the original email instead of
-- destroying it. On the transition into deleted state we stash the real
-- address in original_email and then mutate email. restoreUser (repository.ts)
-- reads original_email back into email.
CREATE OR REPLACE FUNCTION tombstone_deleted_email()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL
     AND (OLD.deleted_at IS NULL OR OLD.email = NEW.email)
     AND NEW.email NOT LIKE 'deleted+%@tombstone.local'
  THEN
    -- Preserve the real address exactly once.
    IF NEW.original_email IS NULL THEN
      NEW.original_email := OLD.email;
    END IF;
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

COMMIT;

-- ============================================================================
-- Notes for the application layer (BUGFIX #1, #5):
--
-- #5 The migrate() runner must wrap 006_unify_email_token_flows.sql and
--    007_auth_security_hardening.sql individually, because they currently emit
--    a trailing COMMIT without an opening BEGIN. This consolidated file is
--    balanced BEGIN ... COMMIT and avoids the problem entirely.
-- ============================================================================


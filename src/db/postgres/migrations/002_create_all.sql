-- =============================================================================
-- Migration : 002_create_all.sql
-- Generated : 2026-07-19T18:06:43.456Z
-- Purpose   : Create ALL tables from canonical_migrations_draft in
--             dependency order. Each source file is included as-is, with
--             its own BEGIN/COMMIT removed (wrapped in a single outer TX).
--
-- Source     : canonical_migrations_draft/
-- =============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/001_billing_enums.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 001_billing_enums.sql
-- Description : Billing enums used throughout the billing module
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- =============================================================================
-- =============================================================================
-- Billing Plan Tier
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_plan_tier'
    ) THEN
        CREATE TYPE billing_plan_tier AS ENUM
        (
            'free',
            'starter',
            'growth',
            'business',
            'enterprise'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_plan_tier IS
'Commercial subscription tier.';


-- =============================================================================
-- Subscription Status
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_subscription_status'
    ) THEN
        CREATE TYPE billing_subscription_status AS ENUM
        (
            'trialing',
            'active',
            'past_due',
            'paused',
            'cancelled',
            'expired',
            'incomplete'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_subscription_status IS
'Current lifecycle status of an organization subscription.';


-- =============================================================================
-- Billing Provider
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_provider_type'
    ) THEN
        CREATE TYPE billing_provider_type AS ENUM
        (
            'stripe',
            'razorpay',
            'manual',
            'system'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_provider_type IS
'External billing/payment provider.';


-- =============================================================================
-- Billing Interval
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_interval_type'
    ) THEN
        CREATE TYPE billing_interval_type AS ENUM
        (
            'monthly',
            'annual'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_interval_type IS
'Subscription billing cycle.';


-- =============================================================================
-- Invoice Status
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_invoice_status'
    ) THEN
        CREATE TYPE billing_invoice_status AS ENUM
        (
            'draft',
            'open',
            'paid',
            'void',
            'uncollectible',
            'refunded'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_invoice_status IS
'Invoice lifecycle state.';


-- =============================================================================
-- Payment Status
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_payment_status'
    ) THEN
        CREATE TYPE billing_payment_status AS ENUM
        (
            'pending',
            'processing',
            'succeeded',
            'failed',
            'cancelled',
            'refunded'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_payment_status IS
'Status of an individual payment transaction.';


-- =============================================================================
-- Coupon Discount Type
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_coupon_discount_type'
    ) THEN
        CREATE TYPE billing_coupon_discount_type AS ENUM
        (
            'percentage',
            'fixed_amount'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_coupon_discount_type IS
'Coupon discount calculation method.';


-- =============================================================================
-- Feature Value Type
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_feature_value_type'
    ) THEN
        CREATE TYPE billing_feature_value_type AS ENUM
        (
            'boolean',
            'integer',
            'decimal',
            'string'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_feature_value_type IS
'Data type stored by a billing feature entitlement.';


-- =============================================================================
-- Feature Category
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_feature_category'
    ) THEN
        CREATE TYPE billing_feature_category AS ENUM
        (
            'monitoring',
            'ai',
            'alerts',
            'projects',
            'organization',
            'dashboard',
            'security',
            'limits',
            'integrations'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_feature_category IS
'Logical grouping of billable platform capabilities.';


-- =============================================================================
-- Subscription Event Type
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'subscription_event_type'
    ) THEN
        CREATE TYPE subscription_event_type AS ENUM
        (
            'created',
            'upgraded',
            'downgraded',
            'renewed',
            'trial_started',
            'trial_ended',
            'cancelled',
            'resumed',
            'expired',
            'payment_failed',
            'payment_succeeded',
            'addon_purchased',
            'feature_override_added'
        );
    END IF;
END $$;

COMMENT ON TYPE subscription_event_type IS
'Immutable subscription history events.';


-- =============================================================================
-- Subscription Event Actor
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'subscription_event_actor'
    ) THEN
        CREATE TYPE subscription_event_actor AS ENUM
        (
            'user',
            'admin',
            'system',
            'billing_provider'
        );
    END IF;
END $$;

COMMENT ON TYPE subscription_event_actor IS
'Entity responsible for the subscription event.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 00_shared/001_enable_pgcrypto.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 00_shared/002_create_set_updated_at.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 00_shared/003_create_update_updated_at_column.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/001_create_users.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'deleted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mfa_type') THEN
    CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'hardware_key', 'backup_codes');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  email_hash VARCHAR(64)
    GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
  original_email VARCHAR(255),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  full_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  password_hash VARCHAR(255),
  last_password_change TIMESTAMPTZ,
  password_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  status user_status NOT NULL DEFAULT 'active',
  status_reason TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
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
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
  locale VARCHAR(10) NOT NULL DEFAULT 'en',
  preferred_mfa_method mfa_type,
  accepted_terms_at TIMESTAMPTZ,
  accepted_terms_version VARCHAR(32),
  accepted_privacy_at TIMESTAMPTZ,
  accepted_privacy_version VARCHAR(32),
  marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_consent_updated_at TIMESTAMPTZ,
  data_processing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_at TIMESTAMPTZ,
  current_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  suspended_by UUID,
  deletion_scheduled_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  deletion_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_current_org
ON users(current_org_id)
WHERE current_org_id IS NOT NULL;
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

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/002_create_user_sessions.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM ('active', 'expired', 'revoked', 'terminated_by_admin');
  END IF;
END $$;

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
  saml_name_id VARCHAR(255),
  saml_session_index VARCHAR(255)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token
  ON user_sessions(refresh_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_previous_refresh_token_unique
  ON user_sessions(previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON user_sessions(user_id, status, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_cleanup
  ON user_sessions(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sessions_purge
  ON user_sessions(terminated_at) WHERE terminated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_saml_name_id
  ON user_sessions(saml_name_id) WHERE saml_name_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/003_create_user_mfa_devices.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================
-- ENUMS (if not already defined)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'webauthn', 'backup_code');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- MFA DEVICES TABLE REFACTOR
-- ============================================================

-- Rename device_type to type if needed, but since the existing schema uses device_type
-- and we want both type and device_type, let's make sure they both exist.

-- Note: The existing table in canonical_migrations_draft might not have device_type.
-- If user_mfa_devices is already running on migrations2, it has device_type mfa_type.
-- Wait, the user's migration specifies the EXACT CREATE TABLE statement, which means
-- they want to ensure these columns exist. We will ALTER TABLE to match the new schema.
-- ============================================================
-- ENUM (if not already defined)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'webauthn', 'backup_code');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- FINAL user_mfa_devices TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS user_mfa_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- MFA method type (what auth protocol: totp, sms, email, webauthn)
    type mfa_type NOT NULL,

    -- Device category (physical form factor: mobile_app, hardware_key, platform, etc.)
    device_type VARCHAR(50) NOT NULL DEFAULT 'unknown',

    device_name VARCHAR(255) NOT NULL,

    -- TOTP/HOTP
    secret_encrypted TEXT,

    -- SMS
    phone_e164 VARCHAR(32),

    -- Email OTP
    email VARCHAR(255),

    -- WebAuthn / FIDO2
    credential_id TEXT,
    public_key TEXT,
    sign_count INTEGER NOT NULL DEFAULT 0,

    -- Verification status
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,

    -- Usage tracking
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,

    -- Primary device flag (one per user)
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,

    -- Soft delete / disable
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    disabled_at TIMESTAMPTZ,
    disabled_reason TEXT,

    -- Extensible metadata (AAGUID, device info, registration extensions, etc.)
    device_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- One primary MFA device per user (active only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_one_primary
  ON user_mfa_devices(user_id)
  WHERE is_primary = TRUE AND is_active = TRUE;

-- List user's active MFA devices by type
CREATE INDEX IF NOT EXISTS idx_mfa_devices_user_type
  ON user_mfa_devices(user_id, type)
  WHERE is_active = TRUE;

-- WebAuthn credential ID uniqueness (active devices only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_credential_id
  ON user_mfa_devices(credential_id)
  WHERE credential_id IS NOT NULL AND is_active = TRUE;

-- Find devices by phone (for SMS)
CREATE INDEX IF NOT EXISTS idx_mfa_devices_phone
  ON user_mfa_devices(phone_e164)
  WHERE phone_e164 IS NOT NULL AND is_active = TRUE;

-- Find devices by email
CREATE INDEX IF NOT EXISTS idx_mfa_devices_email
  ON user_mfa_devices(email)
  WHERE email IS NOT NULL AND is_active = TRUE;

-- ============================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mfa_devices_updated_at ON user_mfa_devices;
CREATE TRIGGER trg_mfa_devices_updated_at
  BEFORE UPDATE ON user_mfa_devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
-- If 'device_type' was an enum previously, we might need to cast or rename it.
-- Assuming 'type' takes over the enum role, and 'device_type' becomes the string.
-- This depends on the exact current state. To be safe, we will just add missing columns
-- and drop the removed one.

-- ============================================================
-- BACKUP CODES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS user_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  used_from_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_backup_codes_user_unused
  ON user_backup_codes(user_id, created_at)
  WHERE used_at IS NULL;

-- ============================================================
-- EXTRACT EXISTING BACKUP CODES
-- ============================================================
-- We use a DO block or just INSERT ... SELECT with jsonb_array_elements_text
-- (Assuming backup_codes_hash or backup_codes_hashes exist and are JSONB arrays of strings)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_mfa_devices' AND column_name='backup_codes_hash') THEN
    INSERT INTO user_backup_codes (user_id, code_hash)
    SELECT d.user_id, jsonb_array_elements_text(d.backup_codes_hash) AS code_hash
    FROM user_mfa_devices d
    WHERE d.backup_codes_hash IS NOT NULL AND jsonb_typeof(d.backup_codes_hash) = 'array'
    ON CONFLICT DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_mfa_devices' AND column_name='backup_codes_hashes') THEN
    INSERT INTO user_backup_codes (user_id, code_hash)
    SELECT d.user_id, jsonb_array_elements_text(d.backup_codes_hashes) AS code_hash
    FROM user_mfa_devices d
    WHERE d.backup_codes_hashes IS NOT NULL AND jsonb_typeof(d.backup_codes_hashes) = 'array'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

ALTER TABLE user_mfa_devices DROP COLUMN IF EXISTS backup_codes_hashes;
ALTER TABLE user_mfa_devices DROP COLUMN IF EXISTS backup_codes_hash;


-- ============================================================
-- TRIGGER: Auto-revoke old backup codes
-- ============================================================

CREATE OR REPLACE FUNCTION generate_backup_codes_for_user(
  p_user_id UUID,
  p_count INTEGER DEFAULT 10
) RETURNS TABLE(code_plaintext TEXT, code_hash TEXT) AS $$
DECLARE
  v_code TEXT;
  v_hash TEXT;
BEGIN
  -- Generate N random backup codes and their hashes
  FOR i IN 1..p_count LOOP
    v_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
    v_hash := crypt(v_code, gen_salt('bf', 12));
    
    INSERT INTO user_backup_codes (user_id, code_hash)
    VALUES (p_user_id, v_hash);
    
    code_plaintext := v_code;
    code_hash := v_hash;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION revoke_and_regenerate_backup_codes()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when a device becomes newly verified
  IF NEW.is_verified = TRUE AND (OLD.is_verified = FALSE OR OLD.is_verified IS NULL) THEN
    -- Revoke all existing unused backup codes
    DELETE FROM user_backup_codes
    WHERE user_id = NEW.user_id AND used_at IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_revoke_backup_codes ON user_mfa_devices;
CREATE TRIGGER auto_revoke_backup_codes
  AFTER UPDATE ON user_mfa_devices
  FOR EACH ROW
  WHEN (NEW.is_verified = TRUE AND OLD.is_verified = FALSE)
  EXECUTE FUNCTION revoke_and_regenerate_backup_codes();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/004_create_email_verifications.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_verifications_user_purpose_email_key'
  ) THEN
    ALTER TABLE email_verifications
      ADD CONSTRAINT email_verifications_user_purpose_email_key
      UNIQUE (user_id, email, purpose);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_active_token_hash
  ON email_verifications(token_hash)
  WHERE verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_purpose_active
  ON email_verifications(user_id, purpose)
  WHERE verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_verifications_cleanup
  ON email_verifications(expires_at)
  WHERE verified_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/005_create_email_mfa_otps.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

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
  ON email_mfa_otps(device_id)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_mfa_otps_user
  ON email_mfa_otps(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_mfa_otps_cleanup
  ON email_mfa_otps(expires_at)
  WHERE used_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/006_create_security_events.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_event_type') THEN
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
  ON security_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_open
  ON security_events(event_type, created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_security_ip_time
  ON security_events(ip_address, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/007_create_user_trusted_devices.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/008_create_user_linked_identities.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

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
  ON user_linked_identities(user_id)
  WHERE revoked_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/009_add_linked_identity_active_lookup_index.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_linked_identities_provider_subject_active
  ON user_linked_identities(provider, provider_subject)
  WHERE revoked_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/010_create_auth_email_outbox.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE auth_email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    to_email VARCHAR(255) NOT NULL,

    subject VARCHAR(500) NOT NULL,

    html TEXT NOT NULL,

    text TEXT NOT NULL,

    template_name VARCHAR(100),

    template_data JSONB NOT NULL DEFAULT '{}'::jsonb,

    dedupe_key VARCHAR(255),

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (
        status IN (
            'pending',
            'processing',
            'sent',
            'failed',
            'cancelled'
        )
    ),

    attempts INTEGER NOT NULL DEFAULT 0,

    max_attempts INTEGER NOT NULL DEFAULT 5,

    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    processing_started_at TIMESTAMPTZ,

    processing_worker_id UUID,

    processing_expires_at TIMESTAMPTZ,

    last_error TEXT,

    sent_at TIMESTAMPTZ,

    failed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_email_pending
ON auth_email_outbox(next_attempt_at, created_at)
WHERE status='pending';
CREATE INDEX idx_email_processing
ON auth_email_outbox(processing_started_at)
WHERE status='processing';
CREATE INDEX idx_email_sent
ON auth_email_outbox(sent_at)
WHERE status='sent';
CREATE INDEX idx_email_sent
ON auth_email_outbox(sent_at)
WHERE status='sent';
CREATE UNIQUE INDEX idx_email_dedupe
ON auth_email_outbox(dedupe_key)
WHERE dedupe_key IS NOT NULL
AND status IN ('pending','processing');

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/001_create_organizations.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_status') THEN
    CREATE TYPE org_status AS ENUM ('active', 'trialing', 'suspended', 'locked', 'archived', 'delinquent');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT,
  logo_url TEXT,
  website_url TEXT,
  industry VARCHAR(100),
  company_size VARCHAR(50),
  country VARCHAR(100),
  timezone VARCHAR(100) DEFAULT 'UTC',
  billing_email VARCHAR(255),
  support_email VARCHAR(255),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  status org_status NOT NULL DEFAULT 'trialing',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_slug_active
  ON organizations(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orgs_owner
  ON organizations(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orgs_status
  ON organizations(status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_org_updated_at ON organizations;
CREATE TRIGGER trg_org_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/002_create_organization_settings.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_settings (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enforce_sso BOOLEAN NOT NULL DEFAULT FALSE,
  enforce_mfa BOOLEAN NOT NULL DEFAULT FALSE,
  session_timeout_minutes INTEGER NOT NULL DEFAULT 480 CHECK (session_timeout_minutes >= 5),
  mfa_allowed_methods TEXT[] NOT NULL DEFAULT ARRAY['totp', 'email', 'hardware_key', 'backup_codes'],
  mfa_primary_method_preference VARCHAR(50),
  mfa_backup_codes_required BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_grace_period_days INTEGER NOT NULL DEFAULT 7
    CHECK (mfa_grace_period_days >= 0 AND mfa_grace_period_days <= 365),
  mfa_max_devices_per_user INTEGER NOT NULL DEFAULT 10
    CHECK (mfa_max_devices_per_user >= 1 AND mfa_max_devices_per_user <= 50),
  mfa_allow_sms_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_allow_email_fallback BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_remember_device_days INTEGER NOT NULL DEFAULT 30
    CHECK (mfa_remember_device_days >= 0 AND mfa_remember_device_days <= 365),
  data_region VARCHAR(50) NOT NULL DEFAULT 'us-east-1',
  data_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (data_retention_days >= 1),
  audit_log_retention_days INTEGER NOT NULL DEFAULT 365 CHECK (audit_log_retention_days >= 30),
  allow_public_projects BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_org_settings_updated_at ON organization_settings;
CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/003_create_organization_members.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE member_status AS ENUM ('invited', 'active', 'suspended', 'removed', 'locked');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE org_role AS ENUM ('owner', 'admin', 'developer', 'billing', 'security', 'member', 'viewer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'joined_method') THEN
    CREATE TYPE joined_method AS ENUM ('invite', 'admin_add', 'sso_auto_provision', 'scim');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'member',
  status member_status NOT NULL DEFAULT 'invited',
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  joined_method joined_method NOT NULL DEFAULT 'invite',
  last_active_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  deactivated_by UUID REFERENCES users(id),
  deactivation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org
  ON organization_members(org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_members_user
  ON organization_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_org_members_role
  ON organization_members(org_id, role)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_org_members_updated_at ON organization_members;
CREATE TRIGGER trg_org_members_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/004_create_organization_invitations.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
    CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined', 'revoked', 'expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE org_role AS ENUM ('owner', 'admin', 'developer', 'billing', 'security', 'member', 'viewer');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES users(id),
  email VARCHAR(255) NOT NULL,
  email_hash VARCHAR(64)
    GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
  role org_role NOT NULL DEFAULT 'member',
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status invitation_status NOT NULL DEFAULT 'pending',
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(id),
  declined_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  resent_count INTEGER NOT NULL DEFAULT 0,
  last_resent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_invite
  ON organization_invitations(org_id, email)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_invitations_token
  ON organization_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org
  ON organization_invitations(org_id, status);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/005_create_quota_requests.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quota_request_status') THEN
    CREATE TYPE quota_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS quota_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quota_type VARCHAR(50) NOT NULL,
  current_limit BIGINT NOT NULL CHECK (current_limit >= 0),
  requested_limit BIGINT NOT NULL CHECK (requested_limit > current_limit),
  reason TEXT NOT NULL,
  status quota_request_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quota_requests_org
  ON quota_requests(org_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_quota_requests_updated_at ON quota_requests;
CREATE TRIGGER trg_quota_requests_updated_at
  BEFORE UPDATE ON quota_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/006_create_organization_audit_logs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email VARCHAR(255),
  actor_ip INET,
  actor_user_agent TEXT,
  actor_session_id UUID,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  entity_name VARCHAR(255),
  request_id UUID,
  correlation_id UUID,
  http_method VARCHAR(10),
  endpoint TEXT,
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failure')),
  failure_reason TEXT,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_audit_org_created
  ON organization_audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_audit_actor
  ON organization_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_entity
  ON organization_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_action
  ON organization_audit_logs(org_id, action);
CREATE INDEX IF NOT EXISTS idx_org_audit_sensitive
  ON organization_audit_logs(org_id, is_sensitive)
  WHERE is_sensitive = TRUE;
CREATE INDEX IF NOT EXISTS idx_org_audit_metadata_gin
  ON organization_audit_logs USING GIN (metadata);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/009_create_organization_security_events.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  event_type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_security_events_org
  ON organization_security_events(org_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/010_create_organization_email_outbox.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID,
  email_type VARCHAR(50) NOT NULL DEFAULT 'generic',
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  dedupe_key VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_org_email_outbox_due
  ON organization_email_outbox(next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_email_outbox_org
  ON organization_email_outbox(org_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_email_outbox_dedupe
  ON organization_email_outbox(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status <> 'failed';

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/011_create_organization_alert_thresholds.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_alert_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID,
  p50_threshold_ms INTEGER NOT NULL DEFAULT 300 CHECK (p50_threshold_ms > 0),
  p75_threshold_ms INTEGER NOT NULL DEFAULT 500 CHECK (p75_threshold_ms > 0),
  p90_threshold_ms INTEGER NOT NULL DEFAULT 800 CHECK (p90_threshold_ms > 0),
  p95_threshold_ms INTEGER NOT NULL DEFAULT 1000 CHECK (p95_threshold_ms > 0),
  p99_threshold_ms INTEGER NOT NULL DEFAULT 2000 CHECK (p99_threshold_ms > 0),
  p50_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  p75_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  p90_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  p95_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  p99_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  error_rate_threshold_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00
    CHECK (error_rate_threshold_percent >= 0 AND error_rate_threshold_percent <= 100),
  error_rate_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  apdex_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.85
    CHECK (apdex_threshold >= 0 AND apdex_threshold <= 1),
  apdex_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  evaluation_window_minutes INTEGER NOT NULL DEFAULT 5 CHECK (evaluation_window_minutes >= 1),
  cooldown_minutes INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_minutes >= 0),
  alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notify_emails TEXT[] NOT NULL DEFAULT '{}',
  last_alerted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_alert_thresholds_scope
  ON organization_alert_thresholds(
    org_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_org_alert_thresholds_org
  ON organization_alert_thresholds(org_id);

DROP TRIGGER IF EXISTS trg_org_alert_thresholds_updated_at ON organization_alert_thresholds;
CREATE TRIGGER trg_org_alert_thresholds_updated_at
  BEFORE UPDATE ON organization_alert_thresholds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 02_organizations/0012_create_organizations_domains.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Organization
-- Migration   : 003_organization_verified_domains.sql
-- Description : Organization verified domains
-- PostgreSQL  : 16+
-- Depends On  : 002_organizations.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS organization_verified_domains
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    domain VARCHAR(255) NOT NULL,

    is_primary BOOLEAN NOT NULL DEFAULT FALSE,

    is_verified BOOLEAN NOT NULL DEFAULT FALSE,

    auto_join_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    verification_method VARCHAR(30)
        CHECK
        (
            verification_method IN
            (
                'dns_txt',
                'dns_cname',
                'html_file',
                'manual'
            )
        ),

    verification_token VARCHAR(255),

    verification_started_at TIMESTAMPTZ,

    verified_at TIMESTAMPTZ,

    verified_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    last_verification_check_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_domain_lowercase
        CHECK (domain = lower(domain))
);

COMMENT ON TABLE organization_verified_domains IS
'Verified email domains owned by an organization. Used for SSO discovery, auto-join and enterprise onboarding.';

-- One domain belongs to only one active organization

CREATE UNIQUE INDEX IF NOT EXISTS uq_verified_domain
ON organization_verified_domains(domain)
WHERE deleted_at IS NULL;

-- Only one primary domain per organization

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_primary_domain
ON organization_verified_domains(organization_id)
WHERE is_primary = TRUE
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_org
ON organization_verified_domains(organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_verified
ON organization_verified_domains(is_verified)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_auto_join
ON organization_verified_domains(auto_join_enabled)
WHERE auto_join_enabled = TRUE
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_verification_check
ON organization_verified_domains(last_verification_check_at)
WHERE is_verified = FALSE
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_metadata
ON organization_verified_domains
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_organization_verified_domains_updated_at
ON organization_verified_domains;

CREATE TRIGGER trg_organization_verified_domains_updated_at
BEFORE UPDATE
ON organization_verified_domains
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/001_create_organization_sso_providers.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  entity_id TEXT,
  sso_url TEXT,
  x509_certificate TEXT,
  domain VARCHAR(255),
  oidc_issuer TEXT,
  oidc_client_id TEXT,
  oidc_client_secret_encrypted TEXT,
  oidc_scopes TEXT,
  oidc_jit_provision BOOLEAN NOT NULL DEFAULT FALSE,
  oidc_jit_default_role VARCHAR(50) NOT NULL DEFAULT 'member',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_providers_org
  ON organization_sso_providers(org_id);
CREATE INDEX IF NOT EXISTS idx_sso_providers_active_domain_type
  ON organization_sso_providers(provider_type, LOWER(domain))
  WHERE is_active = TRUE AND domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sso_providers_active_entity_id
  ON organization_sso_providers(entity_id)
  WHERE is_active = TRUE AND provider_type = 'saml' AND entity_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/002_create_organization_scim_tokens.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_scim_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scim_tokens_org
  ON organization_scim_tokens(org_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scim_tokens_org_token_active
  ON organization_scim_tokens(org_id, token_hash)
  WHERE revoked_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/003_create_scim_user_mappings.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scim_user_mappings (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, external_id),
  CONSTRAINT scim_user_mappings_org_user_unique UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_user_mappings_user
  ON scim_user_mappings(user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/004_create_organization_scim_token_scopes.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_scim_token_scopes (
  token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
  scope VARCHAR(50) NOT NULL CHECK (scope IN (
    'users:read', 'users:write', 'users:delete',
    'groups:read', 'groups:write', 'groups:delete',
    'bulk'
  )),
  PRIMARY KEY (token_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_scim_token_scopes_scope
  ON organization_scim_token_scopes(scope);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/005_create_organization_scim_token_ips.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organization_scim_token_ips (
  token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
  ip_cidr CIDR NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (token_id, ip_cidr)
);

CREATE INDEX IF NOT EXISTS idx_scim_token_ips_token
  ON organization_scim_token_ips(token_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/006_create_scim_groups.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scim_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  meta_version INTEGER NOT NULL DEFAULT 1,
  meta_created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta_last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (org_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_groups_org
  ON scim_groups(org_id);
CREATE INDEX IF NOT EXISTS idx_scim_groups_org_external
  ON scim_groups(org_id, external_id);
CREATE INDEX IF NOT EXISTS idx_scim_groups_org_display_name
  ON scim_groups(org_id, display_name);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/007_create_scim_group_memberships.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scim_group_memberships (
  group_id UUID NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_user
  ON scim_group_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_org
  ON scim_group_memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_group
  ON scim_group_memberships(group_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/008_create_saml_sessions.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS saml_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES organization_sso_providers(id) ON DELETE CASCADE,
  saml_name_id VARCHAR(512) NOT NULL,
  saml_name_id_format VARCHAR(100),
  saml_session_index VARCHAR(255),
  issuer VARCHAR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_lookup
  ON saml_sessions(provider_id, saml_name_id);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_session
  ON saml_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_expiry
  ON saml_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_provider_session_index
  ON saml_sessions(provider_id, saml_session_index)
  WHERE saml_session_index IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/009_extend_organization_scim_tokens_for_rotation.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE organization_scim_tokens
  ADD COLUMN IF NOT EXISTS rotated_from UUID REFERENCES organization_scim_tokens(id),
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scim_tokens_rotated_from
  ON organization_scim_tokens(rotated_from)
  WHERE rotated_from IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scim_tokens_grace_window
  ON organization_scim_tokens(grace_period_ends_at)
  WHERE grace_period_ends_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 03_org_identity/010_extend_user_sessions_for_sso_provider_type.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS sso_provider_id UUID,
  ADD COLUMN IF NOT EXISTS sso_provider_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS login_method VARCHAR(32),
  ADD COLUMN IF NOT EXISTS saml_name_id TEXT,
  ADD COLUMN IF NOT EXISTS saml_session_index TEXT;

CREATE INDEX IF NOT EXISTS idx_user_sessions_sso_provider
  ON user_sessions(sso_provider_id, sso_provider_type)
  WHERE sso_provider_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 04_projects/001_create_projects.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_status') THEN
    CREATE TYPE project_status AS ENUM ('active', 'archived', 'suspended');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_environment') THEN
    CREATE TYPE project_environment AS ENUM ('development', 'production');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  description TEXT,
  status project_status NOT NULL DEFAULT 'active',
  default_environment project_environment NOT NULL DEFAULT 'production',
  icon VARCHAR(255),
  color VARCHAR(20),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_org
  ON projects(org_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_status
  ON projects(status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_cursor
  ON projects(org_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_archived
  ON projects(archived_at)
  WHERE archived_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_org_status
  ON projects(org_id, status)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 04_projects/002_create_project_members.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_member_role') THEN
    CREATE TYPE project_member_role AS ENUM ('owner', 'admin', 'developer', 'viewer');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role project_member_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(32) DEFAULT 'active',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_members_project_user_unique
  ON project_members(project_id, user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project
  ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user
  ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_org_user
  ON project_members(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_role
  ON project_members(project_id, role);
CREATE INDEX IF NOT EXISTS idx_project_members_status
  ON project_members(status);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 04_projects/003_create_project_releases.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment project_environment NOT NULL,
  version VARCHAR(100) NOT NULL,
  commit_sha VARCHAR(64),
  branch VARCHAR(150),
  released_by UUID REFERENCES users(id),
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_project_releases_project
  ON project_releases(project_id);
CREATE INDEX IF NOT EXISTS idx_project_releases_environment
  ON project_releases(environment);
CREATE INDEX IF NOT EXISTS idx_project_releases_version
  ON project_releases(project_id, version);
CREATE INDEX IF NOT EXISTS idx_project_releases_time
  ON project_releases(project_id, released_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_releases_project_env_time
  ON project_releases(project_id, environment, released_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_releases_commit
  ON project_releases(commit_sha)
  WHERE commit_sha IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 04_projects/004_create_project_settings.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  retention_days INTEGER DEFAULT 30,
  max_events_per_second INTEGER DEFAULT 1000,
  auto_archive BOOLEAN DEFAULT FALSE,
  alerting_enabled BOOLEAN DEFAULT TRUE,
  ingestion_enabled BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_settings_project
  ON project_settings(project_id);
CREATE INDEX IF NOT EXISTS idx_project_settings_org
  ON project_settings(organization_id);

COMMENT ON TABLE project_settings IS 'Per-project configuration and operational limits';

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 05_project_credentials/001_create_project_api_keys.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_status') THEN
    CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment project_environment NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix VARCHAR(20) NOT NULL,
  scopes TEXT[] DEFAULT '{}',
  status api_key_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  revoked_by UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_project
  ON project_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_org
  ON project_api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
  ON project_api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_status
  ON project_api_keys(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_expiry
  ON project_api_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used
  ON project_api_keys(last_used_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_project_env
  ON project_api_keys(project_id, environment)
  WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_cleanup
  ON project_api_keys(revoked_at, deleted_at)
  WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/001_create_connector_configs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Connectors
-- Description : connector_configs table
-- =============================================================================
CREATE TABLE IF NOT EXISTS connector_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,

    provider VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,

    status VARCHAR(30) NOT NULL DEFAULT 'pending_setup'
        CHECK (status IN (
            'pending_setup','active','inactive',
            'disabled','expired','revoked',
            'degraded','error','rate_limited'
        )),

    is_default BOOLEAN NOT NULL DEFAULT FALSE,

    public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    supports_rich_formatting BOOLEAN NOT NULL DEFAULT FALSE,
    supports_threading BOOLEAN NOT NULL DEFAULT FALSE,
    supports_attachments BOOLEAN NOT NULL DEFAULT FALSE,

    rate_limit_requests INTEGER NOT NULL DEFAULT 60,
    rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60,

    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_backoff_base_ms INTEGER NOT NULL DEFAULT 1000,
    retry_backoff_multiplier NUMERIC(5,2) NOT NULL DEFAULT 2.0,

    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    failure_threshold INTEGER NOT NULL DEFAULT 5,

    last_health_check_at TIMESTAMPTZ,
    last_successful_delivery_at TIMESTAMPTZ,

    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_name_org
ON connector_configs (organization_id, lower(name))
WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/002_create_connector_credentials.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,

    credential_type VARCHAR(50) NOT NULL,
    key_name VARCHAR(100) NOT NULL,

    encrypted_value BYTEA NOT NULL,

    algorithm VARCHAR(50),
    version INTEGER NOT NULL DEFAULT 1,

    expires_at TIMESTAMPTZ,
    rotated_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,

    created_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(connector_id,key_name)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/003_create_connector_secret_versions.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_secret_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id UUID NOT NULL REFERENCES connector_credentials(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    encrypted_value BYTEA NOT NULL,
    rotated_by UUID REFERENCES users(id),
    rotated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/004_create_connector_routes.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    environment VARCHAR(30),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(30),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT connector_routes_environment_check
      CHECK (environment IS NULL OR environment IN ('development', 'staging', 'production'))
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/005_create_connector_deliveries.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_deliveries (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
    route_id UUID REFERENCES connector_routes(id) ON DELETE SET NULL,
    event_id UUID,
    alert_id UUID,
    notification_type VARCHAR(100) NOT NULL DEFAULT 'alert',
    severity VARCHAR(30) NOT NULL DEFAULT 'info',

    status VARCHAR(30) NOT NULL,
    http_status INTEGER,
    provider_request_id VARCHAR(255),
    external_message_id VARCHAR(255),

    payload JSONB NOT NULL,
    payload_size_bytes INTEGER,
    provider_response JSONB,
    response_body TEXT,
    response_status_code INTEGER,
    error_message TEXT,
    error_details JSONB,

    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    duration_ms INTEGER,
    delivery_latency_ms INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
    parent_delivery_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_deliveries_default
PARTITION OF connector_deliveries DEFAULT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/006_create_connector_delivery_attempts.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_delivery_attempts (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL,
    delivery_created_at TIMESTAMPTZ NOT NULL,

    attempt_number INTEGER NOT NULL,
    status VARCHAR(30) NOT NULL,
    http_status INTEGER,

    error_code VARCHAR(100),
    error_message TEXT,

    response JSONB,

    duration_ms INTEGER,

    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, attempted_at),
    FOREIGN KEY (delivery_id, delivery_created_at)
        REFERENCES connector_deliveries(id, created_at) ON DELETE CASCADE
) PARTITION BY RANGE (attempted_at);

CREATE TABLE IF NOT EXISTS connector_delivery_attempts_default
PARTITION OF connector_delivery_attempts DEFAULT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/007_create_connector_health_checks.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_health_checks (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,

    status VARCHAR(20) NOT NULL,
    http_status INTEGER,

    dns_time_ms INTEGER,
    tls_time_ms INTEGER,
    connect_time_ms INTEGER,
    response_time_ms INTEGER,

    error_code VARCHAR(100),
    error_message TEXT,

    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, checked_at)
) PARTITION BY RANGE (checked_at);

CREATE TABLE IF NOT EXISTS connector_health_checks_default
PARTITION OF connector_health_checks DEFAULT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/008_create_connector_test_runs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_test_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
    triggered_by UUID REFERENCES users(id),
    status VARCHAR(30) NOT NULL,
    response JSONB,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/009_create_connector_oauth_states.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_oauth_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID REFERENCES connector_configs(id) ON DELETE CASCADE,
    state VARCHAR(255) NOT NULL UNIQUE,
    code_verifier TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/010_create_connector_audit_logs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,

    action VARCHAR(100) NOT NULL,
    actor_id UUID REFERENCES users(id),
    actor_type VARCHAR(50),

    previous_state JSONB,
    new_state JSONB,
    changes_summary JSONB,

    ip_address INET,
    user_agent TEXT,
    request_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_audit_logs_default
PARTITION OF connector_audit_logs DEFAULT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/011_create_connector_indexes.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Connector Module - Enterprise Indexes
-- =============================================================================
-- ============================================================================
-- connector_configs
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_name_org
ON connector_configs (organization_id, lower(name))
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_org
ON connector_configs (organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_project
ON connector_configs (project_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_provider
ON connector_configs (provider)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_status
ON connector_configs (status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_default
ON connector_configs (organization_id, is_default)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_last_health
ON connector_configs (last_health_check_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_last_delivery
ON connector_configs (last_successful_delivery_at DESC);

-- ============================================================================
-- connector_credentials
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_credential_key
ON connector_credentials (connector_id, key_name);

CREATE INDEX IF NOT EXISTS idx_credentials_connector
ON connector_credentials (connector_id);

CREATE INDEX IF NOT EXISTS idx_credentials_type
ON connector_credentials (credential_type);

CREATE INDEX IF NOT EXISTS idx_credentials_expiry
ON connector_credentials (expires_at)
WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credentials_last_used
ON connector_credentials (last_used_at DESC);

-- ============================================================================
-- connector_secret_versions
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_secret_versions_lookup
ON connector_secret_versions (credential_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_secret_rotated_at
ON connector_secret_versions (rotated_at DESC);

-- ============================================================================
-- connector_routes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_routes_connector
ON connector_routes (connector_id);

CREATE INDEX IF NOT EXISTS idx_routes_project
ON connector_routes (project_id);

CREATE INDEX IF NOT EXISTS idx_routes_environment
ON connector_routes (environment);

CREATE INDEX IF NOT EXISTS idx_routes_event
ON connector_routes (event_type);

CREATE INDEX IF NOT EXISTS idx_routes_enabled
ON connector_routes (enabled);

CREATE INDEX IF NOT EXISTS idx_routes_lookup
ON connector_routes (project_id, environment, event_type, severity, enabled);

-- ============================================================================
-- connector_deliveries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_delivery_connector
ON connector_deliveries (connector_id);

CREATE INDEX IF NOT EXISTS idx_delivery_org_created
ON connector_deliveries (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_alert
ON connector_deliveries (alert_id);

CREATE INDEX IF NOT EXISTS idx_delivery_event
ON connector_deliveries (event_id);

CREATE INDEX IF NOT EXISTS idx_delivery_status
ON connector_deliveries (status);

CREATE INDEX IF NOT EXISTS idx_delivery_next_retry
ON connector_deliveries (next_retry_at)
WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_correlation
ON connector_deliveries (correlation_id);

CREATE INDEX IF NOT EXISTS idx_delivery_created
ON connector_deliveries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_lookup
ON connector_deliveries (connector_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_payload_gin
ON connector_deliveries
USING GIN (payload);

CREATE INDEX IF NOT EXISTS idx_delivery_response_gin
ON connector_deliveries
USING GIN (provider_response);

-- ============================================================================
-- connector_delivery_attempts
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_attempt_delivery
ON connector_delivery_attempts (delivery_id);

CREATE INDEX IF NOT EXISTS idx_attempt_status
ON connector_delivery_attempts (status);

CREATE INDEX IF NOT EXISTS idx_attempt_time
ON connector_delivery_attempts (attempted_at DESC);

-- ============================================================================
-- connector_health_checks
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_health_connector_recent
ON connector_health_checks (connector_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_status
ON connector_health_checks (status);

CREATE INDEX IF NOT EXISTS idx_health_checked_at
ON connector_health_checks (checked_at DESC);

-- ============================================================================
-- connector_test_runs
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_test_connector
ON connector_test_runs (connector_id);

CREATE INDEX IF NOT EXISTS idx_test_created
ON connector_test_runs (created_at DESC);

-- ============================================================================
-- connector_oauth_states
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_state
ON connector_oauth_states (state);

CREATE INDEX IF NOT EXISTS idx_oauth_expiry
ON connector_oauth_states (expires_at);

CREATE INDEX IF NOT EXISTS idx_oauth_connector
ON connector_oauth_states (connector_id);

-- ============================================================================
-- connector_audit_logs
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_org_created
ON connector_audit_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_connector_created
ON connector_audit_logs (connector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor
ON connector_audit_logs (actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_request
ON connector_audit_logs (request_id);

CREATE INDEX IF NOT EXISTS idx_audit_changes_gin
ON connector_audit_logs
USING GIN (changes_summary);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/012_create_connector_partition_functions.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Generic Monthly Partition Creation Function
-- Supports all RANGE partitioned tables
-- =============================================================================
CREATE OR REPLACE FUNCTION create_monthly_partition(
    p_parent_table TEXT,
    p_partition_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_partition_name TEXT;
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- Normalize to first day of month
    v_start_date := date_trunc('month', p_partition_date)::DATE;
    v_end_date := (v_start_date + INTERVAL '1 month')::DATE;

    v_partition_name :=
        format(
            '%s_%s',
            p_parent_table,
            to_char(v_start_date, 'YYYY_MM')
        );

    EXECUTE format(
        '
        CREATE TABLE IF NOT EXISTS %I
        PARTITION OF %I
        FOR VALUES FROM (%L) TO (%L)
        ',
        v_partition_name,
        p_parent_table,
        v_start_date,
        v_end_date
    );

    RAISE NOTICE 'Partition % created.', v_partition_name;

EXCEPTION
WHEN OTHERS THEN
    RAISE EXCEPTION
        'Failed creating partition for table %, month %: %',
        p_parent_table,
        v_start_date,
        SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION create_future_monthly_partitions(
    p_months_ahead INTEGER DEFAULT 2
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_month DATE;
    i INTEGER;
BEGIN
    FOR i IN 0..p_months_ahead LOOP

        v_month :=
            (date_trunc('month', CURRENT_DATE)
             + make_interval(months => i))::DATE;

        PERFORM create_monthly_partition(
            'connector_deliveries',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_delivery_attempts',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_health_checks',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_audit_logs',
            v_month
        );

    END LOOP;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 06_connectors/013_scrub_response_bodies.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Scrub success bodies from previous deliveries (BUG-08)
UPDATE connector_deliveries
SET response_body = NULL,
    provider_response = NULL
WHERE status = 'sent' AND response_body IS NOT NULL;

-- Truncate error messages that are too long
UPDATE connector_deliveries
SET error_message = left(error_message, 2000)
WHERE length(error_message) > 2000;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 07_notifications/001_create_notification_types.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_severity') THEN
    CREATE TYPE notification_severity AS ENUM (
      'info', 'warning', 'error', 'critical'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status') THEN
    CREATE TYPE delivery_status AS ENUM (
      'pending', 'sent', 'delivered', 'failed', 'retrying', 'cancelled'
    );
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 07_notifications/002_create_notification_templates.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  connector_type connector_type NOT NULL,
  template_format VARCHAR(50) NOT NULL DEFAULT 'markdown',
  subject_template TEXT,
  body_template TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_template_name_per_org
  ON notification_templates(organization_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_templates_org_type
  ON notification_templates(organization_id, connector_type)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 07_notifications/003_create_notification_routes.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notification_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  event_types VARCHAR(100)[] NOT NULL DEFAULT '{}',
  severity_levels notification_severity[] NOT NULL DEFAULT '{}',
  source_services VARCHAR(100)[] NOT NULL DEFAULT '{}',
  target_connector_ids UUID[] NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  throttle_window_seconds INTEGER,
  max_notifications_per_window INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_name_per_org
  ON notification_routes(organization_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_routes_org_active
  ON notification_routes(organization_id, priority DESC)
  WHERE deleted_at IS NULL AND is_active;

DROP TRIGGER IF EXISTS trg_notification_routes_updated_at ON notification_routes;
CREATE TRIGGER trg_notification_routes_updated_at
  BEFORE UPDATE ON notification_routes
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/001_create_alerting_types.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_severity') THEN
    CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'error', 'critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_status') THEN
    CREATE TYPE alert_status AS ENUM ('firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'pending');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_condition_type') THEN
    CREATE TYPE alert_condition_type AS ENUM ('threshold', 'change', 'anomaly', 'static', 'composite');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_condition_operator') THEN
    CREATE TYPE alert_condition_operator AS ENUM ('gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'regex', 'in', 'exists');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_action_type') THEN
    CREATE TYPE alert_action_type AS ENUM ('notify', 'webhook', 'suppress', 'escalate', 'group');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_status') THEN
    CREATE TYPE alert_event_status AS ENUM ('pending', 'processing', 'firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_attempt_status') THEN
    CREATE TYPE delivery_attempt_status AS ENUM ('pending', 'queued', 'sent', 'delivered', 'failed', 'retrying', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_status') THEN
    CREATE TYPE batch_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'partial');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'history_action') THEN
    CREATE TYPE history_action AS ENUM ('triggered', 'acknowledged', 'resolved', 'escalated', 'suppressed', 'notified', 'silenced', 'grouped', 'auto_resolved', 'rule_modified');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'metric_granularity') THEN
    CREATE TYPE metric_granularity AS ENUM ('hour', 'day', 'week', 'month');
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/002_create_alert_rules.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  severity alert_severity NOT NULL DEFAULT 'warning',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  evaluation_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (evaluation_interval_seconds > 0),
  cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
  auto_resolve_after_minutes INTEGER,
  deduplication_window_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (deduplication_window_seconds >= 0),
  deduplication_key_template VARCHAR(500) DEFAULT '{{rule_id}}:{{source}}:{{fingerprint}}',
  grouping_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  grouping_key_template VARCHAR(500),
  grouping_wait_seconds INTEGER NOT NULL DEFAULT 300,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  enabled_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rule_name_per_org
  ON alert_rules(organization_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rules_org
  ON alert_rules(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled
  ON alert_rules(organization_id, enabled)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rules_severity
  ON alert_rules(severity)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_rules_updated_at ON alert_rules;
CREATE TRIGGER trg_alert_rules_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/003_create_alert_rule_conditions.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_rule_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  condition_type alert_condition_type NOT NULL DEFAULT 'threshold',
  condition_group_id UUID,
  field_path VARCHAR(500) NOT NULL,
  operator alert_condition_operator NOT NULL,
  threshold_value JSONB,
  lookback_minutes INTEGER,
  aggregate_function VARCHAR(50),
  sub_query JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_conditions_rule
  ON alert_rule_conditions(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_rule_conditions_group
  ON alert_rule_conditions(condition_group_id)
  WHERE condition_group_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alert_rule_conditions_updated_at ON alert_rule_conditions;
CREATE TRIGGER trg_alert_rule_conditions_updated_at
  BEFORE UPDATE ON alert_rule_conditions
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/004_create_alert_rule_actions.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_rule_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  action_type alert_action_type NOT NULL DEFAULT 'notify',
  priority INTEGER NOT NULL DEFAULT 100,
  order_index INTEGER NOT NULL DEFAULT 0,
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  route_id UUID REFERENCES notification_routes(id) ON DELETE SET NULL,
  template_id UUID,
  escalation_policy_id UUID,
  throttle_duration_seconds INTEGER NOT NULL DEFAULT 0,
  max_notifications_per_hour INTEGER,
  action_conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_actions_rule
  ON alert_rule_actions(rule_id, order_index);
CREATE INDEX IF NOT EXISTS idx_alert_rule_actions_connector
  ON alert_rule_actions(connector_id)
  WHERE connector_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alert_rule_actions_updated_at ON alert_rule_actions;
CREATE TRIGGER trg_alert_rule_actions_updated_at
  BEFORE UPDATE ON alert_rule_actions
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/005_create_alert_events.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  status alert_event_status NOT NULL DEFAULT 'pending',
  severity alert_severity NOT NULL,
  fingerprint VARCHAR(255) NOT NULL,
  source VARCHAR(100) NOT NULL,
  source_id VARCHAR(255),
  payload JSONB NOT NULL,
  payload_size_bytes INTEGER,
  normalized_payload JSONB,
  group_id UUID,
  group_key VARCHAR(255),
  is_group_parent BOOLEAN NOT NULL DEFAULT FALSE,
  parent_event_id UUID REFERENCES alert_events(id) ON DELETE SET NULL,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  next_escalation_at TIMESTAMPTZ,
  auto_resolve_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  acknowledgment_expires_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason VARCHAR(100),
  suppressed_by UUID REFERENCES users(id),
  suppressed_at TIMESTAMPTZ,
  suppression_reason VARCHAR(255),
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_event_lifecycle CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL) OR (status <> 'resolved')
  )
);

CREATE INDEX IF NOT EXISTS idx_alert_events_org_status
  ON alert_events(organization_id, status, created_at DESC)
  WHERE status IN ('firing', 'acknowledged', 'pending');
CREATE INDEX IF NOT EXISTS idx_alert_events_org_rule
  ON alert_events(organization_id, rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint
  ON alert_events(organization_id, fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_source
  ON alert_events(organization_id, source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_group
  ON alert_events(organization_id, group_id)
  WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_events_next_escalation
  ON alert_events(next_escalation_at)
  WHERE status = 'firing' AND next_escalation_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_events_auto_resolve
  ON alert_events(auto_resolve_at)
  WHERE status = 'firing' AND auto_resolve_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alert_events_updated_at ON alert_events;
CREATE TRIGGER trg_alert_events_updated_at
  BEFORE UPDATE ON alert_events
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/006_create_alert_event_history.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_event_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action history_action NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(50) NOT NULL DEFAULT 'user',
  previous_state JSONB,
  new_state JSONB,
  changes_summary JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_history_event
  ON alert_event_history(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_org
  ON alert_event_history(organization_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/007_create_alert_silences.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_silences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  comment TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  matchers JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_silence_duration CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_alert_silences_active
  ON alert_silences(organization_id, is_active, ends_at)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_alert_silences_rule
  ON alert_silences(rule_id, is_active)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_alert_silences_updated_at ON alert_silences;
CREATE TRIGGER trg_alert_silences_updated_at
  BEFORE UPDATE ON alert_silences
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/008_create_alert_acknowledgments.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  acknowledged_by UUID NOT NULL REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  comment TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_ack_per_event
  ON alert_acknowledgments(event_id)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_alert_acks_org
  ON alert_acknowledgments(organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_alert_acknowledgments_updated_at ON alert_acknowledgments;
CREATE TRIGGER trg_alert_acknowledgments_updated_at
  BEFORE UPDATE ON alert_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/009_create_alert_escalation_policies.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_escalation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  repeat_interval_minutes INTEGER,
  max_repeats INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_policy_name_per_org
  ON alert_escalation_policies(organization_id, lower(name))
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_escalation_policies_updated_at ON alert_escalation_policies;
CREATE TRIGGER trg_alert_escalation_policies_updated_at
  BEFORE UPDATE ON alert_escalation_policies
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/010_create_alert_escalation_steps.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_escalation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES alert_escalation_policies(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  wait_minutes INTEGER NOT NULL DEFAULT 5,
  connector_ids UUID[] NOT NULL DEFAULT '{}',
  route_ids UUID[] NOT NULL DEFAULT '{}',
  notify_on_call BOOLEAN NOT NULL DEFAULT FALSE,
  custom_message_template TEXT,
  template_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_step_number_per_policy UNIQUE (policy_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_alert_escalation_steps_policy
  ON alert_escalation_steps(policy_id, step_number);

DROP TRIGGER IF EXISTS trg_alert_escalation_steps_updated_at ON alert_escalation_steps;
CREATE TRIGGER trg_alert_escalation_steps_updated_at
  BEFORE UPDATE ON alert_escalation_steps
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/011_create_alert_event_batches.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_event_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status batch_status NOT NULL DEFAULT 'pending',
  worker_id VARCHAR(255),
  event_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_batches_status
  ON alert_event_batches(status, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_alert_event_batches_org
  ON alert_event_batches(organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_alert_event_batches_updated_at ON alert_event_batches;
CREATE TRIGGER trg_alert_event_batches_updated_at
  BEFORE UPDATE ON alert_event_batches
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/012_create_alert_delivery_attempts.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  route_id UUID REFERENCES notification_routes(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES alert_event_batches(id) ON DELETE SET NULL,
  status delivery_attempt_status NOT NULL DEFAULT 'pending',
  request_payload JSONB,
  request_headers JSONB,
  response_payload TEXT,
  response_status_code INTEGER,
  error_message TEXT,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_category VARCHAR(50),
  latency_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  max_retries INTEGER NOT NULL DEFAULT 3,
  external_message_id VARCHAR(255),
  external_delivery_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_event
  ON alert_delivery_attempts(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_connector
  ON alert_delivery_attempts(connector_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_status
  ON alert_delivery_attempts(status, next_retry_at)
  WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_batch
  ON alert_delivery_attempts(batch_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_alert_delivery_attempts_updated_at ON alert_delivery_attempts;
CREATE TRIGGER trg_alert_delivery_attempts_updated_at
  BEFORE UPDATE ON alert_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/013_create_alert_templates.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  template_type VARCHAR(50) NOT NULL DEFAULT 'body',
  content TEXT NOT NULL,
  variables_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_for_severity alert_severity,
  connector_type connector_type,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sample_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_template_name_per_org
  ON alert_templates(organization_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_templates_org
  ON alert_templates(organization_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_templates_updated_at ON alert_templates;
CREATE TRIGGER trg_alert_templates_updated_at
  BEFORE UPDATE ON alert_templates
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/014_create_alert_routing_rules.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_connector_ids UUID[] NOT NULL DEFAULT '{}',
  target_route_ids UUID[] NOT NULL DEFAULT '{}',
  fallback_connector_ids UUID[] NOT NULL DEFAULT '{}',
  template_id UUID REFERENCES alert_templates(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_routing_rule_name_per_org
  ON alert_routing_rules(organization_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_routing_rules_active
  ON alert_routing_rules(organization_id, priority DESC)
  WHERE deleted_at IS NULL AND is_active;

DROP TRIGGER IF EXISTS trg_alert_routing_rules_updated_at ON alert_routing_rules;
CREATE TRIGGER trg_alert_routing_rules_updated_at
  BEFORE UPDATE ON alert_routing_rules
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/015_create_alert_rule_executions.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_rule_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  matched_count INTEGER NOT NULL DEFAULT 0,
  triggered_count INTEGER NOT NULL DEFAULT 0,
  suppressed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  evaluation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_executions_rule
  ON alert_rule_executions(rule_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_rule_executions_org
  ON alert_rule_executions(organization_id, started_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/016_create_alert_metrics.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  metric_type VARCHAR(50) NOT NULL,
  value NUMERIC NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  bucket_end TIMESTAMPTZ NOT NULL,
  granularity metric_granularity NOT NULL DEFAULT 'hour',
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_metric_bucket
  ON alert_metrics(
    organization_id,
    metric_type,
    COALESCE(rule_id, '00000000-0000-0000-0000-000000000000'::uuid),
    bucket_start,
    granularity
  );
CREATE INDEX IF NOT EXISTS idx_alert_metrics_lookup
  ON alert_metrics(organization_id, metric_type, granularity, bucket_start DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 08_alerting/017_enterprise_readiness.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 017 — Enterprise readiness: schema/code parity fixes, escalation execution
-- state, throttling windows, dead-letter queue table, and performance indexes.
--
-- 1. FIX: alert_event_batches columns the worker code already uses
--    (event_ids, skipped_count, pg_boss_job_id) but 011 never created.
-- 2. Escalation execution state on alert_events (policy, step, repeats).
-- 3. alert_throttle_windows — per-rule-action notification rate limiting.
-- 4. alert_dead_letter_events — exhausted pg-boss jobs land here for audit +
--    operator retry/discard instead of disappearing.
-- 5. Indexes for every background sweep query (claim, stuck, expired-ack,
--    escalation, cleanup) so the workers stay fast at scale.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Batch table parity with events.repository.ts ──────────────────────────
ALTER TABLE alert_event_batches
  ADD COLUMN IF NOT EXISTS event_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pg_boss_job_id VARCHAR(255);

-- ── 2. Escalation execution state on alert_events ────────────────────────────
ALTER TABLE alert_events
  ADD COLUMN IF NOT EXISTS escalation_policy_id UUID REFERENCES alert_escalation_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_step_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_repeat_count INTEGER NOT NULL DEFAULT 0;

-- ── 3. History actions for enterprise lifecycle events ───────────────────────
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'escalation_step';
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'throttled';
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'dead_lettered';
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'requeued';

-- ── 4. Dead-letter status enum ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_dead_letter_status') THEN
    CREATE TYPE alert_dead_letter_status AS ENUM ('pending_retry', 'retried', 'exhausted', 'discarded');
  END IF;
END $$;

-- ── 5. Throttle windows (per rule action, per hour bucket) ───────────────────
CREATE TABLE IF NOT EXISTS alert_throttle_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_action_id UUID NOT NULL REFERENCES alert_rule_actions(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  notification_count INTEGER NOT NULL DEFAULT 0,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_throttle_window UNIQUE (rule_action_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_alert_throttle_windows_action
  ON alert_throttle_windows(rule_action_id, window_start DESC);

DROP TRIGGER IF EXISTS trg_alert_throttle_windows_updated_at ON alert_throttle_windows;
CREATE TRIGGER trg_alert_throttle_windows_updated_at
  BEFORE UPDATE ON alert_throttle_windows
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ── 6. Dead-letter events (exhausted pg-boss jobs) ───────────────────────────
CREATE TABLE IF NOT EXISTS alert_dead_letter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_queue VARCHAR(100) NOT NULL,
  pg_boss_job_id VARCHAR(255),
  batch_id UUID,
  event_ids UUID[] NOT NULL DEFAULT '{}',
  job_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  status alert_dead_letter_status NOT NULL DEFAULT 'pending_retry',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_retry_at TIMESTAMPTZ,
  retried_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ,
  discarded_by UUID REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_org_status
  ON alert_dead_letter_events(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_retryable
  ON alert_dead_letter_events(status, created_at)
  WHERE status = 'pending_retry';

DROP TRIGGER IF EXISTS trg_alert_dead_letter_events_updated_at ON alert_dead_letter_events;
CREATE TRIGGER trg_alert_dead_letter_events_updated_at
  BEFORE UPDATE ON alert_dead_letter_events
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ── 7. Performance indexes for worker sweep queries ──────────────────────────

-- createBatchFromPending: WHERE organization_id AND status='pending' ORDER BY created_at ASC
CREATE INDEX IF NOT EXISTS idx_alert_events_pending_claim
  ON alert_events(organization_id, created_at ASC)
  WHERE status = 'pending';

-- Orphan sweeper: events stuck in 'processing' (worker crash / job expiry)
CREATE INDEX IF NOT EXISTS idx_alert_events_stuck_processing
  ON alert_events(updated_at)
  WHERE status = 'processing';

-- Expired acknowledgments resuming escalation
CREATE INDEX IF NOT EXISTS idx_alert_events_expired_ack
  ON alert_events(acknowledgment_expires_at)
  WHERE status = 'acknowledged' AND acknowledgment_expires_at IS NOT NULL;

-- Escalation lookups by policy
CREATE INDEX IF NOT EXISTS idx_alert_events_escalation_policy
  ON alert_events(escalation_policy_id)
  WHERE escalation_policy_id IS NOT NULL;

-- Orphan sweeper: batches stuck in 'processing'
CREATE INDEX IF NOT EXISTS idx_alert_event_batches_stuck
  ON alert_event_batches(started_at)
  WHERE status = 'processing';

-- Org-scoped delivery audit queries
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_org_created
  ON alert_delivery_attempts(organization_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 09_audit/001_create_audit_logs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

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
  ON audit_logs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_org_time
  ON audit_logs(org_id, created_at DESC)
  WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_action_time
  ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_logs(resource_type, resource_id)
  WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_request
  ON audit_logs(request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_metadata_gin
  ON audit_logs USING GIN (metadata);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 09_audit/002_enhance_audit_logs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(32) DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_audit_logs_org
  ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project
  ON audit_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_type_id_time
  ON audit_logs(actor_type, actor_id, created_at DESC)
  WHERE actor_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_time_brin
  ON audit_logs USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 10_security/001_harden_organization_security_indexes.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_unique_active_invite;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending_email_hash
  ON organization_invitations(org_id, email_hash)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending_token_hash
  ON organization_invitations(token_hash)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_scim_tokens_active_hash
  ON organization_scim_tokens(token_hash)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sso_providers_active_domain_type
  ON organization_sso_providers(provider_type, LOWER(domain))
  WHERE is_active = TRUE AND domain IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/002_plans.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 002_plans.sql
-- Description : Plan definitions for billing
-- PostgreSQL  : 16+
-- =============================================================================
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(100) NOT NULL,
  tier billing_plan_tier NOT NULL,
  description TEXT,
  trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT uq_plans_key_version UNIQUE (key, version)
);

COMMENT ON TABLE plans IS
'Billing plans define commercial tiers and lifecycle metadata. Pricing and entitlements are stored in separate tables.';

COMMENT ON COLUMN plans.id IS 'Primary identifier for the plan.';
COMMENT ON COLUMN plans.key IS 'Stable machine-readable identifier for the plan family, such as free or starter.';
COMMENT ON COLUMN plans.version IS 'Version number for the plan definition.';
COMMENT ON COLUMN plans.name IS 'Human-readable plan name.';
COMMENT ON COLUMN plans.tier IS 'Commercial tier used for display and logic.';
COMMENT ON COLUMN plans.description IS 'Optional marketing or internal description.';
COMMENT ON COLUMN plans.trial_days IS 'Number of trial days included with the plan.';
COMMENT ON COLUMN plans.is_active IS 'Whether this plan version can be assigned to subscriptions.';
COMMENT ON COLUMN plans.is_public IS 'Whether this plan is visible in public pricing pages.';
COMMENT ON COLUMN plans.sort_order IS 'Display order for UI listing.';
COMMENT ON COLUMN plans.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN plans.updated_at IS 'Row update timestamp.';
COMMENT ON COLUMN plans.deleted_at IS 'Soft delete timestamp.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_active_key
  ON plans (key)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_active_public
  ON plans (sort_order, tier, key)
  WHERE is_active = TRUE AND is_public = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_tier_active
  ON plans (tier, version DESC)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_key_version
  ON plans (key, version DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_public_sort
  ON plans (is_public, sort_order)
  WHERE is_active = TRUE AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/003_plan_prices.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 003_plan_prices.sql
-- Description : Billing plan pricing
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               002_plans.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS plan_prices
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    plan_id UUID NOT NULL
        REFERENCES plans(id)
        ON DELETE CASCADE,

    provider billing_provider_type NOT NULL,

    billing_interval billing_interval_type NOT NULL,

    currency CHAR(3) NOT NULL,

    amount_minor BIGINT NOT NULL
        CHECK (amount_minor >= 0),

    provider_price_id VARCHAR(150),

    is_default BOOLEAN NOT NULL DEFAULT FALSE,

    starts_at TIMESTAMPTZ,

    ends_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_plan_price UNIQUE
    (
        plan_id,
        provider,
        billing_interval,
        currency,
        starts_at
    ),

    CONSTRAINT chk_plan_price_window
    CHECK
    (
        ends_at IS NULL
        OR starts_at IS NULL
        OR ends_at > starts_at
    )
);

COMMENT ON TABLE plan_prices IS
'Commercial pricing for subscription plans. Supports multiple providers,
currencies, billing intervals, regional pricing and future grandfathered prices.';

COMMENT ON COLUMN plan_prices.amount_minor IS
'Amount stored in smallest currency unit (paise/cents).';

COMMENT ON COLUMN plan_prices.provider_price_id IS
'Stripe Price ID, Razorpay Plan ID, etc.';

COMMENT ON COLUMN plan_prices.metadata IS
'Provider specific metadata.';

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_plan_prices_plan
ON plan_prices(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_provider
ON plan_prices(provider)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_currency
ON plan_prices(currency)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_interval
ON plan_prices(billing_interval)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_lookup
ON plan_prices
(
    plan_id,
    provider,
    billing_interval,
    currency
)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_prices_default
ON plan_prices
(
    plan_id,
    billing_interval,
    currency
)
WHERE is_default = TRUE
AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_price
ON plan_prices
(
    provider,
    provider_price_id
)
WHERE provider_price_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_active_window
ON plan_prices
(
    starts_at,
    ends_at
)
WHERE deleted_at IS NULL;

-- ============================================================================
-- Trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trg_plan_prices_updated_at
ON plan_prices;

CREATE TRIGGER trg_plan_prices_updated_at
BEFORE UPDATE
ON plan_prices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/004_billing_features.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 004_billing_features.sql
-- Description : Feature catalog for billing entitlements
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               002_plans.sql
--               003_plan_prices.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS billing_features
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    feature_key        VARCHAR(100) NOT NULL,
    feature_name       VARCHAR(150) NOT NULL,
    description        TEXT,

    category           billing_feature_category NOT NULL,
    value_type         billing_feature_value_type NOT NULL,

    is_billable        BOOLEAN NOT NULL DEFAULT TRUE,
    is_public          BOOLEAN NOT NULL DEFAULT TRUE,
    is_deprecated      BOOLEAN NOT NULL DEFAULT FALSE,

    sort_order         INTEGER NOT NULL DEFAULT 0,

    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ,

    CONSTRAINT uq_billing_feature_key UNIQUE(feature_key)
);

COMMENT ON TABLE billing_features IS
'Master catalog of all billable platform features and limits. Plans reference these features through entitlement records.';

CREATE INDEX IF NOT EXISTS idx_billing_features_category
ON billing_features(category)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_features_public
ON billing_features(is_public, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_features_billable
ON billing_features(is_billable)
WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_billing_features_updated_at
ON billing_features;

CREATE TRIGGER trg_billing_features_updated_at
BEFORE UPDATE
ON billing_features
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO billing_features
(feature_key,feature_name,category,value_type,sort_order)
VALUES
('monthly_events','Monthly Events','limits','integer',1),
('projects','Projects','limits','integer',2),
('organization_members','Organization Members','limits','integer',3),
('api_keys','API Keys','limits','integer',4),
('connectors','Connectors','limits','integer',5),
('alert_rules','Alert Rules','limits','integer',6),
('dashboards','Dashboards','limits','integer',7),
('retention_days','Retention Days','limits','integer',8),
('ai_credits','AI Credits','limits','integer',9),

('request_capture','Request Capture','monitoring','boolean',100),
('error_tracking','Error Tracking','monitoring','boolean',101),
('distributed_tracing','Distributed Tracing','monitoring','boolean',102),
('performance_monitoring','Performance Monitoring','monitoring','boolean',103),
('metrics','Metrics','monitoring','boolean',104),
('logs','Logs','monitoring','boolean',105),
('session_replay','Session Replay','monitoring','boolean',106),
('cpu_profiling','CPU Profiling','monitoring','boolean',107),
('cron_monitoring','Cron Monitoring','monitoring','boolean',108),

('in_app_alerts','In App Alerts','alerts','boolean',200),
('email_alerts','Email Alerts','alerts','boolean',201),
('slack_connector','Slack Connector','integrations','boolean',202),
('discord_connector','Discord Connector','integrations','boolean',203),
('teams_connector','Teams Connector','integrations','boolean',204),
('webhook_connector','Webhook Connector','integrations','boolean',205),

('ai_chat','AI Chat','ai','boolean',300),
('ai_error_explanation','AI Error Explanation','ai','boolean',301),
('ai_root_cause','AI Root Cause Analysis','ai','boolean',302),
('ai_trace_analysis','AI Trace Analysis','ai','boolean',303),
('ai_log_summary','AI Log Summary','ai','boolean',304),

('custom_dashboards','Custom Dashboards','dashboard','boolean',400),
('saved_views','Saved Views','dashboard','boolean',401),

('sso','Single Sign-On','security','boolean',500),
('scim','SCIM Provisioning','security','boolean',501),
('audit_logs','Audit Logs','security','boolean',502),
('ip_allowlist','IP Allowlist','security','boolean',503)

ON CONFLICT (feature_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/005_plan_feature_entitlements.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 005_plan_feature_entitlements.sql
-- Description : Maps billing plans to feature entitlements
-- PostgreSQL  : 16+
-- Depends On  : 002_plans.sql
--               004_billing_features.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS plan_feature_entitlements
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    plan_id UUID NOT NULL
        REFERENCES plans(id)
        ON DELETE CASCADE,

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE CASCADE,

    boolean_value BOOLEAN,
    integer_value BIGINT,
    decimal_value NUMERIC(20,6),
    string_value TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_plan_feature UNIQUE(plan_id, feature_id),

    CONSTRAINT chk_single_value CHECK (
        ((boolean_value IS NOT NULL)::int +
         (integer_value IS NOT NULL)::int +
         (decimal_value IS NOT NULL)::int +
         (string_value IS NOT NULL)::int) <= 1
    )
);

COMMENT ON TABLE plan_feature_entitlements IS
'Resolved feature values for each billing plan. Every feature is represented by one row instead of JSON configuration.';

CREATE INDEX IF NOT EXISTS idx_pfe_plan
ON plan_feature_entitlements(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pfe_feature
ON plan_feature_entitlements(feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pfe_plan_feature
ON plan_feature_entitlements(plan_id, feature_id)
WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_plan_feature_entitlements_updated_at
ON plan_feature_entitlements;

CREATE TRIGGER trg_plan_feature_entitlements_updated_at
BEFORE UPDATE
ON plan_feature_entitlements
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- FREE
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'free'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, 5000::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, 1::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, 3::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, 1::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, 0::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, 1::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, 1::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, 7::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, 0::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ============================================================================
-- STARTER
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'starter'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, 100000::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, 5::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, 10::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, 5::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, 5::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, 10::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, 5::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, 30::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, 1000::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ============================================================================
-- GROWTH
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'growth'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, 1000000::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, 25::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, 50::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, 25::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, 25::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, 25::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, 90::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, 10000::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ============================================================================
-- BUSINESS
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'business'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, 5000000::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, 250::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, 500::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, 180::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, 50000::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ============================================================================
-- ENTERPRISE
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'enterprise'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/006_organization_subscriptions.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 006_organization_subscriptions.sql
-- Description : Organization subscription lifecycle
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               002_plans.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS organization_subscriptions
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    plan_id UUID NOT NULL
        REFERENCES plans(id),

    status billing_subscription_status NOT NULL,

    provider billing_provider_type NOT NULL DEFAULT 'system',

    billing_interval billing_interval_type NOT NULL,

    provider_customer_id VARCHAR(150),
    provider_subscription_id VARCHAR(150),

    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end   TIMESTAMPTZ NOT NULL,

    trial_start TIMESTAMPTZ,
    trial_end   TIMESTAMPTZ,

    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    cancelled_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_subscription_period
        CHECK (current_period_end > current_period_start),

    CONSTRAINT chk_trial_period
        CHECK (
            trial_start IS NULL
            OR trial_end IS NULL
            OR trial_end > trial_start
        )
);

COMMENT ON TABLE organization_subscriptions IS
'Current and historical subscriptions owned by organizations.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_single_active_subscription
ON organization_subscriptions(organization_id)
WHERE status IN ('trialing','active','past_due')
AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_subscription
ON organization_subscriptions(provider, provider_subscription_id)
WHERE provider_subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org
ON organization_subscriptions(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_plan
ON organization_subscriptions(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_period_end
ON organization_subscriptions(current_period_end)
WHERE status IN ('trialing','active','past_due')
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_status
ON organization_subscriptions(status)
WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_organization_subscriptions_updated_at
ON organization_subscriptions;

CREATE TRIGGER trg_organization_subscriptions_updated_at
BEFORE UPDATE
ON organization_subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/007_subscription_events.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 007_subscription_events.sql
-- Description : Immutable subscription event history
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               006_organization_subscriptions.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscription_events
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID NOT NULL
        REFERENCES organization_subscriptions(id)
        ON DELETE CASCADE,

    event_type subscription_event_type NOT NULL,

    actor subscription_event_actor NOT NULL,

    actor_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    old_plan_id UUID
        REFERENCES plans(id)
        ON DELETE SET NULL,

    new_plan_id UUID
        REFERENCES plans(id)
        ON DELETE SET NULL,

    request_id UUID,
    correlation_id UUID,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE subscription_events IS
'Immutable audit trail of all subscription lifecycle events. Rows are append-only.';

CREATE INDEX IF NOT EXISTS idx_subscription_events_org_time
ON subscription_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription_time
ON subscription_events (subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_event
ON subscription_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_actor
ON subscription_events (actor, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_request
ON subscription_events (request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_events_metadata
ON subscription_events
USING GIN (metadata);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/008_subscription_addons.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 011_subscription_addons.sql
-- Description : Subscription add-ons and purchased capacity
-- PostgreSQL  : 16+
-- Depends On  : 006_organization_subscriptions.sql
--               004_billing_features.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscription_addons
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    subscription_id UUID NOT NULL
        REFERENCES organization_subscriptions(id)
        ON DELETE CASCADE,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE RESTRICT,

    quantity BIGINT NOT NULL CHECK (quantity > 0),

    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,

    provider billing_provider_type NOT NULL DEFAULT 'system',
    provider_reference VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','scheduled','expired','cancelled')),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_addon_window
        CHECK (expires_at IS NULL OR expires_at > starts_at)
);

COMMENT ON TABLE subscription_addons IS
'Purchased add-ons that increase effective feature limits without changing the base plan.';

CREATE INDEX IF NOT EXISTS idx_subscription_addons_subscription
ON subscription_addons(subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_org
ON subscription_addons(organization_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_feature
ON subscription_addons(feature_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_active
ON subscription_addons(status, expires_at)
WHERE status='active';

CREATE INDEX IF NOT EXISTS idx_subscription_addons_metadata
ON subscription_addons
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_subscription_addons_updated_at
ON subscription_addons;

CREATE TRIGGER trg_subscription_addons_updated_at
BEFORE UPDATE
ON subscription_addons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/009_organization_feature_overrides.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 012_organization_feature_overrides.sql
-- Description : Organization-specific entitlement overrides
-- PostgreSQL  : 16+
-- Depends On  : 004_billing_features.sql
--               006_organization_subscriptions.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS organization_feature_overrides
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE RESTRICT,

    boolean_value BOOLEAN,
    integer_value BIGINT,
    decimal_value NUMERIC(20,6),
    string_value TEXT,

    reason TEXT NOT NULL,

    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,

    created_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    approved_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_override_window
        CHECK (expires_at IS NULL OR expires_at > effective_from),

    CONSTRAINT chk_override_single_value
        CHECK (
            ((boolean_value IS NOT NULL)::int +
             (integer_value IS NOT NULL)::int +
             (decimal_value IS NOT NULL)::int +
             (string_value IS NOT NULL)::int) <= 1
        )
);

COMMENT ON TABLE organization_feature_overrides IS
'Per-organization entitlement overrides. These take precedence over the base plan and are combined with subscription add-ons during entitlement resolution.';

CREATE INDEX IF NOT EXISTS idx_ofo_org
ON organization_feature_overrides(organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_feature
ON organization_feature_overrides(feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_org_feature
ON organization_feature_overrides(organization_id, feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_active
ON organization_feature_overrides(effective_from, expires_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_metadata
ON organization_feature_overrides
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_organization_feature_overrides_updated_at
ON organization_feature_overrides;

CREATE TRIGGER trg_organization_feature_overrides_updated_at
BEFORE UPDATE
ON organization_feature_overrides
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/010_organization_usage_current_period.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 008_organization_usage_current_period.sql
-- Description : Fast-path usage counters for entitlement enforcement
-- PostgreSQL  : 16+
-- Depends On  : 006_organization_subscriptions.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS organization_usage_current_period
(
    organization_id UUID PRIMARY KEY
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    period_start TIMESTAMPTZ NOT NULL,
    period_end   TIMESTAMPTZ NOT NULL,

    -- High-frequency counters
    events_used              BIGINT NOT NULL DEFAULT 0,
    ai_credits_used          BIGINT NOT NULL DEFAULT 0,

    -- Current resource counts
    projects_used            INTEGER NOT NULL DEFAULT 0,
    members_used             INTEGER NOT NULL DEFAULT 0,
    api_keys_used            INTEGER NOT NULL DEFAULT 0,
    connectors_used          INTEGER NOT NULL DEFAULT 0,
    alert_rules_used         INTEGER NOT NULL DEFAULT 0,
    dashboards_used          INTEGER NOT NULL DEFAULT 0,

    -- Cached effective limits (copied from resolved entitlements)
    event_limit              BIGINT NOT NULL DEFAULT 0,
    ai_credit_limit          BIGINT NOT NULL DEFAULT 0,

    overage_events           BIGINT NOT NULL DEFAULT 0,
    overage_ai_credits       BIGINT NOT NULL DEFAULT 0,

    last_event_at            TIMESTAMPTZ,
    last_ai_request_at       TIMESTAMPTZ,

    metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_usage_period
        CHECK (period_end > period_start),

    CONSTRAINT chk_non_negative
        CHECK (
            events_used >= 0
            AND ai_credits_used >= 0
            AND projects_used >= 0
            AND members_used >= 0
            AND api_keys_used >= 0
            AND connectors_used >= 0
            AND alert_rules_used >= 0
            AND dashboards_used >= 0
            AND event_limit >= 0
            AND ai_credit_limit >= 0
        )
);

COMMENT ON TABLE organization_usage_current_period IS
'Single-row fast-path counters for each organization. Used during ingestion and quota checks to avoid aggregating historical usage.';

CREATE INDEX IF NOT EXISTS idx_org_usage_subscription
ON organization_usage_current_period(subscription_id);

CREATE INDEX IF NOT EXISTS idx_org_usage_period_end
ON organization_usage_current_period(period_end);

CREATE INDEX IF NOT EXISTS idx_org_usage_last_event
ON organization_usage_current_period(last_event_at DESC)
WHERE last_event_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_usage_last_ai
ON organization_usage_current_period(last_ai_request_at DESC)
WHERE last_ai_request_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_usage_metadata
ON organization_usage_current_period
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_org_usage_current_period_updated_at
ON organization_usage_current_period;

CREATE TRIGGER trg_org_usage_current_period_updated_at
BEFORE UPDATE
ON organization_usage_current_period
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/011_usage_daily_counters.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 009_usage_daily_counters.sql
-- Description : Historical daily usage counters (partitioned)
-- PostgreSQL  : 16+
-- Depends On  : 008_organization_usage_current_period.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS usage_daily_counters
(
    id UUID NOT NULL DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    project_id UUID
        REFERENCES projects(id)
        ON DELETE CASCADE,

    usage_date DATE NOT NULL,

    events_count           BIGINT NOT NULL DEFAULT 0,
    ai_credits_used        BIGINT NOT NULL DEFAULT 0,

    requests_count         BIGINT NOT NULL DEFAULT 0,
    errors_count           BIGINT NOT NULL DEFAULT 0,
    traces_count           BIGINT NOT NULL DEFAULT 0,
    spans_count            BIGINT NOT NULL DEFAULT 0,
    metrics_count          BIGINT NOT NULL DEFAULT 0,
    logs_count             BIGINT NOT NULL DEFAULT 0,
    profiles_count         BIGINT NOT NULL DEFAULT 0,
    replays_count          BIGINT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, usage_date),

    CONSTRAINT uq_usage_scope UNIQUE
    (
        organization_id,
        project_id,
        usage_date
    )
)
PARTITION BY RANGE (usage_date);

COMMENT ON TABLE usage_daily_counters IS
'Historical daily usage counters. Parent table for monthly partitions.';

-- Example partition (create future partitions via scheduled migration/job)

CREATE TABLE IF NOT EXISTS usage_daily_counters_2026_07
PARTITION OF usage_daily_counters
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- ============================================================================
-- Partition indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_udc_2026_07_org_date
ON usage_daily_counters_2026_07
(
    organization_id,
    usage_date DESC
);

CREATE INDEX IF NOT EXISTS idx_udc_2026_07_project_date
ON usage_daily_counters_2026_07
(
    project_id,
    usage_date DESC
)
WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brin_udc_2026_07_date
ON usage_daily_counters_2026_07
USING BRIN (usage_date);

DROP TRIGGER IF EXISTS trg_usage_daily_counters_updated_at
ON usage_daily_counters;

CREATE TRIGGER trg_usage_daily_counters_updated_at
BEFORE UPDATE
ON usage_daily_counters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
-- ============================================================================
-- Notes
-- ============================================================================
-- 1. Create one partition per month.
-- 2. Automate future partition creation via a scheduler.
-- 3. Drop/archive old partitions according to billing retention policy.

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/012_ai_usage_logs.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 010_ai_usage_logs.sql
-- Description : AI usage ledger (partitioned)
-- PostgreSQL  : 16+
-- Depends On  : 008_organization_usage_current_period.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS ai_usage_logs
(
    id UUID NOT NULL DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    project_id UUID
        REFERENCES projects(id)
        ON DELETE SET NULL,

    user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    feature_key VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,

    credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),

    prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
    completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
    total_tokens INTEGER GENERATED ALWAYS AS
        (prompt_tokens + completion_tokens) STORED,

    estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0
        CHECK (estimated_cost_usd >= 0),

    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),

    status VARCHAR(20) NOT NULL DEFAULT 'success'
        CHECK (status IN ('success','failed','timeout','cancelled')),

    request_id UUID,
    trace_id UUID,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE ai_usage_logs IS
'Immutable ledger of AI feature consumption used for billing, analytics and cost reporting.';

CREATE TABLE IF NOT EXISTS ai_usage_logs_2026_07
PARTITION OF ai_usage_logs
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS idx_ai_usage_2026_07_org_time
ON ai_usage_logs_2026_07 (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_2026_07_project_time
ON ai_usage_logs_2026_07 (project_id, occurred_at DESC)
WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_2026_07_user_time
ON ai_usage_logs_2026_07 (user_id, occurred_at DESC)
WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_2026_07_feature
ON ai_usage_logs_2026_07 (feature_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS brin_ai_usage_2026_07_time
ON ai_usage_logs_2026_07
USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS gin_ai_usage_2026_07_metadata
ON ai_usage_logs_2026_07
USING GIN (metadata);
-- Notes:
-- * Create monthly partitions ahead of time.
-- * Consider pg_partman for automatic partition management.
-- * Never UPDATE usage rows; treat this table as append-only.

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/013_invoices.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 013_invoices.sql
-- Description : Billing invoices
-- PostgreSQL  : 16+
-- Depends On  : 006_organization_subscriptions.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS invoices
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    provider billing_provider_type NOT NULL,

    provider_invoice_id VARCHAR(150),

    invoice_number VARCHAR(100) NOT NULL,

    status billing_invoice_status NOT NULL,

    currency CHAR(3) NOT NULL,

    subtotal_amount BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
    tax_amount BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    amount_paid BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),

    tax_rate NUMERIC(6,3),
    tax_id_snapshot VARCHAR(100),
    billing_address_snapshot JSONB,

    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,

    overage_events BIGINT NOT NULL DEFAULT 0,
    overage_amount BIGINT NOT NULL DEFAULT 0,

    pdf_url TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_invoice_period
        CHECK(period_end > period_start),

    CONSTRAINT uq_invoice_number UNIQUE(invoice_number)
);

COMMENT ON TABLE invoices IS
'Immutable invoice records generated for subscriptions. Monetary values are stored in the smallest currency unit.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_invoice
ON invoices(provider, provider_invoice_id)
WHERE provider_invoice_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_org
ON invoices(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_subscription
ON invoices(subscription_id, created_at DESC)
WHERE subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_status
ON invoices(status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_due
ON invoices(due_at)
WHERE due_at IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_period
ON invoices(period_start, period_end)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS gin_invoice_metadata
ON invoices
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_invoices_updated_at
ON invoices;

CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE
ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/014_payments.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 014_payments.sql
-- Description : Payment ledger
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               013_invoices.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS payments
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    invoice_id UUID
        REFERENCES invoices(id)
        ON DELETE SET NULL,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    provider billing_provider_type NOT NULL,

    provider_payment_id VARCHAR(150),
    provider_order_id   VARCHAR(150),

    status billing_payment_status NOT NULL,

    currency CHAR(3) NOT NULL,

    amount BIGINT NOT NULL CHECK (amount >= 0),
    fee_amount BIGINT NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
    tax_amount BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),

    payment_method VARCHAR(50),
    payment_method_last4 VARCHAR(10),

    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    authorized_at TIMESTAMPTZ,
    captured_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,

    failure_code VARCHAR(100),
    failure_reason TEXT,

    idempotency_key VARCHAR(150),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_provider_payment UNIQUE(provider, provider_payment_id)
);

COMMENT ON TABLE payments IS
'Immutable payment ledger. Supports retries, refunds and reconciliation with external payment providers.';

CREATE INDEX IF NOT EXISTS idx_payments_org
ON payments(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_invoice
ON payments(invoice_id)
WHERE invoice_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_subscription
ON payments(subscription_id)
WHERE subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_status
ON payments(status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency
ON payments(idempotency_key)
WHERE idempotency_key IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS gin_payments_metadata
ON payments
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_payments_updated_at
ON payments;

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE
ON payments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/015_billing_webhook_events.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 015_billing_webhook_events.sql
-- Description : Billing webhook inbox / idempotency store
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS billing_webhook_events
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    provider billing_provider_type NOT NULL,

    provider_event_id VARCHAR(200) NOT NULL,

    event_type VARCHAR(150) NOT NULL,

    organization_id UUID
        REFERENCES organizations(id)
        ON DELETE SET NULL,

    payload JSONB NOT NULL,

    payload_sha256 CHAR(64),

    signature_verified BOOLEAN NOT NULL DEFAULT FALSE,

    api_version VARCHAR(50),

    processing_status VARCHAR(20) NOT NULL DEFAULT 'received'
        CHECK (
            processing_status IN
            ('received','processing','processed','failed','ignored','dead_letter')
        ),

    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),

    next_retry_at TIMESTAMPTZ,

    processing_started_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,

    processing_duration_ms INTEGER
        CHECK (processing_duration_ms IS NULL OR processing_duration_ms >= 0),

    request_id UUID,
    correlation_id UUID,

    last_error TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_provider_event UNIQUE(provider, provider_event_id)
);

COMMENT ON TABLE billing_webhook_events IS
'Inbox table for payment-provider webhooks. Ensures idempotent processing and reliable retry handling.';

CREATE INDEX IF NOT EXISTS idx_bwe_pending
ON billing_webhook_events(next_retry_at, received_at)
WHERE processing_status IN ('received','failed');

CREATE INDEX IF NOT EXISTS idx_bwe_org
ON billing_webhook_events(organization_id, received_at DESC)
WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bwe_status
ON billing_webhook_events(processing_status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_bwe_request
ON billing_webhook_events(request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bwe_received_brin
ON billing_webhook_events
USING BRIN(received_at);

CREATE INDEX IF NOT EXISTS gin_bwe_payload
ON billing_webhook_events
USING GIN(payload);

CREATE INDEX IF NOT EXISTS gin_bwe_metadata
ON billing_webhook_events
USING GIN(metadata);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/016_coupons.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 016_coupons.sql
-- Description : Coupon and promotion definitions
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS coupons
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(50) NOT NULL,

    name VARCHAR(150) NOT NULL,
    description TEXT,

    discount_type billing_coupon_discount_type NOT NULL,

    discount_value NUMERIC(12,2) NOT NULL
        CHECK (discount_value > 0),

    currency CHAR(3),

    max_redemptions INTEGER
        CHECK (max_redemptions IS NULL OR max_redemptions > 0),

    redemption_count INTEGER NOT NULL DEFAULT 0
        CHECK (redemption_count >= 0),

    max_redemptions_per_org INTEGER NOT NULL DEFAULT 1
        CHECK (max_redemptions_per_org > 0),

    first_time_customers_only BOOLEAN NOT NULL DEFAULT FALSE,
    trial_only BOOLEAN NOT NULL DEFAULT FALSE,

    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_coupon_code UNIQUE(code),

    CONSTRAINT chk_coupon_window
        CHECK(valid_until IS NULL OR valid_until > valid_from),

    CONSTRAINT chk_percentage_value
        CHECK (
            discount_type <> 'percentage'
            OR (discount_value > 0 AND discount_value <= 100)
        )
);

COMMENT ON TABLE coupons IS
'Reusable promotional coupons supporting percentage and fixed discounts.';

CREATE INDEX IF NOT EXISTS idx_coupons_active
ON coupons(is_active, valid_until)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_public
ON coupons(is_public)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_validity
ON coupons(valid_from, valid_until)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_redemptions
ON coupons(redemption_count);

CREATE INDEX IF NOT EXISTS gin_coupons_metadata
ON coupons
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_coupons_updated_at
ON coupons;

CREATE TRIGGER trg_coupons_updated_at
BEFORE UPDATE
ON coupons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/017_coupon_redemptions.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 017_coupon_redemptions.sql
-- Description : Coupon redemption history
-- PostgreSQL  : 16+
-- Depends On  : 016_coupons.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS coupon_redemptions
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    coupon_id UUID NOT NULL
        REFERENCES coupons(id)
        ON DELETE CASCADE,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    invoice_id UUID
        REFERENCES invoices(id)
        ON DELETE SET NULL,

    redeemed_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    discount_amount BIGINT NOT NULL DEFAULT 0
        CHECK (discount_amount >= 0),

    currency CHAR(3) NOT NULL,

    redemption_source VARCHAR(30) NOT NULL DEFAULT 'manual'
        CHECK (
            redemption_source IN
            ('manual','checkout','admin','promotion','api')
        ),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_coupon_org UNIQUE(coupon_id, organization_id)
);

COMMENT ON TABLE coupon_redemptions IS
'Immutable history of coupon redemptions by organizations.';

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_org
ON coupon_redemptions(organization_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon
ON coupon_redemptions(coupon_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_subscription
ON coupon_redemptions(subscription_id)
WHERE subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_invoice
ON coupon_redemptions(invoice_id)
WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brin_coupon_redemptions_time
ON coupon_redemptions
USING BRIN(redeemed_at);

CREATE INDEX IF NOT EXISTS gin_coupon_redemptions_metadata
ON coupon_redemptions
USING GIN(metadata);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/018_coupon_applicable_plans.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 018_coupon_applicable_plans.sql
-- Description : Coupon applicability by billing plan
-- PostgreSQL  : 16+
-- Depends On  : 002_plans.sql
--               016_coupons.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS coupon_applicable_plans
(
    coupon_id UUID NOT NULL
        REFERENCES coupons(id)
        ON DELETE CASCADE,

    plan_id UUID NOT NULL
        REFERENCES plans(id)
        ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (coupon_id, plan_id)
);

COMMENT ON TABLE coupon_applicable_plans IS
'Defines which plan versions a coupon may be redeemed against.';

CREATE INDEX IF NOT EXISTS idx_cap_plan
ON coupon_applicable_plans(plan_id);

CREATE INDEX IF NOT EXISTS idx_cap_coupon
ON coupon_applicable_plans(coupon_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/019_billing_audit_logs.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 019_billing_audit_logs.sql
-- Description : Immutable billing audit log (partitioned)
-- PostgreSQL  : 16+
-- Depends On  : 006_organization_subscriptions.sql
--               013_invoices.sql
--               014_payments.sql
--               016_coupons.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS billing_audit_logs
(
    id UUID NOT NULL DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    invoice_id UUID
        REFERENCES invoices(id)
        ON DELETE SET NULL,

    payment_id UUID
        REFERENCES payments(id)
        ON DELETE SET NULL,

    coupon_id UUID
        REFERENCES coupons(id)
        ON DELETE SET NULL,

    actor_type subscription_event_actor NOT NULL,

    actor_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    action VARCHAR(100) NOT NULL,

    request_id UUID,
    correlation_id UUID,
    trace_id UUID,

    ip_address INET,
    user_agent TEXT,

    previous_state JSONB,
    new_state JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE billing_audit_logs IS
'Append-only audit trail for all billing operations. Parent table for monthly partitions.';

CREATE TABLE IF NOT EXISTS billing_audit_logs_2026_07
PARTITION OF billing_audit_logs
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS idx_bal_2026_07_org_time
ON billing_audit_logs_2026_07(organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_2026_07_action
ON billing_audit_logs_2026_07(action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_2026_07_actor
ON billing_audit_logs_2026_07(actor_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_2026_07_request
ON billing_audit_logs_2026_07(request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brin_bal_2026_07_time
ON billing_audit_logs_2026_07
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_metadata
ON billing_audit_logs_2026_07
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_previous
ON billing_audit_logs_2026_07
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_new
ON billing_audit_logs_2026_07
USING GIN(new_state);
-- Notes:
-- * Treat this table as append-only.
-- * Create monthly partitions automatically (pg_partman or scheduler).
-- * Archive/drop partitions according to retention policy.

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 11_billing/020_views_and_functions.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Billing
-- Migration   : 020_helper_functions_and_views.sql
-- Description : Helper functions and read models
-- PostgreSQL  : 16+
-- =============================================================================
-- ============================================================================
-- Effective entitlement view
-- NOTE:
-- Organization overrides should take precedence over plan entitlements.
-- Subscription add-ons should be added by application logic or a future view.
-- ============================================================================

CREATE OR REPLACE VIEW v_effective_entitlements AS
SELECT
    os.organization_id,
    bf.feature_key,
    COALESCE(ofo.boolean_value, pfe.boolean_value)     AS boolean_value,
    COALESCE(ofo.integer_value, pfe.integer_value)     AS integer_value,
    COALESCE(ofo.decimal_value, pfe.decimal_value)     AS decimal_value,
    COALESCE(ofo.string_value, pfe.string_value)       AS string_value
FROM organization_subscriptions os
JOIN plans p
  ON p.id = os.plan_id
JOIN plan_feature_entitlements pfe
  ON pfe.plan_id = p.id
JOIN billing_features bf
  ON bf.id = pfe.feature_id
LEFT JOIN organization_feature_overrides ofo
  ON ofo.organization_id = os.organization_id
 AND ofo.feature_id = bf.id
 AND ofo.deleted_at IS NULL
 AND (ofo.expires_at IS NULL OR ofo.expires_at > NOW())
WHERE os.status IN ('trialing','active','past_due');

COMMENT ON VIEW v_effective_entitlements IS
'Resolved organization entitlements. Future revisions can merge active subscription add-ons.';

-- ============================================================================
-- Current usage summary
-- ============================================================================

CREATE OR REPLACE VIEW v_current_usage AS
SELECT
    organization_id,
    period_start,
    period_end,
    events_used,
    event_limit,
    (event_limit - events_used) AS remaining_events,
    ai_credits_used,
    ai_credit_limit,
    (ai_credit_limit - ai_credits_used) AS remaining_ai_credits,
    projects_used,
    members_used,
    api_keys_used,
    connectors_used,
    alert_rules_used,
    dashboards_used
FROM organization_usage_current_period;

-- ============================================================================
-- Subscription summary
-- ============================================================================

CREATE OR REPLACE VIEW v_subscription_summary AS
SELECT
    os.organization_id,
    p.name            AS plan_name,
    p.key             AS plan_key,
    p.tier,
    os.status,
    os.billing_interval,
    os.current_period_start,
    os.current_period_end,
    os.cancel_at_period_end
FROM organization_subscriptions os
JOIN plans p
  ON p.id = os.plan_id;

-- ============================================================================
-- Helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION get_effective_integer_feature(
    p_organization_id UUID,
    p_feature_key TEXT
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT integer_value
FROM v_effective_entitlements
WHERE organization_id = p_organization_id
  AND feature_key = p_feature_key
LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION has_feature(
    p_organization_id UUID,
    p_feature_key TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
SELECT COALESCE(boolean_value,FALSE)
FROM v_effective_entitlements
WHERE organization_id = p_organization_id
  AND feature_key = p_feature_key
LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION remaining_event_quota(
    p_organization_id UUID
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(event_limit - events_used,0)
FROM organization_usage_current_period
WHERE organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION remaining_ai_credits(
    p_organization_id UUID
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(ai_credit_limit - ai_credits_used,0)
FROM organization_usage_current_period
WHERE organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION increment_event_usage(
    p_organization_id UUID,
    p_count BIGINT DEFAULT 1
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET events_used = events_used + p_count,
    last_event_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION consume_ai_credits(
    p_organization_id UUID,
    p_credits BIGINT
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET ai_credits_used = ai_credits_used + p_credits,
    last_ai_request_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 12_monitoring/001_create_backpressure_gauge.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS backpressure_gauge (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pending_depth BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_worker_id TEXT
);

INSERT INTO backpressure_gauge (id, pending_depth, updated_at, last_worker_id)
VALUES (1, 0, NOW(), 'init')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_backpressure_gauge_updated
  ON backpressure_gauge(updated_at);

COMMENT ON TABLE backpressure_gauge IS
  'Shared cross-process queue depth gauge. Workers UPDATE after batches. API servers READ for health checks.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 13_ingestion/001_create_ingestion_job_types.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_job_state') THEN
    CREATE TYPE ingestion_job_state AS ENUM (
      'pending',
      'active',
      'completed',
      'failed',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_job_priority') THEN
    CREATE TYPE ingestion_job_priority AS ENUM (
      'critical', 'high', 'normal', 'low', 'background'
    );
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 13_ingestion/002_create_ingestion_jobs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue VARCHAR(64) NOT NULL DEFAULT 'ingestion',
  job_type VARCHAR(64) NOT NULL CHECK (job_type IN (
    'error', 'message', 'request', 'span', 'trace',
    'metric', 'log', 'profile', 'cron_checkin', 'replay'
  )),
  priority SMALLINT NOT NULL DEFAULT 100 CHECK (priority >= 0 AND priority <= 1000),
  priority_label ingestion_job_priority GENERATED ALWAYS AS (
    CASE
      WHEN priority <= 10 THEN 'critical'::ingestion_job_priority
      WHEN priority <= 50 THEN 'high'::ingestion_job_priority
      WHEN priority <= 80 THEN 'normal'::ingestion_job_priority
      WHEN priority <= 95 THEN 'low'::ingestion_job_priority
      ELSE 'background'::ingestion_job_priority
    END
  ) STORED,
  org_id UUID,
  project_id UUID,
  payload JSONB NOT NULL,
  event_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id VARCHAR(64),
  tenant_id VARCHAR(64),
  dedupe_key VARCHAR(256),
  state ingestion_job_state NOT NULL DEFAULT 'pending',
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 50),
  max_attempts SMALLINT NOT NULL DEFAULT 3 CHECK (max_attempts >= 1 AND max_attempts <= 50),
  locked_until TIMESTAMPTZ,
  locked_by VARCHAR(128),
  heartbeat_at TIMESTAMPTZ,
  last_error TEXT,
  error_code VARCHAR(64),
  processed_by VARCHAR(128),
  processing_duration_ms INTEGER CHECK (processing_duration_ms IS NULL OR processing_duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim
  ON ingestion_jobs(queue, priority ASC, run_at ASC, created_at ASC)
  WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim_typed
  ON ingestion_jobs(queue, job_type, priority ASC, run_at ASC)
  WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_lease
  ON ingestion_jobs(locked_until, state)
  WHERE state = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_dedupe
  ON ingestion_jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_project
  ON ingestion_jobs(project_id, state, priority)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_org_state
  ON ingestion_jobs(org_id, state)
  WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_event_id
  ON ingestion_jobs(event_id)
  WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_trace_id
  ON ingestion_jobs(trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_completed
  ON ingestion_jobs(completed_at)
  WHERE state = 'completed';

DROP TRIGGER IF EXISTS trg_ingestion_jobs_updated_at ON ingestion_jobs;
CREATE TRIGGER trg_ingestion_jobs_updated_at
  BEFORE UPDATE ON ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 13_ingestion/003_create_ingestion_dead_letter_jobs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ingestion_dead_letter_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_job_id UUID,
  queue VARCHAR(64) NOT NULL,
  job_type VARCHAR(64) NOT NULL,
  org_id UUID,
  project_id UUID,
  payload JSONB NOT NULL,
  dedupe_key VARCHAR(256),
  attempts SMALLINT NOT NULL,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  last_error TEXT NOT NULL,
  error_code VARCHAR(64),
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed_at TIMESTAMPTZ,
  replayed_by VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_queue_time
  ON ingestion_dead_letter_jobs(queue, failed_at);
CREATE INDEX IF NOT EXISTS idx_dlq_project
  ON ingestion_dead_letter_jobs(project_id, failed_at)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dlq_unreplayed
  ON ingestion_dead_letter_jobs(failed_at)
  WHERE replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dlq_original_job
  ON ingestion_dead_letter_jobs(original_job_id)
  WHERE original_job_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 13_ingestion/004_create_ingestion_admin_logs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ingestion_admin_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  log_level VARCHAR(16) NOT NULL CHECK (log_level IN ('debug', 'info', 'warn', 'error', 'fatal')),
  category VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  org_id UUID,
  project_id UUID,
  job_id UUID,
  event_id VARCHAR(64),
  worker_id VARCHAR(128),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS ingestion_admin_logs_default
  PARTITION OF ingestion_admin_logs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_admin_logs_created
  ON ingestion_admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_category
  ON ingestion_admin_logs(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_project
  ON ingestion_admin_logs(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_logs_level
  ON ingestion_admin_logs(log_level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_metadata
  ON ingestion_admin_logs USING GIN (metadata);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 13_ingestion/005_create_ingestion_queue_snapshot.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS ingestion_queue_snapshot;

CREATE OR REPLACE VIEW ingestion_queue_snapshot AS
SELECT
  queue,
  job_type,
  state,
  priority_label,
  COUNT(*)::bigint AS job_count,
  COUNT(*) FILTER (WHERE attempts > 0)::bigint AS retried_count,
  COALESCE(MIN(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS oldest_age_seconds,
  COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS newest_age_seconds,
  COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS avg_age_seconds
FROM ingestion_jobs
GROUP BY queue, job_type, state, priority_label;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 13_ingestion/006_create_usage_counter_staging.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNLOGGED TABLE IF NOT EXISTS usage_counter_staging (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL,
  org_id UUID NOT NULL,
  counter_type VARCHAR(64) NOT NULL,
  increment_by BIGINT NOT NULL DEFAULT 1 CHECK (increment_by > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_staging_project
  ON usage_counter_staging(project_id, counter_type, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_staging_flush
  ON usage_counter_staging(created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 13_ingestion/007_create_project_usage_rollups.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID NOT NULL,
  counter_type VARCHAR(64) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE (project_id, counter_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_lookup
  ON project_usage(project_id, counter_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_project_usage_org
  ON project_usage(org_id, period_start DESC);

DROP TRIGGER IF EXISTS trg_project_usage_updated_at ON project_usage;
CREATE TRIGGER trg_project_usage_updated_at
  BEFORE UPDATE ON project_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 13_ingestion/008_create_flush_usage_counters.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION flush_usage_counters()
RETURNS TABLE(flushed_project_id UUID, flushed_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id, project_id, org_id, counter_type, increment_by, created_at
    FROM usage_counter_staging
    WHERE created_at < NOW() - INTERVAL '5 seconds'
    ORDER BY id
    LIMIT 10000
    FOR UPDATE SKIP LOCKED
  ),
  aggregated AS (
    SELECT
      project_id,
      org_id,
      counter_type,
      date_trunc('hour', created_at) AS period_start,
      date_trunc('hour', created_at) + INTERVAL '1 hour' AS period_end,
      SUM(increment_by) AS total_increment
    FROM batch
    GROUP BY project_id, org_id, counter_type, date_trunc('hour', created_at)
  ),
  upserted AS (
    INSERT INTO project_usage
      (project_id, org_id, counter_type, period_start, period_end, value, updated_at)
    SELECT project_id, org_id, counter_type, period_start, period_end, total_increment, NOW()
    FROM aggregated
    ON CONFLICT (project_id, counter_type, period_start)
    DO UPDATE SET value = project_usage.value + EXCLUDED.value, updated_at = NOW()
    RETURNING project_id
  ),
  deleted AS (
    DELETE FROM usage_counter_staging s
    USING batch b
    WHERE s.id = b.id
    RETURNING s.id, s.project_id
  )
  SELECT d.project_id, COUNT(*)::BIGINT
  FROM deleted d
  GROUP BY d.project_id;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 13_ingestion/009_create_project_usage_realtime_view.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW project_usage_realtime AS
SELECT
  COALESCE(p.project_id, s.project_id) AS project_id,
  COALESCE(p.org_id, s.org_id) AS org_id,
  COALESCE(p.counter_type, s.counter_type) AS counter_type,
  COALESCE(p.value, 0) + COALESCE(s.unflushed_value, 0) AS total_value,
  p.period_start,
  p.period_end,
  p.updated_at AS last_flushed_at,
  NOW() AS queried_at
FROM project_usage p
FULL OUTER JOIN (
  SELECT
    project_id,
    org_id,
    counter_type,
    date_trunc('hour', created_at) AS period_start,
    SUM(increment_by) AS unflushed_value
  FROM usage_counter_staging
  GROUP BY project_id, org_id, counter_type, date_trunc('hour', created_at)
) s
  ON p.project_id = s.project_id
 AND p.counter_type = s.counter_type
 AND p.period_start = s.period_start;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/001_create_analytics_types.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_severity') THEN
    CREATE TYPE event_severity AS ENUM ('debug', 'info', 'warning', 'error', 'fatal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'span_status') THEN
    CREATE TYPE span_status AS ENUM ('ok', 'error', 'unset');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'span_kind') THEN
    CREATE TYPE span_kind AS ENUM ('internal', 'server', 'client', 'producer', 'consumer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_metric_type') THEN
    CREATE TYPE analytics_metric_type AS ENUM ('counter', 'gauge', 'histogram');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'log_level') THEN
    CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cron_status') THEN
    CREATE TYPE cron_status AS ENUM ('ok', 'error', 'in_progress');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_group_status') THEN
    CREATE TYPE error_group_status AS ENUM ('unresolved', 'resolved', 'ignored', 'muted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rollup_granularity') THEN
    CREATE TYPE rollup_granularity AS ENUM ('hour', 'day', 'week', 'month');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_alert_operator') THEN
    CREATE TYPE analytics_alert_operator AS ENUM ('gt', 'lt', 'eq', 'gte', 'lte');
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/002_create_events_errors.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  error_name VARCHAR(256) NOT NULL,
  severity event_severity NOT NULL DEFAULT 'error',
  stack_hash VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  source VARCHAR(100) NOT NULL DEFAULT 'capture',
  mechanism VARCHAR(50),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  server_name VARCHAR(100),
  stack_frames JSONB,
  source_context JSONB,
  user_id VARCHAR(255),
  user_email VARCHAR(255),
  user_ip INET,
  breadcrumbs JSONB,
  tags JSONB DEFAULT '{}',
  extra JSONB DEFAULT '{}',
  contexts JSONB DEFAULT '{}',
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_errors_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_errors_org_time
  ON events_errors(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_fingerprint
  ON events_errors(organization_id, fingerprint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_trace
  ON events_errors(trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_errors_severity
  ON events_errors(organization_id, severity, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_service
  ON events_errors(organization_id, service, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_user
  ON events_errors(organization_id, user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_errors_brin_time
  ON events_errors USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/003_create_events_requests.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  url TEXT NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  route VARCHAR(500),
  framework VARCHAR(50),
  headers JSONB,
  query_params JSONB,
  body JSONB,
  body_size INTEGER,
  response_size INTEGER,
  user_id VARCHAR(255),
  tenant_id VARCHAR(255),
  session_id VARCHAR(64),
  client_ip INET,
  user_agent TEXT,
  referer TEXT,
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  is_slow BOOLEAN GENERATED ALWAYS AS (latency_ms > 1000) STORED,
  is_error BOOLEAN GENERATED ALWAYS AS (status_code >= 500) STORED,
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_requests_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_requests_org_time
  ON events_requests(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_route
  ON events_requests(organization_id, route, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status
  ON events_requests(organization_id, status_code, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_slow
  ON events_requests(organization_id, timestamp DESC)
  WHERE is_slow = TRUE;
CREATE INDEX IF NOT EXISTS idx_requests_user
  ON events_requests(organization_id, user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_trace
  ON events_requests(trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_brin_time
  ON events_requests USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/004_create_events_spans.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  span_id VARCHAR(64) NOT NULL,
  trace_id VARCHAR(64) NOT NULL,
  parent_span_id VARCHAR(64),
  name VARCHAR(500) NOT NULL,
  kind span_kind,
  status span_status NOT NULL DEFAULT 'unset',
  status_message TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_ms INTEGER,
  exclusive_duration_ms INTEGER,
  attributes JSONB DEFAULT '{}',
  events JSONB,
  links JSONB,
  db_system VARCHAR(50),
  db_name VARCHAR(100),
  db_operation VARCHAR(50),
  db_collection VARCHAR(100),
  db_statement TEXT,
  http_method VARCHAR(10),
  http_url TEXT,
  http_status_code INTEGER,
  http_host VARCHAR(255),
  http_route VARCHAR(500),
  messaging_system VARCHAR(50),
  messaging_destination VARCHAR(255),
  messaging_operation VARCHAR(50),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id VARCHAR(255),
  tenant_id VARCHAR(255),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_spans_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_spans_org_time
  ON events_spans(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace
  ON events_spans(organization_id, trace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_name
  ON events_spans(organization_id, name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_db
  ON events_spans(organization_id, db_system, timestamp DESC)
  WHERE db_system IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_http
  ON events_spans(organization_id, http_route, timestamp DESC)
  WHERE http_route IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_parent
  ON events_spans(parent_span_id)
  WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_brin_time
  ON events_spans USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/005_create_events_metrics.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  metric_type analytics_metric_type NOT NULL,
  value NUMERIC NOT NULL,
  unit VARCHAR(50),
  tags JSONB DEFAULT '{}',
  count INTEGER,
  sum NUMERIC,
  min NUMERIC,
  max NUMERIC,
  buckets JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_metrics_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_metrics_org_name_time
  ON events_metrics(organization_id, metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_tags
  ON events_metrics USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_metrics_brin_time
  ON events_metrics USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/006_create_timescaledb_setup_shim.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  evt TEXT;
  event_tables TEXT[] := ARRAY[
    'events_errors',
    'events_requests',
    'events_spans',
    'events_metrics'
  ];
  has_timescale BOOLEAN := FALSE;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    has_timescale := TRUE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB extension unavailable (%) - events_* remain plain tables', SQLERRM;
  END;

  IF has_timescale THEN
    FOREACH evt IN ARRAY event_tables LOOP
      BEGIN
        PERFORM create_hypertable(evt, 'created_at',
          chunk_time_interval => INTERVAL '1 day',
          if_not_exists => TRUE);
        PERFORM add_retention_policy(evt, INTERVAL '90 days', if_not_exists => TRUE);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TimescaleDB hypertable setup skipped for % (%)', evt, SQLERRM;
      END;
    END LOOP;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/007_create_events_messages.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  severity event_severity NOT NULL DEFAULT 'info',
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  user_id VARCHAR(255),
  user_ip INET,
  tags JSONB DEFAULT '{}',
  contexts JSONB DEFAULT '{}',
  breadcrumbs JSONB,
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_messages_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_messages_org_time
  ON events_messages(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_brin_time
  ON events_messages USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/008_create_events_traces.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_traces (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  trace_id VARCHAR(64) NOT NULL,
  root_span_name VARCHAR(500),
  root_span_id VARCHAR(64),
  span_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,
  is_partial BOOLEAN DEFAULT FALSE,
  spans_tree JSONB,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id VARCHAR(255),
  tenant_id VARCHAR(255),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_traces_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_traces_org_time
  ON events_traces(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traces_trace_id
  ON events_traces(organization_id, trace_id);
CREATE INDEX IF NOT EXISTS idx_traces_brin_time
  ON events_traces USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/009_create_events_logs.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  level log_level NOT NULL,
  message TEXT NOT NULL,
  logger VARCHAR(255),
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  tags JSONB DEFAULT '{}',
  context JSONB DEFAULT '{}',
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_logs_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_logs_org_level_time
  ON events_logs(organization_id, level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_message
  ON events_logs USING GIN (to_tsvector('english', message));
CREATE INDEX IF NOT EXISTS idx_logs_brin_time
  ON events_logs USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/010_create_events_profiles.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  profile_type VARCHAR(50) NOT NULL,
  format VARCHAR(50),
  duration_ms INTEGER,
  sample_count INTEGER,
  profile JSONB,
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_profiles_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_profiles_org_time
  ON events_profiles(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_brin_time
  ON events_profiles USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/011_create_events_cron_checkins.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_cron_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  monitor_slug VARCHAR(255) NOT NULL,
  status cron_status NOT NULL,
  duration_ms INTEGER,
  environment VARCHAR(64),
  trace_id VARCHAR(64),
  request_id VARCHAR(64),
  service VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_cron_checkins_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_crons_org_slug
  ON events_cron_checkins(organization_id, monitor_slug, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_crons_brin_time
  ON events_cron_checkins USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 14_observability/012_create_events_replays.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events_replays (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  segment_id INTEGER NOT NULL,
  events JSONB NOT NULL,
  trace_id VARCHAR(64),
  user_id VARCHAR(255),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_replays_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_replays_org_session
  ON events_replays(organization_id, session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_replays_brin_time
  ON events_replays USING BRIN (created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 15_analytics/001_create_hourly_and_daily_rollups.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytics_hourly_rollup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket_hour TIMESTAMPTZ NOT NULL,
  error_count INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  span_count INTEGER DEFAULT 0,
  trace_count INTEGER DEFAULT 0,
  metric_count INTEGER DEFAULT 0,
  log_count INTEGER DEFAULT 0,
  profile_count INTEGER DEFAULT 0,
  cron_checkin_count INTEGER DEFAULT 0,
  replay_count INTEGER DEFAULT 0,
  error_fatal_count INTEGER DEFAULT 0,
  error_error_count INTEGER DEFAULT 0,
  error_warning_count INTEGER DEFAULT 0,
  error_info_count INTEGER DEFAULT 0,
  error_debug_count INTEGER DEFAULT 0,
  request_2xx_count INTEGER DEFAULT 0,
  request_3xx_count INTEGER DEFAULT 0,
  request_4xx_count INTEGER DEFAULT 0,
  request_5xx_count INTEGER DEFAULT 0,
  request_avg_latency_ms INTEGER,
  request_p95_latency_ms INTEGER,
  request_p99_latency_ms INTEGER,
  unique_user_count INTEGER DEFAULT 0,
  active_services TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_hourly_rollup_unique UNIQUE (organization_id, project_id, bucket_hour)
);

CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket_date DATE NOT NULL,
  error_count INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  span_count INTEGER DEFAULT 0,
  trace_count INTEGER DEFAULT 0,
  metric_count INTEGER DEFAULT 0,
  log_count INTEGER DEFAULT 0,
  profile_count INTEGER DEFAULT 0,
  cron_checkin_count INTEGER DEFAULT 0,
  replay_count INTEGER DEFAULT 0,
  error_fatal_count INTEGER DEFAULT 0,
  error_error_count INTEGER DEFAULT 0,
  error_warning_count INTEGER DEFAULT 0,
  error_info_count INTEGER DEFAULT 0,
  error_debug_count INTEGER DEFAULT 0,
  request_2xx_count INTEGER DEFAULT 0,
  request_3xx_count INTEGER DEFAULT 0,
  request_4xx_count INTEGER DEFAULT 0,
  request_5xx_count INTEGER DEFAULT 0,
  request_avg_latency_ms INTEGER,
  request_p95_latency_ms INTEGER,
  request_p99_latency_ms INTEGER,
  unique_user_count INTEGER DEFAULT 0,
  active_services TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_daily_rollup_unique UNIQUE (organization_id, project_id, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_hourly_rollup_org_hour
  ON analytics_hourly_rollup(organization_id, project_id, bucket_hour DESC);
CREATE INDEX IF NOT EXISTS idx_daily_rollup_org_date
  ON analytics_daily_rollup(organization_id, project_id, bucket_date DESC);

DROP TRIGGER IF EXISTS trg_hourly_rollup_updated_at ON analytics_hourly_rollup;
CREATE TRIGGER trg_hourly_rollup_updated_at
  BEFORE UPDATE ON analytics_hourly_rollup
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_daily_rollup_updated_at ON analytics_daily_rollup;
CREATE TRIGGER trg_daily_rollup_updated_at
  BEFORE UPDATE ON analytics_daily_rollup
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 15_analytics/002_create_project_usage_hourly_and_daily.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_usage_hourly (
  id BIGSERIAL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bucket_hour TIMESTAMPTZ NOT NULL,
  event_count BIGINT NOT NULL DEFAULT 0,
  event_bytes BIGINT NOT NULL DEFAULT 0,
  category_counts JSONB DEFAULT '{}',
  event_type_counts JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, bucket_hour)
) PARTITION BY RANGE (bucket_hour);

CREATE TABLE IF NOT EXISTS project_usage_hourly_default
  PARTITION OF project_usage_hourly DEFAULT;

CREATE INDEX IF NOT EXISTS idx_usage_hourly_project_bucket
  ON project_usage_hourly(project_id, bucket_hour DESC);
CREATE INDEX IF NOT EXISTS idx_usage_hourly_org_bucket
  ON project_usage_hourly(organization_id, bucket_hour DESC);

CREATE TABLE IF NOT EXISTS project_usage_daily (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bucket_date DATE NOT NULL,
  total_events BIGINT DEFAULT 0,
  total_bytes BIGINT DEFAULT 0,
  category_counts JSONB DEFAULT '{}',
  event_type_counts JSONB DEFAULT '{}',
  peak_events_per_hour INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_project_date
  ON project_usage_daily(project_id, bucket_date DESC);
CREATE INDEX IF NOT EXISTS idx_usage_daily_org_date
  ON project_usage_daily(organization_id, bucket_date DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 15_analytics/003_create_analytics_error_groups.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytics_error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  fingerprint VARCHAR(64) NOT NULL,
  error_name VARCHAR(256) NOT NULL,
  message_template TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  total_count INTEGER DEFAULT 0,
  today_count INTEGER DEFAULT 0,
  week_count INTEGER DEFAULT 0,
  month_count INTEGER DEFAULT 0,
  status error_group_status DEFAULT 'unresolved',
  assigned_to UUID,
  services TEXT[],
  environments TEXT[],
  releases TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_error_groups_unique UNIQUE (organization_id, project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_org_fingerprint
  ON analytics_error_groups(organization_id, project_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_groups_org_status
  ON analytics_error_groups(organization_id, status, last_seen_at DESC);

DROP TRIGGER IF EXISTS trg_error_groups_updated_at ON analytics_error_groups;
CREATE TRIGGER trg_error_groups_updated_at
  BEFORE UPDATE ON analytics_error_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 15_analytics/004_create_analytics_performance_summary.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytics_performance_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket_date DATE NOT NULL,
  route VARCHAR(500) NOT NULL,
  method VARCHAR(10),
  p50_latency_ms INTEGER,
  p75_latency_ms INTEGER,
  p90_latency_ms INTEGER,
  p95_latency_ms INTEGER,
  p99_latency_ms INTEGER,
  request_count INTEGER DEFAULT 0,
  rpm NUMERIC,
  error_count INTEGER DEFAULT 0,
  error_rate NUMERIC,
  apdex_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_perf_summary_unique UNIQUE (organization_id, project_id, bucket_date, route, method)
);

CREATE INDEX IF NOT EXISTS idx_perf_summary_org_route
  ON analytics_performance_summary(organization_id, project_id, bucket_date DESC, route);

DROP TRIGGER IF EXISTS trg_perf_summary_updated_at ON analytics_performance_summary;
CREATE TRIGGER trg_perf_summary_updated_at
  BEFORE UPDATE ON analytics_performance_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 15_analytics/005_create_analytics_user_sessions.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytics_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  session_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(255),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  event_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  pages TEXT[],
  is_crashed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_user_sessions_unique UNIQUE (organization_id, project_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_org
  ON analytics_user_sessions(organization_id, project_id, started_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 15_analytics/006_create_analytics_config_tables.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  layout JSONB DEFAULT '{}',
  widgets JSONB DEFAULT '[]',
  is_shared BOOLEAN DEFAULT FALSE,
  shared_token VARCHAR(64),
  created_by UUID NOT NULL,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS analytics_saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  query_type VARCHAR(50) NOT NULL,
  query_config JSONB NOT NULL,
  visualization_type VARCHAR(50),
  visualization_config JSONB DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS analytics_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  metric VARCHAR(100) NOT NULL,
  operator analytics_alert_operator NOT NULL,
  threshold NUMERIC NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  notification_channels JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dashboards_org
  ON analytics_dashboards(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saved_queries_org
  ON analytics_saved_queries(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org
  ON analytics_alerts(organization_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_dashboards_updated_at ON analytics_dashboards;
CREATE TRIGGER trg_dashboards_updated_at
  BEFORE UPDATE ON analytics_dashboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_saved_queries_updated_at ON analytics_saved_queries;
CREATE TRIGGER trg_saved_queries_updated_at
  BEFORE UPDATE ON analytics_saved_queries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_analytics_alerts_updated_at ON analytics_alerts;
CREATE TRIGGER trg_analytics_alerts_updated_at
  BEFORE UPDATE ON analytics_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 15_analytics/007_create_rollup_helper_functions.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_event_partitions(p_days_ahead INTEGER DEFAULT 7)
RETURNS void AS $$
BEGIN
  RETURN;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_hourly_rollup(
  p_org_id UUID, p_start_hour TIMESTAMPTZ, p_end_hour TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  INSERT INTO analytics_hourly_rollup (
    organization_id, project_id, bucket_hour,
    error_count, error_fatal_count, error_error_count, error_warning_count,
    error_info_count, error_debug_count
  )
  SELECT
    organization_id, project_id, DATE_TRUNC('hour', timestamp) AS bucket_hour,
    COUNT(*),
    COUNT(*) FILTER (WHERE severity = 'fatal'),
    COUNT(*) FILTER (WHERE severity = 'error'),
    COUNT(*) FILTER (WHERE severity = 'warning'),
    COUNT(*) FILTER (WHERE severity = 'info'),
    COUNT(*) FILTER (WHERE severity = 'debug')
  FROM events_errors
  WHERE organization_id = p_org_id AND timestamp >= p_start_hour AND timestamp < p_end_hour
  GROUP BY organization_id, project_id, DATE_TRUNC('hour', timestamp)
  ON CONFLICT (organization_id, project_id, bucket_hour) DO UPDATE SET
    error_count = EXCLUDED.error_count,
    error_fatal_count = EXCLUDED.error_fatal_count,
    error_error_count = EXCLUDED.error_error_count,
    error_warning_count = EXCLUDED.error_warning_count,
    error_info_count = EXCLUDED.error_info_count,
    error_debug_count = EXCLUDED.error_debug_count,
    updated_at = NOW();

  INSERT INTO analytics_hourly_rollup (
    organization_id, project_id, bucket_hour,
    request_count, request_2xx_count, request_3xx_count, request_4xx_count, request_5xx_count,
    request_avg_latency_ms, request_p95_latency_ms, request_p99_latency_ms, unique_user_count
  )
  SELECT
    organization_id, project_id, DATE_TRUNC('hour', timestamp) AS bucket_hour,
    COUNT(*),
    COUNT(*) FILTER (WHERE status_code BETWEEN 200 AND 299),
    COUNT(*) FILTER (WHERE status_code BETWEEN 300 AND 399),
    COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499),
    COUNT(*) FILTER (WHERE status_code >= 500),
    AVG(latency_ms)::INTEGER,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::INTEGER,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::INTEGER,
    COUNT(DISTINCT user_id)
  FROM events_requests
  WHERE organization_id = p_org_id AND timestamp >= p_start_hour AND timestamp < p_end_hour
  GROUP BY organization_id, project_id, DATE_TRUNC('hour', timestamp)
  ON CONFLICT (organization_id, project_id, bucket_hour) DO UPDATE SET
    request_count = EXCLUDED.request_count,
    request_2xx_count = EXCLUDED.request_2xx_count,
    request_3xx_count = EXCLUDED.request_3xx_count,
    request_4xx_count = EXCLUDED.request_4xx_count,
    request_5xx_count = EXCLUDED.request_5xx_count,
    request_avg_latency_ms = EXCLUDED.request_avg_latency_ms,
    request_p95_latency_ms = EXCLUDED.request_p95_latency_ms,
    request_p99_latency_ms = EXCLUDED.request_p99_latency_ms,
    unique_user_count = EXCLUDED.unique_user_count,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 16_legacy_compat/001_create_legacy_telemetry_tables.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  trace_id VARCHAR(64) NOT NULL,
  span_id VARCHAR(64) NOT NULL,
  parent_span_id VARCHAR(64),
  name TEXT NOT NULL,
  kind VARCHAR(16),
  status VARCHAR(16),
  status_message TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_ms DOUBLE PRECISION,
  exclusive_duration_ms DOUBLE PRECISION,
  attributes JSONB,
  events JSONB,
  links JSONB,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS spans_default PARTITION OF spans DEFAULT;
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(project_id, trace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(project_id, parent_span_id) WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_project_time ON spans(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_attrs_gin ON spans USING GIN (attributes);

CREATE TABLE IF NOT EXISTS traces (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  trace_id VARCHAR(64) NOT NULL,
  root_span JSONB NOT NULL,
  span_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms DOUBLE PRECISION,
  is_partial BOOLEAN NOT NULL DEFAULT FALSE,
  root_name TEXT,
  has_error BOOLEAN NOT NULL DEFAULT FALSE,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS traces_default PARTITION OF traces DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_unique ON traces(project_id, trace_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_traces_project_time ON traces(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traces_errors ON traces(project_id, timestamp DESC) WHERE has_error = TRUE;

CREATE TABLE IF NOT EXISTS metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  metric_name VARCHAR(255) NOT NULL,
  metric_type VARCHAR(16) NOT NULL,
  value DOUBLE PRECISION,
  unit VARCHAR(32),
  count BIGINT,
  sum DOUBLE PRECISION,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  avg DOUBLE PRECISION,
  buckets JSONB,
  tags JSONB,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS metrics_default PARTITION OF metrics DEFAULT;
CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON metrics(project_id, metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_tags_gin ON metrics USING GIN (tags);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 16_legacy_compat/002_create_legacy_runtime_tables.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  level VARCHAR(16) NOT NULL,
  message TEXT NOT NULL,
  args JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS logs_default PARTITION OF logs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_logs_project_time ON logs(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(project_id, level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  profile_type VARCHAR(16) NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms DOUBLE PRECISION,
  profile JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS profiles_default PARTITION OF profiles DEFAULT;
CREATE INDEX IF NOT EXISTS idx_profiles_project_time ON profiles(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_trace ON profiles(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cron_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  monitor_slug VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL,
  duration_ms DOUBLE PRECISION,
  environment VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS cron_checkins_default PARTITION OF cron_checkins DEFAULT;
CREATE INDEX IF NOT EXISTS idx_cron_monitor_time ON cron_checkins(project_id, monitor_slug, timestamp DESC);

CREATE TABLE IF NOT EXISTS replays (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  session_id VARCHAR(64) NOT NULL,
  segment_id INTEGER NOT NULL,
  events JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS replays_default PARTITION OF replays DEFAULT;
CREATE INDEX IF NOT EXISTS idx_replays_session ON replays(project_id, session_id, segment_id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  message TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL,
  context JSONB,
  breadcrumbs JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS messages_default PARTITION OF messages DEFAULT;
CREATE INDEX IF NOT EXISTS idx_messages_project_time ON messages(project_id, severity, timestamp DESC);

CREATE TABLE IF NOT EXISTS sdk_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  session_id VARCHAR(64) NOT NULL,
  started_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  event_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  crashed BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS sdk_sessions_default PARTITION OF sdk_sessions DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdk_sessions_unique ON sdk_sessions(project_id, session_id, timestamp);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 16_legacy_compat/003_create_legacy_failure_tables.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID,
  org_id UUID,
  event_type VARCHAR(32),
  reason VARCHAR(64) NOT NULL,
  detail TEXT,
  raw_excerpt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_project ON ingestion_failures(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_reason ON ingestion_failures(reason, created_at DESC);

CREATE TABLE IF NOT EXISTS errors (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  message TEXT NOT NULL,
  error_type VARCHAR(256) NOT NULL DEFAULT 'UnknownError',
  fingerprint VARCHAR(128) NOT NULL,
  severity VARCHAR(16),
  stack JSONB,
  context JSONB,
  breadcrumbs JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  session_id VARCHAR(64),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS errors_default PARTITION OF errors DEFAULT;
CREATE INDEX IF NOT EXISTS idx_errors_project_time ON errors(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_fingerprint ON errors(project_id, fingerprint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_unresolved ON errors(project_id, timestamp DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_errors_trace ON errors(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  request_id VARCHAR(64),
  url TEXT,
  method VARCHAR(10),
  status_code INTEGER,
  latency_ms DOUBLE PRECISION,
  body_size INTEGER,
  response_size INTEGER,
  user_id TEXT,
  tenant_id VARCHAR(128),
  session_id VARCHAR(64),
  client_ip INET,
  user_agent TEXT,
  referer TEXT,
  route TEXT,
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  headers JSONB,
  query JSONB,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS requests_default PARTITION OF requests DEFAULT;
CREATE INDEX IF NOT EXISTS idx_requests_project_time ON requests(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(project_id, status_code, timestamp DESC) WHERE status_code >= 400;
CREATE INDEX IF NOT EXISTS idx_requests_latency ON requests(project_id, latency_ms, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_route ON requests(project_id, route, timestamp DESC) WHERE route IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_trace ON requests(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  occurrences BIGINT NOT NULL DEFAULT 1,
  last_message TEXT,
  error_type VARCHAR(256),
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_error_groups_active ON error_groups(project_id, last_seen DESC) WHERE is_resolved = FALSE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 17_enterprise_ingestion/001_events_idempotency.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Enterprise Ingestion
-- Migration   : 001_events_idempotency.up.sql
-- Description : Idempotent insert support for all events_* tables.
--
-- The ingestion platform processes jobs at-least-once (pg-boss retries, queue
-- replay, SDK retries, worker crashes). To make duplicate delivery harmless,
-- every events_* table gets a unique identity index on (project_id, event_id)
-- so writers can INSERT ... ON CONFLICT DO NOTHING.
--
-- NULLS NOT DISTINCT makes org-level events (project_id IS NULL) idempotent
-- as well (PostgreSQL 15+; platform targets PG 17).
--
-- Justification: without a database-level uniqueness guarantee, idempotency
-- depends on application discipline alone and breaks under concurrent worker
-- retries racing on the same job payload.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_errors_project_event
  ON events_errors(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_requests_project_event
  ON events_requests(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_spans_project_event
  ON events_spans(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_metrics_project_event
  ON events_metrics(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_messages_project_event
  ON events_messages(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_traces_project_event
  ON events_traces(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_logs_project_event
  ON events_logs(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_profiles_project_event
  ON events_profiles(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_cron_checkins_project_event
  ON events_cron_checkins(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_replays_project_event
  ON events_replays(project_id, event_id) NULLS NOT DISTINCT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 17_enterprise_ingestion/002_alerting_project_scope.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Enterprise Ingestion / Alerting
-- Migration   : 002_alerting_project_scope.up.sql
-- Description : Project-level scoping for alert rules and alert events, plus
--               default-rule (preset) bookkeeping and evaluator watermarks.
--
-- Justification:
-- * The alerting spec requires project isolation: rules are evaluated within
--   the correct project and members only receive alerts for projects they
--   belong to. alert_rules/alert_events had no project dimension at all.
-- * preset_key/is_default let the platform ship built-in alert templates that
--   organizations can customize or disable without losing track of which rows
--   are platform-managed.
-- * last_evaluated_at is the watermark the scheduled rule evaluator uses to
--   slide lookback windows without re-scanning or double-firing.
-- =============================================================================

-- ─── alert_rules ────────────────────────────────────────────────────────────

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS preset_key VARCHAR(64),
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_alert_rules_org_project
  ON alert_rules(organization_id, project_id)
  WHERE deleted_at IS NULL;

-- Evaluator scan: enabled rules due for evaluation.
CREATE INDEX IF NOT EXISTS idx_alert_rules_eval_due
  ON alert_rules(enabled, last_evaluated_at)
  WHERE deleted_at IS NULL;

-- One preset instance per (org, project, preset_key). NULLS NOT DISTINCT keeps
-- org-level presets (project_id IS NULL) singleton as well.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rules_preset_scope
  ON alert_rules(organization_id, project_id, preset_key) NULLS NOT DISTINCT
  WHERE preset_key IS NOT NULL AND deleted_at IS NULL;

-- ─── alert_events ───────────────────────────────────────────────────────────

ALTER TABLE alert_events
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_alert_events_org_project_status
  ON alert_events(organization_id, project_id, status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 17_enterprise_ingestion/003_feature_flags.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Enterprise Ingestion
-- Migration   : 003_feature_flags.up.sql
-- Description : Centralized feature flag registry.
--
-- Three scopes, evaluated most-specific-wins (project > organization >
-- platform). Used to gate AI alert analysis, experimental pipelines, beta
-- processors and future event types without deploys.
--
-- A CHECK constraint (not an enum) is used for scope so new scopes do not
-- require a type migration; the generator's drop script only tracks enums
-- created via CREATE TYPE ... AS ENUM.
-- =============================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('platform', 'organization', 'project')),
  scope_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_feature_flags_scope_id CHECK (
    (scope = 'platform' AND scope_id IS NULL)
    OR (scope IN ('organization', 'project') AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_flags_key_scope
  ON feature_flags(key, scope, scope_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_feature_flags_scope
  ON feature_flags(scope, scope_id);

DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Well-known flags (platform scope, disabled by default; orgs opt in).
INSERT INTO feature_flags (key, scope, scope_id, enabled, description)
VALUES
  ('ai_alert_analysis', 'platform', NULL, FALSE,
   'AI analysis hook between alert generation and notification delivery (extension point, not implemented).'),
  ('experimental_pipelines', 'platform', NULL, FALSE,
   'Enables experimental per-type worker pipelines.'),
  ('beta_processors', 'platform', NULL, FALSE,
   'Enables beta event processors before GA.')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 17_enterprise_ingestion/004_plans_seed.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Enterprise Ingestion / Billing
-- Migration   : 004_plans_seed.up.sql
-- Description : Seed the five canonical billing plans.
--
-- Justification: plan-aware queue scheduling and quota enforcement resolve an
-- organization's plan tier at ingestion time. The plans table was never
-- seeded, so every tier lookup would fall back to a hardcoded default. These
-- rows make the tier resolution data-driven while remaining idempotent
-- (ON CONFLICT DO NOTHING on the (key, version) business key).
-- =============================================================================

INSERT INTO plans (key, version, name, tier, description, trial_days, is_active, is_public, sort_order)
VALUES
  ('free',       1, 'Free',       'free',       'Community tier with shared ingestion capacity.', 0,  TRUE, TRUE, 10),
  ('starter',    1, 'Starter',    'starter',    'Entry paid tier for small teams.',               14, TRUE, TRUE, 20),
  ('growth',     1, 'Growth',     'growth',     'Scaling teams with higher event volumes.',       14, TRUE, TRUE, 30),
  ('business',   1, 'Business',   'business',   'Production workloads with priority ingestion.',  14, TRUE, TRUE, 40),
  ('enterprise', 1, 'Enterprise', 'enterprise', 'Dedicated capacity and highest ingestion priority.', 0, TRUE, TRUE, 50)
ON CONFLICT ON CONSTRAINT uq_plans_key_version DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 17_enterprise_ingestion/005_usage_counters_default_partition.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Module      : Enterprise Ingestion / Billing
-- Migration   : 005_usage_counters_default_partition.up.sql
-- Description : DEFAULT partition for usage_daily_counters.
--
-- Justification: the usage rollup job writes daily counters for the current
-- month. The table ships with a single example partition (2026_07); any
-- insert outside its range raises an error and would silently drop billable
-- usage. A DEFAULT partition guarantees writes never fail; the rollup job
-- still creates proper monthly partitions ahead of time and operators can
-- detach/re-attach rows from DEFAULT during maintenance.
-- =============================================================================

CREATE TABLE IF NOT EXISTS usage_daily_counters_default
  PARTITION OF usage_daily_counters DEFAULT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Source: 01_auth/011_create_user_preferences.up.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

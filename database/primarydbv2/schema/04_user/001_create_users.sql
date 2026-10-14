-- Normalized final definition for users.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/001_create_users.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql
-- - canonical_migrations_draft/02_organizations/001_create_organizations.up.sql

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
  current_org_id UUID,
  suspended_by UUID,
  deletion_scheduled_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  deletion_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  version INTEGER NOT NULL DEFAULT 1,
  display_name VARCHAR(255),
  marketing_emails BOOLEAN DEFAULT false,
  product_updates BOOLEAN DEFAULT true,
  deletion_requested_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_current_org
ON users(current_org_id)
WHERE current_org_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_lower_email
  ON users(lower(email))
  WHERE deleted_at IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_users_deletion_requested
  ON users(deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_suspended_by
  ON users(suspended_by)
  WHERE suspended_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_by
  ON users(deleted_by)
  WHERE deleted_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_created_by
  ON users(created_by)
  WHERE created_by IS NOT NULL;

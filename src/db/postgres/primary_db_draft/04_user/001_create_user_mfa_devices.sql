-- Normalized final definition for user_mfa_devices.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/003_create_user_mfa_devices.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql

CREATE TABLE IF NOT EXISTS user_mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type mfa_type NOT NULL,
  device_type VARCHAR(50) NOT NULL DEFAULT 'unknown',
  device_name VARCHAR(255) NOT NULL,
  secret_encrypted TEXT,
  phone_e164 VARCHAR(32),
  email VARCHAR(255),
  credential_id TEXT,
  public_key TEXT,
  sign_count INTEGER NOT NULL DEFAULT 0,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_used_ip INET,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_at TIMESTAMPTZ,
  disabled_reason TEXT,
  device_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_one_primary
  ON user_mfa_devices(user_id)
  WHERE is_primary = TRUE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mfa_devices_user_type
  ON user_mfa_devices(user_id, type)
  WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_credential_id
  ON user_mfa_devices(credential_id)
  WHERE credential_id IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mfa_devices_phone
  ON user_mfa_devices(phone_e164)
  WHERE phone_e164 IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mfa_devices_email
  ON user_mfa_devices(email)
  WHERE email IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_mfa_devices_user_id
  ON user_mfa_devices(user_id);

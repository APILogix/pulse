-- Normalized final definition for user_trusted_devices.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/007_create_user_trusted_devices.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql

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
  device_type VARCHAR(100),
  os VARCHAR(100),
  browser VARCHAR(100),
  location VARCHAR(255),
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_active
  ON user_trusted_devices(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_trusted_devices_user_id
  ON user_trusted_devices(user_id)
  WHERE revoked_at IS NULL;

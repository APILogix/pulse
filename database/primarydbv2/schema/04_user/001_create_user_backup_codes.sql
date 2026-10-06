-- Normalized final definition for user_backup_codes.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/003_create_user_mfa_devices.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql

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

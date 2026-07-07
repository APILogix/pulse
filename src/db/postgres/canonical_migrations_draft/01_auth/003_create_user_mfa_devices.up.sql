BEGIN;

CREATE TABLE IF NOT EXISTS user_mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type mfa_type NOT NULL,
  device_name VARCHAR(255) NOT NULL,
  secret_encrypted TEXT,
  phone_e164 VARCHAR(32),
  email VARCHAR(255),
  credential_id VARCHAR(255),
  public_key TEXT,
  sign_count BIGINT,
  backup_codes_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_mfa
  ON user_mfa_devices(user_id)
  WHERE is_primary = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mfa_devices_user
  ON user_mfa_devices(user_id, type)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_credential_id
  ON user_mfa_devices(credential_id)
  WHERE credential_id IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS update_mfa_devices_updated_at ON user_mfa_devices;
CREATE TRIGGER update_mfa_devices_updated_at
  BEFORE UPDATE ON user_mfa_devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;

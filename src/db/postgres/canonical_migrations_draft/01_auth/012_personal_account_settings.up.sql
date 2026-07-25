BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS marketing_emails BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS product_updates BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

UPDATE users
SET display_name = full_name
WHERE display_name IS NULL AND full_name IS NOT NULL;

ALTER TABLE user_trusted_devices
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS os VARCHAR(100),
  ADD COLUMN IF NOT EXISTS browser VARCHAR(100),
  ADD COLUMN IF NOT EXISTS location VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

UPDATE user_trusted_devices
SET last_used_at = COALESCE(last_used_at, last_seen_at, trusted_at)
WHERE last_used_at IS NULL;

CREATE TABLE IF NOT EXISTS user_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  device_info VARCHAR(500),
  ip_address INET,
  location VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_devices_user_id
  ON user_mfa_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_backup_codes_user_id
  ON user_backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_trusted_devices_user_id
  ON user_trusted_devices(user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_security_events_user_id_created
  ON user_security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_deletion_requested
  ON users(deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

COMMIT;

BEGIN;

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

COMMIT;

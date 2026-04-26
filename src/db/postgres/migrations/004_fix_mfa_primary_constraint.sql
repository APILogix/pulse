-- Allow multiple non-primary MFA devices while preserving one active primary device.
ALTER TABLE user_mfa_devices
  DROP CONSTRAINT IF EXISTS one_primary_mfa;

DROP INDEX IF EXISTS one_primary_mfa;

CREATE UNIQUE INDEX one_primary_mfa
  ON user_mfa_devices(user_id)
  WHERE is_primary = TRUE AND is_active = TRUE;

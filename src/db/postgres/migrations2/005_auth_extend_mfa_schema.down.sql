-- ============================================================================
-- 005_auth_extend_mfa_schema.down.sql
-- ----------------------------------------------------------------------------
-- Rollback of 005. Drops the SMS OTP table and removes the columns/constraints
-- added to user_mfa_devices and organization_settings. The shared
-- update_updated_at_column() and the base MFA tables from 001 are left intact.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS sms_mfa_otps CASCADE;

ALTER TABLE user_mfa_devices DROP COLUMN IF EXISTS display_hint;
ALTER TABLE user_mfa_devices DROP COLUMN IF EXISTS phone_number_encrypted;
ALTER TABLE user_mfa_devices DROP COLUMN IF EXISTS failed_attempts;
ALTER TABLE user_mfa_devices DROP COLUMN IF EXISTS last_failed_at;
ALTER TABLE user_mfa_devices DROP COLUMN IF EXISTS use_count;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'organization_settings'
  ) THEN
    ALTER TABLE organization_settings
      DROP CONSTRAINT IF EXISTS org_settings_mfa_grace_period_chk;
    ALTER TABLE organization_settings
      DROP CONSTRAINT IF EXISTS org_settings_mfa_max_devices_chk;
    ALTER TABLE organization_settings
      DROP CONSTRAINT IF EXISTS org_settings_mfa_remember_days_chk;

    ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_allowed_methods;
    ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_primary_method_preference;
    ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_backup_codes_required;
    ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_grace_period_days;
    ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_max_devices_per_user;
    ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_allow_sms_fallback;
    ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_allow_email_fallback;
    ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_remember_device_days;
  END IF;
END $$;

COMMIT;


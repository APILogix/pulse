-- ============================================================================
-- 014_organizations_backfill_mfa_policy_columns.down.sql
-- ----------------------------------------------------------------------------
-- Drops the organization MFA policy columns backfilled in 014.
-- ============================================================================

BEGIN;

ALTER TABLE organization_settings
  DROP CONSTRAINT IF EXISTS org_settings_mfa_remember_days_chk;
ALTER TABLE organization_settings
  DROP CONSTRAINT IF EXISTS org_settings_mfa_max_devices_chk;
ALTER TABLE organization_settings
  DROP CONSTRAINT IF EXISTS org_settings_mfa_grace_period_chk;

ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_remember_device_days;
ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_allow_email_fallback;
ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_allow_sms_fallback;
ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_max_devices_per_user;
ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_grace_period_days;
ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_backup_codes_required;
ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_primary_method_preference;
ALTER TABLE organization_settings DROP COLUMN IF EXISTS mfa_allowed_methods;

COMMIT;

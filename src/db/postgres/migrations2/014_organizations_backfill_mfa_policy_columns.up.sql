-- ============================================================================
-- 014_organizations_backfill_mfa_policy_columns.up.sql
-- ----------------------------------------------------------------------------
-- Ensures organization_settings contains the org-level MFA policy columns that
-- auth/policy.service.ts expects. This backfills environments that bootstrapped
-- with 006 before those columns were included in the canonical org schema.
-- ============================================================================

BEGIN;

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS mfa_allowed_methods TEXT[] NOT NULL
    DEFAULT ARRAY['totp', 'email', 'hardware_key', 'backup_codes'];
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS mfa_primary_method_preference VARCHAR(50);
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS mfa_backup_codes_required BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS mfa_grace_period_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS mfa_max_devices_per_user INTEGER NOT NULL DEFAULT 10;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS mfa_allow_sms_fallback BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS mfa_allow_email_fallback BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS mfa_remember_device_days INTEGER NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_settings_mfa_grace_period_chk'
  ) THEN
    ALTER TABLE organization_settings
      ADD CONSTRAINT org_settings_mfa_grace_period_chk
      CHECK (mfa_grace_period_days >= 0 AND mfa_grace_period_days <= 365);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_settings_mfa_max_devices_chk'
  ) THEN
    ALTER TABLE organization_settings
      ADD CONSTRAINT org_settings_mfa_max_devices_chk
      CHECK (mfa_max_devices_per_user >= 1 AND mfa_max_devices_per_user <= 50);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_settings_mfa_remember_days_chk'
  ) THEN
    ALTER TABLE organization_settings
      ADD CONSTRAINT org_settings_mfa_remember_days_chk
      CHECK (mfa_remember_device_days >= 0 AND mfa_remember_device_days <= 365);
  END IF;
END $$;

COMMIT;

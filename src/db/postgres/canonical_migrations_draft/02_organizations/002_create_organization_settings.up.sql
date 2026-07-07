BEGIN;

CREATE TABLE IF NOT EXISTS organization_settings (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enforce_sso BOOLEAN NOT NULL DEFAULT FALSE,
  enforce_mfa BOOLEAN NOT NULL DEFAULT FALSE,
  session_timeout_minutes INTEGER NOT NULL DEFAULT 480 CHECK (session_timeout_minutes >= 5),
  mfa_allowed_methods TEXT[] NOT NULL DEFAULT ARRAY['totp', 'email', 'hardware_key', 'backup_codes'],
  mfa_primary_method_preference VARCHAR(50),
  mfa_backup_codes_required BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_grace_period_days INTEGER NOT NULL DEFAULT 7
    CHECK (mfa_grace_period_days >= 0 AND mfa_grace_period_days <= 365),
  mfa_max_devices_per_user INTEGER NOT NULL DEFAULT 10
    CHECK (mfa_max_devices_per_user >= 1 AND mfa_max_devices_per_user <= 50),
  mfa_allow_sms_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_allow_email_fallback BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_remember_device_days INTEGER NOT NULL DEFAULT 30
    CHECK (mfa_remember_device_days >= 0 AND mfa_remember_device_days <= 365),
  data_region VARCHAR(50) NOT NULL DEFAULT 'us-east-1',
  data_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (data_retention_days >= 1),
  audit_log_retention_days INTEGER NOT NULL DEFAULT 365 CHECK (audit_log_retention_days >= 30),
  allow_public_projects BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_org_settings_updated_at ON organization_settings;
CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

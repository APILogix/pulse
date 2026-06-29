-- ============================================================================
-- 005_add_mfa_system.up.sql
-- ----------------------------------------------------------------------------
-- Google-style multi-factor authentication: multiple devices per user, a
-- primary/default device, "try another way", device management, SMS OTP, and
-- organization-level MFA policy.
--
-- DESIGN NOTE (Option A — extend, do not duplicate):
--   This migration EXTENDS the existing canonical MFA schema from
--   001_auth_canonical_consolidated.up.sql. It deliberately does NOT create a
--   parallel `mfa_devices` / `mfa_backup_codes` / `mfa_sessions` /
--   `mfa_policies` / `mfa_remembered_devices` family. Instead:
--
--     * Devices stay in `user_mfa_devices`. WebAuthn/passkey map onto the
--       existing `hardware_key` enum value (no enum churn). We add the columns
--       needed for the "try another way" UI and per-device lockout.
--     * Backup codes stay as SHA-256 hashes in `user_mfa_devices.backup_codes_hash`
--       (JSONB) — no separate table.
--     * Login-MFA session state stays in the in-process LRU challenge cache
--       (loginMfaChallengeCache); there is no DB `mfa_sessions` table.
--     * "Remember this device / skip MFA" stays in `user_trusted_devices`.
--     * Audit stays in the shared `audit_logs` table via logAudit().
--     * Org policy EXTENDS `organization_settings` (consumed by
--       policy.service.ts) instead of introducing a parallel policy table.
--
--   New in this migration:
--     * `user_mfa_devices` columns: display_hint, phone_number_encrypted,
--       failed_attempts, last_failed_at, use_count.
--     * `organization_settings` MFA-policy columns (allowed methods, grace
--       period, device cap, fallback flags, remember-device window).
--     * `sms_mfa_otps` table (mirrors `email_mfa_otps`) for SMS OTP delivery.
--
-- Idempotent + safe to re-run. RLS is INTENTIONALLY DISABLED: this codebase
-- enforces tenant/user isolation in the service layer and never sets
-- app.current_org_id (see notes in 004_add_analytics_module.up.sql and the
-- BUGFIX #4 note in 001_auth_canonical_consolidated.up.sql).
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) user_mfa_devices — columns for "try another way" + per-device lockout
-- ----------------------------------------------------------------------------

-- Human-readable masked hint shown in the "try another way" picker, e.g.
-- "+1 •••• 1234", "j•••@example.com", "Google Authenticator", "YubiKey 5".
ALTER TABLE user_mfa_devices
  ADD COLUMN IF NOT EXISTS display_hint VARCHAR(255);

-- SMS destination, encrypted at rest with the shared AES-256-GCM primitive
-- (shared/utils/encryption.ts). The masked form lives in display_hint so the
-- picker never needs to decrypt. NULL for non-SMS devices.
ALTER TABLE user_mfa_devices
  ADD COLUMN IF NOT EXISTS phone_number_encrypted TEXT;

-- Per-device brute-force tracking. Account-wide lockout still lives on
-- users.login_attempts / users.locked_until; this is the per-device counter
-- that drives "5 failed attempts per device / 15 min" backoff.
ALTER TABLE user_mfa_devices
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_mfa_devices
  ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ;

-- Total successful verifications (analytics + "last used" ordering aid).
ALTER TABLE user_mfa_devices
  ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;

-- Backfill a sensible display_hint for existing rows so the picker is never
-- blank. SMS hints can't be derived (number is now write-only/encrypted), so
-- they fall back to the device name.
UPDATE user_mfa_devices
   SET display_hint = CASE
         WHEN device_type = 'totp'         THEN COALESCE(NULLIF(device_name, ''), 'Authenticator App')
         WHEN device_type = 'email'        THEN COALESCE(NULLIF(device_name, ''), 'Email code')
         WHEN device_type = 'hardware_key' THEN COALESCE(NULLIF(device_name, ''), 'Security key')
         WHEN device_type = 'sms'          THEN COALESCE(NULLIF(device_name, ''), 'Text message')
         WHEN device_type = 'backup_codes' THEN 'Backup code'
         ELSE COALESCE(NULLIF(device_name, ''), 'Verification method')
       END
 WHERE display_hint IS NULL;

-- ----------------------------------------------------------------------------
-- 2) sms_mfa_otps — SMS one-time codes (mirrors email_mfa_otps)
--    Codes are stored as SHA-256 hashes; only the newest unused code per
--    device is valid (partial unique index below).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_mfa_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES user_mfa_devices(id) ON DELETE CASCADE,

    code_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,

    -- Per-hour send-rate accounting is done in the service layer; created_at
    -- supports the "max 3 SMS / hour" window query.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_mfa_otps_active_device
  ON sms_mfa_otps(device_id) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sms_mfa_otps_user
  ON sms_mfa_otps(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_mfa_otps_cleanup
  ON sms_mfa_otps(expires_at) WHERE used_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3) organization_settings — organization-level MFA policy
--    Extends the existing settings row that policy.service.ts already reads.
--    `enforce_mfa` (already present) is the "MFA required" flag; these columns
--    add allowed methods, grace period, device cap, fallback toggles, and the
--    remember-device window. Guarded so a DB that has not yet applied the
--    legacy organizations migration does not hard-fail here.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'organization_settings'
  ) THEN
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
    -- SMS delivery requires an external provider that is not yet wired, so the
    -- SMS fallback defaults OFF until a provider is configured.
    ALTER TABLE organization_settings
      ADD COLUMN IF NOT EXISTS mfa_allow_sms_fallback BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE organization_settings
      ADD COLUMN IF NOT EXISTS mfa_allow_email_fallback BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE organization_settings
      ADD COLUMN IF NOT EXISTS mfa_remember_device_days INTEGER NOT NULL DEFAULT 30;

    -- Sanity bounds (added only if not already present).
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
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4) Comments
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN user_mfa_devices.display_hint IS
  'Masked, human-readable hint for the "try another way" picker (e.g. "+1 ••• 1234").';
COMMENT ON COLUMN user_mfa_devices.phone_number_encrypted IS
  'AES-256-GCM encrypted SMS destination (E.164). NULL for non-SMS devices.';
COMMENT ON COLUMN user_mfa_devices.failed_attempts IS
  'Per-device failed verification counter for 5-per-15-min backoff.';
COMMENT ON TABLE sms_mfa_otps IS
  'SMS one-time codes (SHA-256 hashed). Newest unused code per device is valid.';

COMMIT;

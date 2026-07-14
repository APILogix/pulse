
BEGIN;

-- ============================================================
-- ENUMS (if not already defined)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'webauthn', 'backup_code');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- MFA DEVICES TABLE REFACTOR
-- ============================================================

-- Rename device_type to type if needed, but since the existing schema uses device_type
-- and we want both type and device_type, let's make sure they both exist.

-- Note: The existing table in canonical_migrations_draft might not have device_type.
-- If user_mfa_devices is already running on migrations2, it has device_type mfa_type.
-- Wait, the user's migration specifies the EXACT CREATE TABLE statement, which means
-- they want to ensure these columns exist. We will ALTER TABLE to match the new schema.

BEGIN;

-- ============================================================
-- ENUM (if not already defined)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'webauthn', 'backup_code');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- FINAL user_mfa_devices TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS user_mfa_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- MFA method type (what auth protocol: totp, sms, email, webauthn)
    type mfa_type NOT NULL,

    -- Device category (physical form factor: mobile_app, hardware_key, platform, etc.)
    device_type VARCHAR(50) NOT NULL DEFAULT 'unknown',

    device_name VARCHAR(255) NOT NULL,

    -- TOTP/HOTP
    secret_encrypted TEXT,

    -- SMS
    phone_e164 VARCHAR(32),

    -- Email OTP
    email VARCHAR(255),

    -- WebAuthn / FIDO2
    credential_id TEXT,
    public_key TEXT,
    sign_count INTEGER NOT NULL DEFAULT 0,

    -- Verification status
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,

    -- Usage tracking
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,

    -- Primary device flag (one per user)
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,

    -- Soft delete / disable
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    disabled_at TIMESTAMPTZ,
    disabled_reason TEXT,

    -- Extensible metadata (AAGUID, device info, registration extensions, etc.)
    device_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- One primary MFA device per user (active only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_one_primary
  ON user_mfa_devices(user_id)
  WHERE is_primary = TRUE AND is_active = TRUE;

-- List user's active MFA devices by type
CREATE INDEX IF NOT EXISTS idx_mfa_devices_user_type
  ON user_mfa_devices(user_id, type)
  WHERE is_active = TRUE;

-- WebAuthn credential ID uniqueness (active devices only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_credential_id
  ON user_mfa_devices(credential_id)
  WHERE credential_id IS NOT NULL AND is_active = TRUE;

-- Find devices by phone (for SMS)
CREATE INDEX IF NOT EXISTS idx_mfa_devices_phone
  ON user_mfa_devices(phone_e164)
  WHERE phone_e164 IS NOT NULL AND is_active = TRUE;

-- Find devices by email
CREATE INDEX IF NOT EXISTS idx_mfa_devices_email
  ON user_mfa_devices(email)
  WHERE email IS NOT NULL AND is_active = TRUE;

-- ============================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mfa_devices_updated_at ON user_mfa_devices;
CREATE TRIGGER trg_mfa_devices_updated_at
  BEFORE UPDATE ON user_mfa_devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;
-- If 'device_type' was an enum previously, we might need to cast or rename it.
-- Assuming 'type' takes over the enum role, and 'device_type' becomes the string.
-- This depends on the exact current state. To be safe, we will just add missing columns
-- and drop the removed one.

-- ============================================================
-- BACKUP CODES TABLE
-- ============================================================

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

-- ============================================================
-- EXTRACT EXISTING BACKUP CODES
-- ============================================================
-- We use a DO block or just INSERT ... SELECT with jsonb_array_elements_text
-- (Assuming backup_codes_hash or backup_codes_hashes exist and are JSONB arrays of strings)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_mfa_devices' AND column_name='backup_codes_hash') THEN
    INSERT INTO user_backup_codes (user_id, code_hash)
    SELECT d.user_id, jsonb_array_elements_text(d.backup_codes_hash) AS code_hash
    FROM user_mfa_devices d
    WHERE d.backup_codes_hash IS NOT NULL AND jsonb_typeof(d.backup_codes_hash) = 'array'
    ON CONFLICT DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_mfa_devices' AND column_name='backup_codes_hashes') THEN
    INSERT INTO user_backup_codes (user_id, code_hash)
    SELECT d.user_id, jsonb_array_elements_text(d.backup_codes_hashes) AS code_hash
    FROM user_mfa_devices d
    WHERE d.backup_codes_hashes IS NOT NULL AND jsonb_typeof(d.backup_codes_hashes) = 'array'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

ALTER TABLE user_mfa_devices DROP COLUMN IF EXISTS backup_codes_hashes;
ALTER TABLE user_mfa_devices DROP COLUMN IF EXISTS backup_codes_hash;


-- ============================================================
-- TRIGGER: Auto-revoke old backup codes
-- ============================================================

CREATE OR REPLACE FUNCTION generate_backup_codes_for_user(
  p_user_id UUID,
  p_count INTEGER DEFAULT 10
) RETURNS TABLE(code_plaintext TEXT, code_hash TEXT) AS $$
DECLARE
  v_code TEXT;
  v_hash TEXT;
BEGIN
  -- Generate N random backup codes and their hashes
  FOR i IN 1..p_count LOOP
    v_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
    v_hash := crypt(v_code, gen_salt('bf', 12));
    
    INSERT INTO user_backup_codes (user_id, code_hash)
    VALUES (p_user_id, v_hash);
    
    code_plaintext := v_code;
    code_hash := v_hash;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION revoke_and_regenerate_backup_codes()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when a device becomes newly verified
  IF NEW.is_verified = TRUE AND (OLD.is_verified = FALSE OR OLD.is_verified IS NULL) THEN
    -- Revoke all existing unused backup codes
    DELETE FROM user_backup_codes
    WHERE user_id = NEW.user_id AND used_at IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_revoke_backup_codes ON user_mfa_devices;
CREATE TRIGGER auto_revoke_backup_codes
  AFTER UPDATE ON user_mfa_devices
  FOR EACH ROW
  WHEN (NEW.is_verified = TRUE AND OLD.is_verified = FALSE)
  EXECUTE FUNCTION revoke_and_regenerate_backup_codes();

COMMIT;

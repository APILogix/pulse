-- ============================================
-- AUTH MODULE SCHEMA
-- ============================================

-- ============================================
-- EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ENUM TYPES (Auth Specific)
-- ============================================
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'deleted');
CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'hardware_key', 'backup_codes');
CREATE TYPE session_status AS ENUM ('active', 'expired', 'revoked', 'terminated_by_admin');
CREATE TYPE security_event_type AS ENUM ('brute_force_attempt', 'suspicious_ip', 'impossible_travel', 'credential_stuffing', 'account_takeover', 'privilege_escalation');

-- ============================================
-- 1. USERS TABLE (Core Identity)
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Profile
    email VARCHAR(255) NOT NULL,
    email_hash VARCHAR(64) GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,
    
    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    
    -- Authentication
    password_hash VARCHAR(255), 
    last_password_change TIMESTAMPTZ,
    password_history JSONB DEFAULT '[]', -- Store last 5 password hashes to prevent reuse
    
    -- Status & Lifecycle
    status user_status DEFAULT 'active',
    status_reason TEXT, -- Why suspended/deleted
    
    -- Security Settings
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_enforced_at TIMESTAMPTZ,
    mfa_backup_codes_generated_at TIMESTAMPTZ,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ, -- Account lockout timestamp
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    last_login_user_agent TEXT,
    
    -- Preferences
    timezone VARCHAR(50) DEFAULT 'UTC',
    locale VARCHAR(10) DEFAULT 'en',
    preferred_mfa_method mfa_type,
    
    -- Legal
    accepted_terms_at TIMESTAMPTZ,
    accepted_privacy_at TIMESTAMPTZ,
    
    -- Soft Delete
    deleted_at TIMESTAMPTZ,
    deleted_by UUID, -- References users.id (removed constraint for clean separation)
    deletion_reason TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID, -- References users.id (for admin creation)
    version INTEGER DEFAULT 1 -- Optimistic locking
);

-- Indexes for Users
CREATE UNIQUE INDEX idx_users_email_hash ON users(email_hash) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_auth_lookup ON users(email, status, password_hash) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_locked ON users(locked_until) WHERE locked_until > NOW();

-- ============================================
-- 2. USER SESSIONS (Session Management)
-- ============================================
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Tokens
    refresh_token_hash VARCHAR(64) NOT NULL,
    access_token_jti VARCHAR(255), -- JWT ID for revocation
    
    -- Device Context
    device_fingerprint VARCHAR(64),
    device_name VARCHAR(255), -- "Chrome on macOS"
    device_type VARCHAR(50), -- desktop, mobile, tablet
    ip_address INET NOT NULL,
    ip_geo_country VARCHAR(2),
    ip_geo_city VARCHAR(100),
    user_agent TEXT,
    
    -- Timing
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL, -- Max session lifetime
    
    -- Status
    status session_status DEFAULT 'active',
    terminated_at TIMESTAMPTZ,
    terminated_by UUID REFERENCES users(id),
    termination_reason TEXT,
    
    -- MFA Context
    mfa_verified_at TIMESTAMPTZ, -- When MFA was completed for this session
    mfa_expires_at TIMESTAMPTZ, -- Re-prompt for MFA after this time
    
    CONSTRAINT valid_session_dates CHECK (expires_at > created_at AND absolute_expires_at > created_at)
);

-- Indexes for Sessions
CREATE UNIQUE INDEX idx_sessions_refresh_token ON user_sessions(refresh_token_hash);
CREATE INDEX idx_sessions_user_active ON user_sessions(user_id, last_active_at DESC) WHERE status = 'active';

-- ============================================
-- 3. MFA DEVICES (2FA/TOTP/WebAuthn)
-- ============================================
CREATE TABLE user_mfa_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    device_type mfa_type NOT NULL,
    device_name VARCHAR(255) NOT NULL, -- "Authenticator App", "YubiKey"
    
    -- Secrets (Encrypted)
    secret_encrypted TEXT, -- TOTP secret
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    
    -- Hardware Keys (WebAuthn)
    credential_id TEXT,
    public_key TEXT,
    sign_count INTEGER DEFAULT 0,
    
    -- Backup Codes
    backup_codes_hash JSONB, -- Array of hashed codes
    
    -- Metadata
    device_metadata JSONB,
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,
    
    -- Status
    is_primary BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    disabled_at TIMESTAMPTZ,
    disabled_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT one_primary_mfa UNIQUE (user_id, is_primary) 
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_mfa_devices_user ON user_mfa_devices(user_id) WHERE is_active = TRUE;

-- ============================================
-- 4. PASSWORD RESETS (Forgot Password Flow)
-- ============================================
CREATE TABLE password_resets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    
    used_at TIMESTAMPTZ,
    used_ip INET,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, token_hash)
);

CREATE INDEX idx_password_resets_token ON password_resets(token_hash) WHERE used_at IS NULL;

-- ============================================
-- 5. EMAIL VERIFICATIONS (Verify Email Flow)
-- ============================================
CREATE TABLE email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    
    verified_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, email)
);

CREATE INDEX idx_email_verifications_token ON email_verifications(token_hash) WHERE verified_at IS NULL;

-- ============================================
-- 6. SECURITY EVENTS (Auth Security Monitoring)
-- ============================================
CREATE TABLE security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Classification
    event_type security_event_type NOT NULL,
    severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 10),
    
    -- Actor
    user_id UUID REFERENCES users(id),
    
    -- Context
    ip_address INET NOT NULL,
    ip_country VARCHAR(2),
    user_agent TEXT,
    device_fingerprint VARCHAR(64),
    
    -- Details
    description TEXT NOT NULL,
    evidence JSONB, -- { "failed_attempts": 5, "previous_ip": "..." }
    
    -- Action
    action_taken VARCHAR(100), -- blocked, challenged, logged_only
    blocked_until TIMESTAMPTZ,
    
    -- Resolution
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    false_positive BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Security Events
CREATE INDEX idx_security_user_time ON security_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_security_open ON security_events(event_type, created_at DESC) WHERE resolved_at IS NULL;

-- ============================================
-- TRIGGERS & FUNCTIONS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN
    NEW.updated_at = NOW();
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = TG_TABLE_NAME AND column_name = 'version') THEN
       NEW.version = OLD.version + 1;
    END IF;
    RETURN NEW;
END;
 $$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mfa_devices_updated_at BEFORE UPDATE ON user_mfa_devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Security Trigger: Auto-lock account after 5 failed attempts
CREATE OR REPLACE FUNCTION check_login_attempts()
RETURNS TRIGGER AS $$ BEGIN
    IF NEW.login_attempts >= 5 THEN
        NEW.locked_until = NOW() + INTERVAL '30 minutes';
        NEW.status = 'suspended';
        NEW.status_reason = 'Too many failed login attempts';
        
        -- Log security event
        INSERT INTO security_events (
            event_type, severity, user_id, ip_address, 
            description, action_taken, blocked_until
        ) VALUES (
            'brute_force_attempt', 7, NEW.id, NEW.last_login_ip,
            'Account locked due to 5 failed login attempts',
            'blocked', NEW.locked_until
        );
    END IF;
    RETURN NEW;
END;
 $$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_login_attempts
    BEFORE UPDATE OF login_attempts ON users
    FOR EACH ROW
    WHEN (NEW.login_attempts >= 5 AND OLD.login_attempts < 5)
    EXECUTE FUNCTION check_login_attempts();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa_devices ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own data
CREATE POLICY user_isolation ON users
    FOR ALL
    USING (id = current_setting('app.current_user_id')::UUID 
           OR current_setting('app.is_admin', true)::BOOLEAN IS NOT FALSE);

CREATE POLICY session_isolation ON user_sessions
    FOR ALL
    USING (user_id = current_setting('app.current_user_id')::UUID);

CREATE POLICY mfa_device_isolation ON user_mfa_devices
    FOR ALL
    USING (user_id = current_setting('app.current_user_id')::UUID);
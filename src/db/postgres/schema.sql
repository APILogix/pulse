-- ============================================
-- EXTENSIONS (Enable required features)
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ENUM TYPES (Data integrity and performance)
-- ============================================
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'deleted');
CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'hardware_key', 'backup_codes');
CREATE TYPE org_role AS ENUM ('owner', 'admin', 'member', 'viewer', 'billing');
CREATE TYPE org_status AS ENUM ('active', 'suspended', 'cancelled', 'trial_expired');
CREATE TYPE audit_action AS ENUM (
    'user.created', 'user.updated', 'user.deleted', 'user.login', 'user.logout', 'user.password_changed', 'user.mfa_enabled', 'user.mfa_disabled',
    'org.created', 'org.updated', 'org.deleted', 'org.member_invited', 'org.member_joined', 'org.member_removed', 'org.role_changed',
    'project.created', 'project.updated', 'project.deleted', 'project.api_key_created', 'project.api_key_revoked',
    'alert_rule.created', 'alert_rule.updated', 'alert_rule.deleted', 'alert_rule.triggered',
    'billing.subscription_created', 'billing.subscription_cancelled', 'billing.payment_succeeded', 'billing.payment_failed',
    'security.suspicious_login_blocked', 'security.mfa_challenge_failed', 'security.token_revoked', 'security.session_terminated',
    'data.export_requested', 'data.deletion_requested', 'data.deletion_completed',
    'admin.impersonation_started', 'admin.impersonation_ended', 'admin.force_password_reset'
);
CREATE TYPE audit_resource_type AS ENUM ('user', 'organization', 'project', 'api_key', 'alert_rule', 'subscription', 'invoice', 'session', 'audit_log');
CREATE TYPE session_status AS ENUM ('active', 'expired', 'revoked', 'terminated_by_admin');
CREATE TYPE security_event_type AS ENUM ('brute_force_attempt', 'suspicious_ip', 'impossible_travel', 'credential_stuffing', 'account_takeover', 'privilege_escalation', 'data_exfiltration');

-- ============================================
-- CORE AUTH: users TABLE
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Profile (PII - encrypted at application layer)
    email VARCHAR(255) NOT NULL,
    email_hash VARCHAR(64) GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
    email_verified BOOLEAN DEFAULT TRUE,
    email_verified_at TIMESTAMPTZ,
    
    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    
    -- Authentication
    password_hash VARCHAR(255), -- Nullable for SSO-only users
    last_password_change TIMESTAMPTZ,
    password_history JSONB DEFAULT '[]', -- Store last 5 password hashes
    
    -- Status & Lifecycle
    status user_status DEFAULT 'active',
    status_reason TEXT, -- Why suspended/deleted
    
    -- Security Settings
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_enforced_at TIMESTAMPTZ,
    mfa_backup_codes_generated_at TIMESTAMPTZ,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ, -- Account lockout
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    last_login_user_agent TEXT,
    
    -- Preferences
    timezone VARCHAR(50) DEFAULT 'UTC',
    locale VARCHAR(10) DEFAULT 'en',
    preferred_mfa_method mfa_type,
    
    -- GDPR & Compliance
    accepted_terms_at TIMESTAMPTZ,
    accepted_privacy_at TIMESTAMPTZ,
    marketing_consent BOOLEAN DEFAULT FALSE,
    marketing_consent_updated_at TIMESTAMPTZ,
    data_processing_consent BOOLEAN DEFAULT FALSE,
    
    -- Soft Delete & Audit
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    deletion_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id), -- For admin-created accounts
    version INTEGER DEFAULT 1 -- Optimistic locking
);

-- Indexes for users
CREATE UNIQUE INDEX idx_users_email_hash ON users(email_hash) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users(status) WHERE status IN ('active', 'inactive');
CREATE INDEX idx_users_last_login ON users(last_login_at) WHERE last_login_at IS NOT NULL;
CREATE INDEX idx_users_locked ON users(locked_until) WHERE locked_until > NOW();
CREATE INDEX idx_users_mfa_enabled ON users(mfa_enabled) WHERE mfa_enabled = TRUE;
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_email_verified ON users(email_verified) WHERE email_verified = FALSE; -- For re-engagement

-- Partial index for active users only (most queries)
CREATE INDEX idx_users_active ON users(id, email_hash, status) 
WHERE deleted_at IS NULL AND status = 'active';

-- ============================================
-- MFA DEVICES: user_mfa_devices TABLE
-- ============================================
CREATE TABLE user_mfa_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    device_type mfa_type NOT NULL,
    device_name VARCHAR(255) NOT NULL, -- "iPhone 15", "YubiKey 5"
    
    -- TOTP/SMS/Email
    secret_encrypted TEXT, -- Encrypted TOTP secret or phone/email
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    
    -- Hardware Key (WebAuthn)
    credential_id TEXT, -- WebAuthn credential ID
    public_key TEXT, -- WebAuthn public key
    sign_count INTEGER DEFAULT 0, -- WebAuthn counter
    
    -- Backup Codes (hashed)
    backup_codes_hash JSONB, -- Array of 10 hashed codes
    
    -- Device Metadata
    device_metadata JSONB, -- { "os": "iOS 17", "browser": "Safari", "ip": "..." }
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,
    
    -- Status
    is_primary BOOLEAN DEFAULT FALSE, -- Default device for challenges
    is_active BOOLEAN DEFAULT TRUE,
    disabled_at TIMESTAMPTZ,
    disabled_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Only one primary device per user
    CONSTRAINT one_primary_mfa UNIQUE (user_id, is_primary) 
        DEFERRABLE INITIALLY DEFERRED
);

-- Indexes for MFA devices
CREATE INDEX idx_mfa_devices_user ON user_mfa_devices(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_mfa_devices_type ON user_mfa_devices(device_type);
CREATE INDEX idx_mfa_devices_primary ON user_mfa_devices(user_id) WHERE is_primary = TRUE;
CREATE INDEX idx_mfa_devices_verified ON user_mfa_devices(verified) WHERE verified = FALSE; -- Pending verification

-- ============================================
-- ORGANIZATIONS: organizations TABLE
-- ============================================
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Basic Info
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    logo_url TEXT,
    website_url TEXT,
    
    -- Ownership & Billing
    owner_user_id UUID NOT NULL REFERENCES users(id),
    billing_email VARCHAR(255) NOT NULL,
    billing_name VARCHAR(255),
    billing_address JSONB, -- { street, city, state, zip, country, vat_id }
    
    -- Plan & Limits
    plan_id VARCHAR(50) NOT NULL DEFAULT 'starter',
    plan_started_at TIMESTAMPTZ DEFAULT NOW(),
    plan_expires_at TIMESTAMPTZ,
    
    -- Status
    status org_status DEFAULT 'active',
    trial_started_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    grace_period_ends_at TIMESTAMPTZ, -- After cancellation
    
    -- Security Settings
    enforce_sso BOOLEAN DEFAULT FALSE, -- Force SAML/SSO login
    enforce_mfa BOOLEAN DEFAULT FALSE, -- Require all members to have MFA
    allowed_email_domains TEXT[], -- ["company.com"] for auto-join
    ip_allowlist INET[], -- Restrict access to corporate IPs
    session_timeout_minutes INTEGER DEFAULT 480, -- 8 hours
    
    -- Data Residency (GDPR/CCPA)
    data_region VARCHAR(50) DEFAULT 'us-east-1', -- us-east-1, eu-west-1, ap-south-1
    data_retention_days INTEGER DEFAULT 90,
    
    -- Soft Delete
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT valid_trial_dates CHECK (trial_ends_at IS NULL OR trial_ends_at > trial_started_at)
);

-- Indexes for organizations
CREATE UNIQUE INDEX idx_orgs_slug_active ON organizations(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_orgs_owner ON organizations(owner_user_id);
CREATE INDEX idx_orgs_plan ON organizations(plan_id, status) WHERE status = 'active';
CREATE INDEX idx_orgs_trial ON organizations(trial_ends_at) 
    WHERE trial_ends_at IS NOT NULL AND trial_ends_at > NOW();
CREATE INDEX idx_orgs_data_region ON organizations(data_region);
CREATE INDEX idx_orgs_ip_allowlist ON organizations USING GIN(ip_allowlist) 
    WHERE ip_allowlist IS NOT NULL AND array_length(ip_allowlist, 1) > 0;

-- ============================================
-- MEMBERSHIP: organization_members TABLE
-- ============================================
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Role & Permissions
    role org_role NOT NULL DEFAULT 'member',
    
    -- Role-specific permissions (override defaults)
    permissions JSONB DEFAULT '{}', -- { "billing:view": true, "settings:edit": false }
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    deactivated_at TIMESTAMPTZ,
    deactivated_by UUID REFERENCES users(id),
    deactivation_reason TEXT,
    
    -- Invited by (audit trail)
    invited_by UUID REFERENCES users(id),
    invited_at TIMESTAMPTZ,
    
    -- Joined
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    joined_method VARCHAR(50) DEFAULT 'invite', -- invite, sso_auto_provision, admin_add
    
    -- Last activity
    last_active_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(org_id, user_id)
);

-- Indexes for organization members
CREATE INDEX idx_members_org ON organization_members(org_id) WHERE is_active = TRUE;
CREATE INDEX idx_members_user ON organization_members(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_members_role ON organization_members(org_id, role) WHERE is_active = TRUE;
CREATE INDEX idx_members_invited ON organization_members(invited_at) WHERE joined_at IS NULL; -- Pending invites

-- Composite index for common query: "Get my orgs with my role"
CREATE INDEX idx_members_user_orgs ON organization_members(user_id, org_id, role) 
    WHERE is_active = TRUE;

-- ============================================
-- INVITATIONS: organization_invitations TABLE
-- ============================================
CREATE TABLE organization_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Inviter
    invited_by UUID NOT NULL REFERENCES users(id),
    
    -- Invitee
    email VARCHAR(255) NOT NULL,
    email_hash VARCHAR(64) GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
    
    -- Role to assign
    role org_role NOT NULL DEFAULT 'member',
    
    -- Token & Expiry
    token_hash VARCHAR(64) NOT NULL, -- SHA-256 of the actual token
    expires_at TIMESTAMPTZ NOT NULL,
    
    -- Status
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES users(id),
    declined_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id),
    
    -- Metadata
    resent_count INTEGER DEFAULT 0,
    last_resent_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT valid_invitation_status CHECK (
        (accepted_at IS NULL OR declined_at IS NULL) AND
        (accepted_at IS NULL OR revoked_at IS NULL) AND
        (declined_at IS NULL OR revoked_at IS NULL)
    )
);

-- Indexes for invitations
CREATE UNIQUE INDEX idx_invitations_token ON organization_invitations(token_hash);
CREATE INDEX idx_invitations_email ON organization_invitations(email_hash) 
    WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_invitations_org ON organization_invitations(org_id) 
    WHERE accepted_at IS NULL; -- Pending invites per org
CREATE INDEX idx_invitations_expires ON organization_invitations(expires_at) 
    WHERE accepted_at IS NULL AND expires_at < NOW() + INTERVAL '24 hours'; -- Expiring soon

-- ============================================
-- SESSIONS: user_sessions TABLE (Enterprise-grade session management)
-- ============================================
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Session tokens (hashed)
    refresh_token_hash VARCHAR(64) NOT NULL,
    access_token_jti VARCHAR(255), -- JWT ID for revocation
    
    -- Device & Location (for "Log out other devices")
    device_fingerprint VARCHAR(64), -- Hash of user agent + IP + device info
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
    absolute_expires_at TIMESTAMPTZ NOT NULL, -- Max 30 days regardless of activity
    
    -- Status
    status session_status DEFAULT 'active',
    terminated_at TIMESTAMPTZ,
    terminated_by UUID REFERENCES users(id),
    termination_reason TEXT,
    
    -- MFA status for this session
    mfa_verified_at TIMESTAMPTZ, -- When MFA was completed
    mfa_expires_at TIMESTAMPTZ, -- Re-prompt for MFA after this
    
    CONSTRAINT valid_session_dates CHECK (expires_at > created_at AND absolute_expires_at > created_at)
);

-- Indexes for sessions
CREATE UNIQUE INDEX idx_sessions_refresh_token ON user_sessions(refresh_token_hash);
CREATE INDEX idx_sessions_user ON user_sessions(user_id, status) WHERE status = 'active';
CREATE INDEX idx_sessions_device ON user_sessions(user_id, device_fingerprint) WHERE status = 'active';
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at) WHERE status = 'active';
CREATE INDEX idx_sessions_active_recent ON user_sessions(user_id, last_active_at) 
    WHERE status = 'active' AND last_active_at > NOW() - INTERVAL '30 days';

-- For "Log out all other devices" query
CREATE INDEX idx_sessions_user_exclude ON user_sessions(user_id, id) 
    WHERE status = 'active';

-- ============================================
-- AUDIT LOGS: audit_logs TABLE (Immutable, partitioned)
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Actor (who did it)
    user_id UUID REFERENCES users(id), -- Nullable for system actions
    user_email VARCHAR(255), -- Denormalized for historical accuracy
    impersonated_by UUID REFERENCES users(id), -- Admin impersonation
    
    -- Target (what org)
    org_id UUID REFERENCES organizations(id),
    
    -- Action
    action audit_action NOT NULL,
    resource_type audit_resource_type NOT NULL,
    resource_id UUID, -- ID of affected resource
    
    -- Context
    ip_address INET NOT NULL,
    user_agent TEXT,
    request_id VARCHAR(255), -- Trace ID from request
    session_id UUID REFERENCES user_sessions(id),
    
    -- Details (PII should be encrypted here)
    metadata JSONB, -- { "before": {}, "after": {}, "reason": "..." }
    encrypted_payload TEXT, -- For sensitive changes (encryption at app layer)
    
    -- Integrity (tamper detection)
    log_hash VARCHAR(64), -- SHA-256 of entire row (chain of custody)
    previous_log_id UUID, -- Link to previous log for chain verification
    
    -- Timestamp with timezone
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Partition key (for time-based partitioning)
    created_date DATE GENERATED ALWAYS AS (DATE(created_at)) STORED
) PARTITION BY RANGE (created_date);

-- Create partitions (monthly for first year)
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
-- ... create for each month

-- Indexes for audit logs
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_org ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_request ON audit_logs(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_audit_ip ON audit_logs(ip_address) WHERE action LIKE 'security.%';
CREATE INDEX idx_audit_impersonation ON audit_logs(impersonated_by) WHERE impersonated_by IS NOT NULL;

-- GIN index for JSONB metadata queries
CREATE INDEX idx_audit_metadata ON audit_logs USING GIN(metadata);

-- ============================================
-- SECURITY EVENTS: security_events TABLE (Real-time threat detection)
-- ============================================
CREATE TABLE security_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Classification
    event_type security_event_type NOT NULL,
    severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 10), -- 10 = critical
    
    -- Actor (may not be authenticated)
    user_id UUID REFERENCES users(id),
    org_id UUID REFERENCES organizations(id),
    
    -- Context
    ip_address INET NOT NULL,
    ip_country VARCHAR(2),
    user_agent TEXT,
    device_fingerprint VARCHAR(64),
    
    -- Details
    description TEXT NOT NULL,
    evidence JSONB, -- { "failed_attempts": 5, "previous_success_ip": "...", "time_diff_hours": 12 }
    
    -- Automated response
    action_taken VARCHAR(100), -- blocked, challenged, logged_only
    blocked_until TIMESTAMPTZ,
    
    -- Resolution
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    false_positive BOOLEAN DEFAULT FALSE,
    
    -- Alerting
    alert_sent_at TIMESTAMPTZ,
    alert_channels TEXT[], -- email, sms, webhook
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for security events
CREATE INDEX idx_security_user ON security_events(user_id, created_at DESC) 
    WHERE user_id IS NOT NULL;
CREATE INDEX idx_security_org ON security_events(org_id, created_at DESC) 
    WHERE org_id IS NOT NULL;
CREATE INDEX idx_security_type ON security_events(event_type, created_at DESC);
CREATE INDEX idx_security_severity ON security_events(severity, created_at DESC) 
    WHERE severity >= 7; -- High severity only
CREATE INDEX idx_security_ip ON security_events(ip_address, created_at DESC);
CREATE INDEX idx_security_unresolved ON security_events(event_type) 
    WHERE resolved_at IS NULL; -- Open incidents
CREATE INDEX idx_security_blocked ON security_events(blocked_until) 
    WHERE blocked_until > NOW();

-- ============================================
-- PASSWORD RESETS: password_resets TABLE
-- ============================================
CREATE TABLE password_resets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    
    used_at TIMESTAMPTZ,
    used_ip INET,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, token_hash)
);

CREATE INDEX idx_password_resets_token ON password_resets(token_hash) WHERE used_at IS NULL;
CREATE INDEX idx_password_resets_user ON password_resets(user_id, created_at DESC);

-- ============================================
-- EMAIL VERIFICATION: email_verifications TABLE
-- ============================================
CREATE TABLE email_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
-- API KEY ACCESS LOGS: api_key_access_logs TABLE (For security auditing)
-- ============================================
CREATE TABLE api_key_access_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Key info (denormalized for performance)
    api_key_id UUID, -- May be NULL if key invalid
    key_prefix VARCHAR(8),
    project_id UUID,
    org_id UUID,
    
    -- Access details
    ip_address INET NOT NULL,
    user_agent TEXT,
    endpoint VARCHAR(255), -- Which SDK endpoint was hit
    allowed BOOLEAN NOT NULL, -- Was request allowed or rejected
    
    -- Rejection reason
    rejection_reason VARCHAR(100), -- invalid_key, expired, quota_exceeded, ip_not_allowed
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_date DATE GENERATED ALWAYS AS (DATE(created_at)) STORED
) PARTITION BY RANGE (created_date);

-- Indexes for API key logs
CREATE INDEX idx_api_key_logs_key ON api_key_access_logs(api_key_id, created_at DESC) 
    WHERE api_key_id IS NOT NULL;
CREATE INDEX idx_api_key_logs_project ON api_key_access_logs(project_id, created_at DESC);
CREATE INDEX idx_api_key_logs_ip ON api_key_access_logs(ip_address) WHERE allowed = FALSE;
CREATE INDEX idx_api_key_logs_rejection ON api_key_access_logs(rejection_reason, created_at DESC) 
    WHERE allowed = FALSE;

-- ============================================
-- TRIGGERS & FUNCTIONS (Automated maintenance)
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organization_members_updated_at BEFORE UPDATE ON organization_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-lock account after 5 failed attempts
CREATE OR REPLACE FUNCTION check_login_attempts()
RETURNS TRIGGER AS $$
BEGIN
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

-- Clean up expired sessions (can also be done via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
    UPDATE user_sessions 
    SET status = 'expired', 
        termination_reason = 'Automatic cleanup of expired session'
    WHERE status = 'active' 
      AND (expires_at < NOW() OR absolute_expires_at < NOW());
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY (RLP) POLICIES
-- ============================================

-- Enable RLS on tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data (except admins)
CREATE POLICY user_isolation ON users
    FOR ALL
    USING (id = current_setting('app.current_user_id')::UUID 
           OR current_setting('app.is_admin')::BOOLEAN);

-- Org members can see their org
CREATE POLICY org_member_isolation ON organizations
    FOR ALL
    USING (id IN (
        SELECT org_id FROM organization_members 
        WHERE user_id = current_setting('app.current_user_id')::UUID
        AND is_active = TRUE
    ) OR current_setting('app.is_admin')::BOOLEAN);

-- ============================================
-- VIEWS (Convenience queries)
-- ============================================

-- Active users with org count
CREATE VIEW user_dashboard AS
SELECT 
    u.id,
    u.clerk_user_id,
    u.full_name,
    u.email_hash,
    u.status,
    u.mfa_enabled,
    u.last_login_at,
    u.created_at,
    COUNT(DISTINCT om.org_id) as org_count,
    COUNT(DISTINCT CASE WHEN om.role = 'owner' THEN om.org_id END) as owned_orgs
FROM users u
LEFT JOIN organization_members om ON u.id = om.user_id AND om.is_active = TRUE
WHERE u.deleted_at IS NULL
GROUP BY u.id;

-- Organization with member count and usage
CREATE VIEW org_dashboard AS
SELECT 
    o.id,
    o.name,
    o.slug,
    o.plan_id,
    o.status,
    o.owner_user_id,
    o.data_region,
    COUNT(DISTINCT om.user_id) as member_count,
    COUNT(DISTINCT CASE WHEN om.is_active THEN om.user_id END) as active_members,
    o.trial_ends_at,
    o.created_at
FROM organizations o
LEFT JOIN organization_members om ON o.id = om.org_id
WHERE o.deleted_at IS NULL
GROUP BY o.id;

-- Active security incidents
CREATE VIEW open_security_incidents AS
SELECT *
FROM security_events
WHERE resolved_at IS NULL
ORDER BY severity DESC, created_at DESC;
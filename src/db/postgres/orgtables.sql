-- ============================================
-- DROP TABLES FIRST
-- ============================================

DROP TABLE IF EXISTS organization_sessions CASCADE;
DROP TABLE IF EXISTS organization_security_events CASCADE;
DROP TABLE IF EXISTS organization_scim_tokens CASCADE;
DROP TABLE IF EXISTS organization_sso_providers CASCADE;
DROP TABLE IF EXISTS organization_api_keys CASCADE;
DROP TABLE IF EXISTS organization_environments CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS quota_requests CASCADE;
DROP TABLE IF EXISTS organization_invitations CASCADE;
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS organization_ip_allowlist CASCADE;
DROP TABLE IF EXISTS organization_allowed_domains CASCADE;
DROP TABLE IF EXISTS organization_settings CASCADE;
DROP TABLE IF EXISTS organization_billing_contacts CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

-- ============================================
-- DROP ENUM TYPES
-- ============================================

DROP TYPE IF EXISTS security_event_severity CASCADE;
DROP TYPE IF EXISTS quota_type CASCADE;
DROP TYPE IF EXISTS quota_request_status CASCADE;
DROP TYPE IF EXISTS joined_method CASCADE;
DROP TYPE IF EXISTS invitation_status CASCADE;
DROP TYPE IF EXISTS org_role CASCADE;
DROP TYPE IF EXISTS member_status CASCADE;
DROP TYPE IF EXISTS org_status CASCADE;




CREATE TYPE org_status AS ENUM (
    'active',
    'trialing',
    'suspended',
    'locked',
    'archived',
    'delinquent'
);

CREATE TYPE member_status AS ENUM (
    'invited',
    'active',
    'suspended',
    'removed',
    'locked'
);

CREATE TYPE org_role AS ENUM (
    'owner',
    'admin',
    'developer',
    'billing',
    'security',
    'member',
    'viewer'
);

CREATE TYPE invitation_status AS ENUM (
    'pending',
    'accepted',
    'declined',
    'revoked',
    'expired'
);

CREATE TYPE joined_method AS ENUM (
    'invite',
    'admin_add',
    'sso_auto_provision',
    'scim'
);

CREATE TYPE quota_request_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
);

CREATE TYPE quota_type AS ENUM (
    'api_requests',
    'events',
    'storage',
    'projects',
    'members',
    'alerts'
);

CREATE TYPE security_event_severity AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);

-- =====================================================
-- UPDATED AT TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- ORGANIZATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,

    description TEXT,
    logo_url TEXT,
    website_url TEXT,

    industry VARCHAR(100),
    company_size VARCHAR(50),
    country VARCHAR(100),
    timezone VARCHAR(100) DEFAULT 'UTC',

    billing_email VARCHAR(255),
    support_email VARCHAR(255),

    owner_user_id UUID NOT NULL REFERENCES users(id),
    created_by UUID REFERENCES users(id),

    status org_status NOT NULL DEFAULT 'trialing',

    deleted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_slug_active
ON organizations(slug)
WHERE deleted_at IS NULL;

CREATE TRIGGER trg_org_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- ORGANIZATION SETTINGS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_settings (
    org_id UUID PRIMARY KEY
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    enforce_sso BOOLEAN NOT NULL DEFAULT FALSE,
    enforce_mfa BOOLEAN NOT NULL DEFAULT FALSE,

    session_timeout_minutes INTEGER NOT NULL DEFAULT 480
        CHECK (session_timeout_minutes >= 5),

    data_region VARCHAR(50) NOT NULL DEFAULT 'us-east-1',

    data_retention_days INTEGER NOT NULL DEFAULT 90
        CHECK (data_retention_days >= 1),

    audit_log_retention_days INTEGER NOT NULL DEFAULT 365
        CHECK (audit_log_retention_days >= 30),

    allow_public_projects BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_org_settings_updated_at
BEFORE UPDATE ON organization_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- ORGANIZATION MEMBERS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    role org_role NOT NULL DEFAULT 'member',

    status member_status NOT NULL DEFAULT 'invited',

    invited_by UUID REFERENCES users(id),

    invited_at TIMESTAMPTZ,

    joined_at TIMESTAMPTZ,

    joined_method joined_method NOT NULL DEFAULT 'invite',

    last_active_at TIMESTAMPTZ,

    deactivated_at TIMESTAMPTZ,
    deactivated_by UUID REFERENCES users(id),
    deactivation_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org
ON organization_members(org_id);

CREATE INDEX IF NOT EXISTS idx_org_members_user
ON organization_members(user_id);

CREATE INDEX IF NOT EXISTS idx_org_members_role
ON organization_members(role);

CREATE TRIGGER trg_org_members_updated_at
BEFORE UPDATE ON organization_members
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- ORGANIZATION INVITATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    invited_by UUID NOT NULL
        REFERENCES users(id),

    email VARCHAR(255) NOT NULL,

    email_hash VARCHAR(64)
        GENERATED ALWAYS AS (
            encode(digest(lower(email), 'sha256'), 'hex')
        ) STORED,

    role org_role NOT NULL DEFAULT 'member',

    token_hash VARCHAR(64) NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,

    status invitation_status NOT NULL DEFAULT 'pending',

    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES users(id),

    declined_at TIMESTAMPTZ,

    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id),

    resent_count INTEGER NOT NULL DEFAULT 0,

    last_resent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_invite
ON organization_invitations(org_id, email)
WHERE status = 'pending';

-- =====================================================
-- QUOTA REQUESTS
-- =====================================================

CREATE TABLE IF NOT EXISTS quota_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    quota_type VARCHAR(50) NOT NULL,

    current_limit BIGINT NOT NULL
        CHECK (current_limit >= 0),

    requested_limit BIGINT NOT NULL
        CHECK (requested_limit > current_limit),

    reason TEXT NOT NULL,

    status quota_request_status
        NOT NULL DEFAULT 'pending',

    reviewed_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    reviewed_at TIMESTAMPTZ,

    notes TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_quota_requests_updated_at
BEFORE UPDATE ON quota_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- AUDIT LOGS
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    actor_user_id UUID
        REFERENCES users(id),

    action VARCHAR(100) NOT NULL,

    entity_type VARCHAR(100) NOT NULL,

    entity_id UUID,

    old_values JSONB,
    new_values JSONB,

    ip_address INET,

    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_org
ON audit_logs(org_id);

CREATE INDEX IF NOT EXISTS idx_audit_actor
ON audit_logs(actor_user_id);

-- =====================================================
-- ORGANIZATION ENVIRONMENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,

    slug VARCHAR(100) NOT NULL,

    description TEXT,

    is_production BOOLEAN NOT NULL DEFAULT FALSE,

    created_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(org_id, slug)
);

-- =====================================================
-- API KEYS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    environment_id UUID
        REFERENCES organization_environments(id)
        ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,

    key_prefix VARCHAR(20) NOT NULL,

    hashed_key TEXT NOT NULL,

    role org_role NOT NULL DEFAULT 'member',

    last_used_at TIMESTAMPTZ,

    expires_at TIMESTAMPTZ,

    revoked_at TIMESTAMPTZ,

    created_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org
ON organization_api_keys(org_id);

-- =====================================================
-- SSO PROVIDERS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_sso_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    provider_name VARCHAR(100) NOT NULL,

    provider_type VARCHAR(50) NOT NULL,

    entity_id TEXT,

    sso_url TEXT,

    x509_certificate TEXT,

    domain VARCHAR(255),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- SCIM TOKENS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_scim_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    token_hash TEXT NOT NULL,

    last_used_at TIMESTAMPTZ,

    expires_at TIMESTAMPTZ,

    revoked_at TIMESTAMPTZ,

    created_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- SECURITY EVENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    user_id UUID REFERENCES users(id),

    event_type VARCHAR(100) NOT NULL,

    severity VARCHAR(50) NOT NULL,

    ip_address INET,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =====================================================
-- AUDIT LOGS
-- Enterprise-grade immutable audit/event tracking
-- =====================================================

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant Isolation
    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    -- Actor
    actor_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    actor_email VARCHAR(255),

    actor_ip INET,

    actor_user_agent TEXT,

    actor_session_id UUID,

    -- Event Info
    action VARCHAR(100) NOT NULL,

    entity_type VARCHAR(100) NOT NULL,

    entity_id UUID,

    entity_name VARCHAR(255),

    -- Request Metadata
    request_id UUID,

    correlation_id UUID,

    http_method VARCHAR(10),

    endpoint TEXT,

    -- Change Tracking
    old_values JSONB,

    new_values JSONB,

    changed_fields TEXT[],

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'success'
        CHECK (status IN ('success', 'failure')),

    failure_reason TEXT,

    -- Security
    is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,

    -- Additional Metadata
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Org queries
CREATE INDEX idx_audit_logs_org
ON audit_logs(org_id);

-- User activity
CREATE INDEX idx_audit_logs_actor
ON audit_logs(actor_user_id);

-- Entity lookup
CREATE INDEX idx_audit_logs_entity
ON audit_logs(entity_type, entity_id);

-- Action filtering
CREATE INDEX idx_audit_logs_action
ON audit_logs(action);

-- Time-based queries
CREATE INDEX idx_audit_logs_created_at
ON audit_logs(created_at DESC);

-- Enterprise dashboard queries
CREATE INDEX idx_audit_logs_org_created
ON audit_logs(org_id, created_at DESC);

-- Security investigations
CREATE INDEX idx_audit_logs_org_action
ON audit_logs(org_id, action);

-- Failed actions
CREATE INDEX idx_audit_logs_failures
ON audit_logs(org_id, status)
WHERE status = 'failure';

-- Sensitive activity
CREATE INDEX idx_audit_logs_sensitive
ON audit_logs(org_id, is_sensitive)
WHERE is_sensitive = TRUE;

-- Request tracing
CREATE INDEX idx_audit_logs_request
ON audit_logs(request_id);

CREATE INDEX idx_audit_logs_correlation
ON audit_logs(correlation_id);

-- JSONB metadata search
CREATE INDEX idx_audit_logs_metadata_gin
ON audit_logs
USING GIN(metadata);

-- JSONB change tracking
CREATE INDEX idx_audit_logs_old_values_gin
ON audit_logs
USING GIN(old_values);

CREATE INDEX idx_audit_logs_new_values_gin
ON audit_logs
USING GIN(new_values);

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE audit_logs IS
'Immutable enterprise audit trail for compliance, governance, security investigations, and forensic analysis';

COMMENT ON COLUMN audit_logs.action IS
'Action performed such as org.created, member.invited, api_key.revoked';

COMMENT ON COLUMN audit_logs.entity_type IS
'Entity type affected such as organization, member, api_key';

COMMENT ON COLUMN audit_logs.old_values IS
'Previous state before mutation';

COMMENT ON COLUMN audit_logs.new_values IS
'New state after mutation';

COMMENT ON COLUMN audit_logs.changed_fields IS
'List of fields modified in operation';

-- =====================================================
-- OPTIONAL FUTURE PARTITIONING NOTE
-- =====================================================

-- This table WILL become massive in production.
-- Recommended future migration:
-- RANGE PARTITION BY created_at
-- Monthly partitions.
--
-- Example:
--
-- CREATE TABLE audit_logs_2026_05
-- PARTITION OF audit_logs
-- FOR VALUES FROM ('2026-05-01')
-- TO ('2026-06-01');
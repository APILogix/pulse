-- ============================================================================
-- 010_organizations.sql
-- ----------------------------------------------------------------------------
-- Canonical, idempotent schema for the ORGANIZATION MODULE.
--
-- Why this file exists:
--   The organization DDL previously lived in src/db/postgres/orgtables.sql,
--   OUTSIDE the migrations directory, so the migration runner (setup-db.ts)
--   never applied it. On a clean database the organization module would 500
--   because none of its tables existed. This migration brings the org schema
--   under migration control.
--
-- Audit-log table separation:
--   The auth module (008/009) owns a table named `audit_logs` with columns
--   (user_id, org_id, action, resource_type, resource_id, ...). The org module
--   writes a RICHER audit shape (actor_user_id, entity_type, old/new_values,
--   changed_fields, ...). Sharing one `audit_logs` table caused NOT NULL
--   violations for whichever writer lost the race. This migration gives the
--   org module its own dedicated, immutable audit table:
--   `organization_audit_logs`.
--
-- Safe to run repeatedly: all objects use IF NOT EXISTS / idempotent DO blocks.
-- No DROP statements — this never destroys existing data.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) ENUM TYPES (idempotent)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE org_status AS ENUM ('active','trialing','suspended','locked','archived','delinquent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE member_status AS ENUM ('invited','active','suspended','removed','locked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE org_role AS ENUM ('owner','admin','developer','billing','security','member','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE invitation_status AS ENUM ('pending','accepted','declined','revoked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE joined_method AS ENUM ('invite','admin_add','sso_auto_provision','scim');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE quota_request_status AS ENUM ('pending','approved','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2) Shared updated_at trigger function (idempotent via CREATE OR REPLACE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3) ORGANIZATIONS
-- ----------------------------------------------------------------------------
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

-- One active org per slug (tombstoned rows excluded so slugs can be reused).
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_slug_active
  ON organizations(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_org_owner
  ON organizations(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_org_status
  ON organizations(status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_org_updated_at ON organizations;
CREATE TRIGGER trg_org_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) ORGANIZATION SETTINGS (1:1 with organization)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_settings (
    org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    enforce_sso BOOLEAN NOT NULL DEFAULT FALSE,
    enforce_mfa BOOLEAN NOT NULL DEFAULT FALSE,
    session_timeout_minutes INTEGER NOT NULL DEFAULT 480 CHECK (session_timeout_minutes >= 5),
    data_region VARCHAR(50) NOT NULL DEFAULT 'us-east-1',
    data_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (data_retention_days >= 1),
    audit_log_retention_days INTEGER NOT NULL DEFAULT 365 CHECK (audit_log_retention_days >= 30),
    allow_public_projects BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_org_settings_updated_at ON organization_settings;
CREATE TRIGGER trg_org_settings_updated_at BEFORE UPDATE ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 5) ORGANIZATION MEMBERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role ON organization_members(role);
-- Hot path: "is this user an active member of this org?" and member listings.
CREATE INDEX IF NOT EXISTS idx_org_members_org_active
  ON organization_members(org_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_org_members_user_active
  ON organization_members(user_id, status) WHERE status = 'active';
-- Enforce at most one active owner per org at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_single_active_owner
  ON organization_members(org_id) WHERE role = 'owner' AND status = 'active';

DROP TRIGGER IF EXISTS trg_org_members_updated_at ON organization_members;
CREATE TRIGGER trg_org_members_updated_at BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 6) ORGANIZATION INVITATIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES users(id),
    email VARCHAR(255) NOT NULL,
    email_hash VARCHAR(64) GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
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

-- Only one pending invite per (org, email) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_invite
  ON organization_invitations(org_id, email) WHERE status = 'pending';
-- Token lookup is the accept path; unique among unconsumed tokens.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_token_pending
  ON organization_invitations(token_hash) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_invite_org ON organization_invitations(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invite_cleanup
  ON organization_invitations(expires_at) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 7) ORGANIZATION ENVIRONMENTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    is_production BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_org_envs_org ON organization_environments(org_id);

-- ----------------------------------------------------------------------------
-- 8) ORGANIZATION API KEYS (org-level, separate from project_api_keys)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    environment_id UUID REFERENCES organization_environments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    hashed_key VARCHAR(64) NOT NULL,
    role org_role NOT NULL DEFAULT 'member',
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_api_keys_org ON organization_api_keys(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_api_keys_hash ON organization_api_keys(hashed_key);
CREATE INDEX IF NOT EXISTS idx_org_api_keys_active
  ON organization_api_keys(org_id) WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 9) SSO PROVIDERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_sso_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider_name VARCHAR(100) NOT NULL,
    provider_type VARCHAR(50) NOT NULL,
    entity_id TEXT,
    sso_url TEXT,
    x509_certificate TEXT,
    domain VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sso_org ON organization_sso_providers(org_id);

-- ----------------------------------------------------------------------------
-- 10) SCIM TOKENS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_scim_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scim_token_hash ON organization_scim_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_scim_org ON organization_scim_tokens(org_id) WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 11) ORGANIZATION SECURITY EVENTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    ip_address INET,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_sec_events_org
  ON organization_security_events(org_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 12) QUOTA REQUESTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quota_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    quota_type VARCHAR(50) NOT NULL,
    current_limit BIGINT NOT NULL CHECK (current_limit >= 0),
    requested_limit BIGINT NOT NULL CHECK (requested_limit > current_limit),
    reason TEXT NOT NULL,
    status quota_request_status NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quota_requests_org
  ON quota_requests(org_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_quota_requests_updated_at ON quota_requests;
CREATE TRIGGER trg_quota_requests_updated_at BEFORE UPDATE ON quota_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 13) ORGANIZATION AUDIT LOGS  ★ dedicated table, distinct from auth audit_logs ★
-- ----------------------------------------------------------------------------
-- Immutable enterprise audit trail written by OrganizationRepository.createAuditLog.
-- Kept separate from the auth module's `audit_logs` (different column shape).
CREATE TABLE IF NOT EXISTS organization_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    actor_ip INET,
    actor_user_agent TEXT,
    actor_session_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    entity_name VARCHAR(255),
    request_id UUID,
    correlation_id UUID,
    http_method VARCHAR(10),
    endpoint TEXT,
    old_values JSONB,
    new_values JSONB,
    changed_fields TEXT[],
    status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success','failure')),
    failure_reason TEXT,
    is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_audit_org_created
  ON organization_audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_audit_actor
  ON organization_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_entity
  ON organization_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_action
  ON organization_audit_logs(org_id, action);
CREATE INDEX IF NOT EXISTS idx_org_audit_sensitive
  ON organization_audit_logs(org_id, is_sensitive) WHERE is_sensitive = TRUE;
CREATE INDEX IF NOT EXISTS idx_org_audit_metadata_gin
  ON organization_audit_logs USING GIN (metadata);

COMMENT ON TABLE organization_audit_logs IS
  'Immutable enterprise audit trail for the organization module. Distinct from auth audit_logs.';

COMMIT;

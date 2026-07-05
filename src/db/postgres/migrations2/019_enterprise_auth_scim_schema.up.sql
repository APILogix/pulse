-- ============================================================================
-- 019_enterprise_auth_scim_schema.up.sql
-- Enterprise-grade SAML/SCIM/token hardening for the existing schema.
--
-- Important:
-- - This repo already has audit_logs, organization_scim_tokens,
--   scim_user_mappings, and user_sessions.sso_provider_id.
-- - This migration only adds missing enterprise tables/columns/indexes.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) SCIM TOKEN SCOPES (least-privilege model)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_scim_token_scopes (
    token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
    scope VARCHAR(50) NOT NULL CHECK (scope IN (
        'users:read', 'users:write', 'users:delete',
        'groups:read', 'groups:write', 'groups:delete',
        'bulk'
    )),
    PRIMARY KEY (token_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_scim_token_scopes_scope
  ON organization_scim_token_scopes(scope);

-- ----------------------------------------------------------------------------
-- 2) SCIM TOKEN IP ALLOWLIST
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_scim_token_ips (
    token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
    ip_cidr CIDR NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (token_id, ip_cidr)
);

CREATE INDEX IF NOT EXISTS idx_scim_token_ips_token
  ON organization_scim_token_ips(token_id);

-- ----------------------------------------------------------------------------
-- 3) SCIM GROUPS (full lifecycle)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scim_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    meta_version INTEGER NOT NULL DEFAULT 1,
    meta_created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    meta_last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (org_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_groups_org
  ON scim_groups(org_id);

CREATE INDEX IF NOT EXISTS idx_scim_groups_org_external
  ON scim_groups(org_id, external_id);

CREATE INDEX IF NOT EXISTS idx_scim_groups_org_display_name
  ON scim_groups(org_id, display_name);

-- ----------------------------------------------------------------------------
-- 4) SCIM GROUP MEMBERSHIPS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scim_group_memberships (
    group_id UUID NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_user
  ON scim_group_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_org
  ON scim_group_memberships(org_id);

CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_group
  ON scim_group_memberships(group_id);

-- ----------------------------------------------------------------------------
-- 5) PROVIDER-BOUND SAML SESSIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saml_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES organization_sso_providers(id) ON DELETE CASCADE,
    saml_name_id VARCHAR(512) NOT NULL,
    saml_name_id_format VARCHAR(100),
    saml_session_index VARCHAR(255),
    issuer VARCHAR(512) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_lookup
  ON saml_sessions(provider_id, saml_name_id);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_session
  ON saml_sessions(session_id);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_expiry
  ON saml_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_provider_session_index
  ON saml_sessions(provider_id, saml_session_index)
  WHERE saml_session_index IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6) EXTEND EXISTING AUDIT LOGS
-- Existing audit_logs already exists in 001_auth_create_core_schema.up.sql.
-- Extend it for actor-type based enterprise trails rather than recreating it.
-- ----------------------------------------------------------------------------
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20);

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_audit_actor_type_id_time
  ON audit_logs(actor_type, actor_id, created_at DESC)
  WHERE actor_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_time_brin
  ON audit_logs USING BRIN (created_at);

-- ----------------------------------------------------------------------------
-- 7) MODIFY EXISTING SCIM TOKENS TABLE (rotation support)
-- ----------------------------------------------------------------------------
ALTER TABLE organization_scim_tokens
  ADD COLUMN IF NOT EXISTS rotated_from UUID REFERENCES organization_scim_tokens(id),
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scim_tokens_rotated_from
  ON organization_scim_tokens(rotated_from)
  WHERE rotated_from IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scim_tokens_grace_window
  ON organization_scim_tokens(grace_period_ends_at)
  WHERE grace_period_ends_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 8) MODIFY EXISTING USER SESSIONS
-- user_sessions.sso_provider_id already exists in migration 001.
-- Add only the missing provider-type discriminator.
-- ----------------------------------------------------------------------------
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS sso_provider_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_user_sessions_sso_provider
  ON user_sessions(sso_provider_id, sso_provider_type)
  WHERE sso_provider_id IS NOT NULL;

COMMIT;

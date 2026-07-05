-- ============================================================================
-- 006_organizations_create_core_schema.up.sql
-- ----------------------------------------------------------------------------
-- Canonical, idempotent, safe-to-run-on-fresh-DB snapshot of the ORGANIZATION
-- module schema. Consolidates the legacy db/postgres/orgtables.sql into the
-- migrations2 lineage and ADDS two new capabilities the platform needs:
--
--   * organization_email_outbox      â€” durable, retrying email queue for org
--                                       and project emails (mirrors the auth
--                                       module's auth_email_outbox). Drained by
--                                       the org-email worker. No Redis.
--   * organization_alert_thresholds  â€” per-org (optionally per-project) latency
--                                       SLO thresholds (p50..p99), error-rate,
--                                       and apdex gates that decide WHEN an org
--                                       receives a latency alert email. Ships
--                                       with industry-standard defaults.
--
-- It also creates organization_audit_logs, the enterprise audit table the
-- organization repository writes to (the legacy orgtables.sql shipped a
-- mismatched `audit_logs` definition and never created organization_audit_logs,
-- so every org audit write failed â€” fixed here).
--
-- Conventions match the surrounding migrations2 files:
--   * Enums guarded with DO / IF NOT EXISTS so re-runs are no-ops.
--   * CREATE TABLE IF NOT EXISTS + additive ALTERs so running this after the
--     legacy orgtables.sql is harmless.
--   * Partial UNIQUE INDEXes instead of UNIQUE constraints where NULLs matter.
--   * RLS intentionally disabled (tenant isolation is enforced in the service
--     layer; see note at the bottom).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) Extensions + shared updated_at trigger
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1) ENUM types (idempotent)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_status') THEN
    CREATE TYPE org_status AS ENUM ('active','trialing','suspended','locked','archived','delinquent');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE member_status AS ENUM ('invited','active','suspended','removed','locked');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE org_role AS ENUM ('owner','admin','developer','billing','security','member','viewer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
    CREATE TYPE invitation_status AS ENUM ('pending','accepted','declined','revoked','expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'joined_method') THEN
    CREATE TYPE joined_method AS ENUM ('invite','admin_add','sso_auto_provision','scim');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quota_request_status') THEN
    CREATE TYPE quota_request_status AS ENUM ('pending','approved','rejected','cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_event_severity') THEN
    CREATE TYPE security_event_severity AS ENUM ('low','medium','high','critical');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2) ORGANIZATIONS
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_slug_active
  ON organizations(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orgs_owner ON organizations(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orgs_status ON organizations(status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_org_updated_at ON organizations;
CREATE TRIGGER trg_org_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 3) ORGANIZATION SETTINGS (1:1)
-- ----------------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS trg_org_settings_updated_at ON organization_settings;
CREATE TRIGGER trg_org_settings_updated_at BEFORE UPDATE ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) ORGANIZATION MEMBERS
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
    UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_org_members_role ON organization_members(org_id, role) WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_org_members_updated_at ON organization_members;
CREATE TRIGGER trg_org_members_updated_at BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 5) ORGANIZATION INVITATIONS
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_invite
  ON organization_invitations(org_id, email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON organization_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON organization_invitations(org_id, status);

-- ----------------------------------------------------------------------------
-- 6) QUOTA REQUESTS
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

CREATE INDEX IF NOT EXISTS idx_quota_requests_org ON quota_requests(org_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_quota_requests_updated_at ON quota_requests;
CREATE TRIGGER trg_quota_requests_updated_at BEFORE UPDATE ON quota_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 7) ORGANIZATION AUDIT LOGS  (enterprise shape â€” repository writes here)
--    NOTE: distinct from the auth module's audit_logs (different columns).
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_org_audit_org_created ON organization_audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_audit_actor ON organization_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_entity ON organization_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_action ON organization_audit_logs(org_id, action);
CREATE INDEX IF NOT EXISTS idx_org_audit_sensitive ON organization_audit_logs(org_id, is_sensitive) WHERE is_sensitive = TRUE;
CREATE INDEX IF NOT EXISTS idx_org_audit_metadata_gin ON organization_audit_logs USING GIN(metadata);

COMMENT ON TABLE organization_audit_logs IS
  'Append-only enterprise org audit trail. Columns mirror organization/repository.ts createAuditLog().';

-- ----------------------------------------------------------------------------
-- 8) ORGANIZATION ENVIRONMENTS
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
    UNIQUE (org_id, slug)
);

-- ----------------------------------------------------------------------------
-- 9) ORGANIZATION API KEYS
--    (existing simple org-scoped key store â€” retained for the current module.
--     The elaborate scoped key system from the spec is intentionally omitted.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    environment_id UUID REFERENCES organization_environments(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON organization_api_keys(org_id) WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 10) SSO PROVIDERS
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
    oidc_issuer TEXT,
    oidc_client_id TEXT,
    oidc_client_secret_encrypted TEXT,
    oidc_scopes TEXT,
    oidc_jit_provision BOOLEAN NOT NULL DEFAULT FALSE,
    oidc_jit_default_role VARCHAR(50) NOT NULL DEFAULT 'member',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organization_sso_providers
  ADD COLUMN IF NOT EXISTS oidc_issuer TEXT;
ALTER TABLE organization_sso_providers
  ADD COLUMN IF NOT EXISTS oidc_client_id TEXT;
ALTER TABLE organization_sso_providers
  ADD COLUMN IF NOT EXISTS oidc_client_secret_encrypted TEXT;
ALTER TABLE organization_sso_providers
  ADD COLUMN IF NOT EXISTS oidc_scopes TEXT;
ALTER TABLE organization_sso_providers
  ADD COLUMN IF NOT EXISTS oidc_jit_provision BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organization_sso_providers
  ADD COLUMN IF NOT EXISTS oidc_jit_default_role VARCHAR(50) NOT NULL DEFAULT 'member';

CREATE INDEX IF NOT EXISTS idx_sso_providers_org ON organization_sso_providers(org_id);
CREATE INDEX IF NOT EXISTS idx_sso_providers_active_domain_type
  ON organization_sso_providers(provider_type, LOWER(domain))
  WHERE is_active = TRUE AND domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sso_providers_active_entity_id
  ON organization_sso_providers(entity_id)
  WHERE is_active = TRUE AND provider_type = 'saml' AND entity_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 11) SCIM TOKENS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_scim_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scim_tokens_org ON organization_scim_tokens(org_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scim_tokens_org_token_active
  ON organization_scim_tokens(org_id, token_hash)
  WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 12) SCIM USER MAPPINGS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scim_user_mappings (
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, external_id),
    CONSTRAINT scim_user_mappings_org_user_unique UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_user_mappings_user
  ON scim_user_mappings(user_id);

-- ----------------------------------------------------------------------------
-- 13) SECURITY EVENTS
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

CREATE INDEX IF NOT EXISTS idx_org_security_events_org ON organization_security_events(org_id, created_at DESC);

COMMIT;

-- ============================================================================
-- NEW CAPABILITIES (this migration)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 13) ORGANIZATION EMAIL OUTBOX
--     Durable, retrying email queue for organization + project emails
--     (invitations, member lifecycle, quota decisions, security notices, and
--     latency-SLO alert emails). Mirrors the auth module's auth_email_outbox
--     but adds tenant context (org_id / project_id), an email_type tag, a
--     backoff schedule (next_attempt_at), and free-form metadata.
--
--     Drained by src/workers/org-email.processor.ts using
--     FOR UPDATE SKIP LOCKED so multiple worker processes are safe. No Redis.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant context. org_id is required; project_id is optional (project
    -- emails such as per-project latency alerts set it, org-level emails leave
    -- it NULL). ON DELETE CASCADE so a deleted org drops its pending mail.
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID,

    -- Classification, e.g. 'invitation', 'invitation_resend', 'member_added',
    -- 'member_removed', 'quota_decision', 'security_alert', 'latency_alert'.
    email_type VARCHAR(50) NOT NULL DEFAULT 'generic',

    -- Rendered message.
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    html TEXT NOT NULL,
    text TEXT NOT NULL,

    -- Delivery state machine: pending -> sent | failed.
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    -- Exponential backoff schedule. The worker only picks up rows whose
    -- next_attempt_at <= NOW(), so a transient SMTP failure is retried later
    -- rather than hot-looping.
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,

    -- Idempotency / correlation. dedupe_key lets a caller avoid enqueueing the
    -- same logical email twice (e.g. one latency alert per rule per cooldown).
    dedupe_key VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

-- Hot path: the worker scans due, still-retryable pending rows oldest-first.
CREATE INDEX IF NOT EXISTS idx_org_email_outbox_due
  ON organization_email_outbox(next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_email_outbox_org
  ON organization_email_outbox(org_id, created_at DESC);
-- At most one live (pending/sent) message per dedupe_key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_email_outbox_dedupe
  ON organization_email_outbox(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status <> 'failed';

COMMENT ON TABLE organization_email_outbox IS
  'Durable retrying email queue for org/project emails. Drained by org-email worker (no Redis).';

-- ----------------------------------------------------------------------------
-- 14) ORGANIZATION ALERT THRESHOLDS
--     Per-org (optionally per-project) latency/error/apdex SLO thresholds that
--     decide WHEN the org receives an alert email. The org owns the numbers;
--     defaults below are industry-standard starting points for web/API
--     backends (latency in milliseconds):
--
--       p50  300ms   p75  500ms   p90  800ms   p95 1000ms   p99 2000ms
--       error rate   5%          apdex target  0.85
--
--     A NULL project_id row is the org-wide default; a row with project_id
--     overrides it for that project. The alerting evaluator compares observed
--     percentiles against the *_threshold_ms columns and, for each percentile
--     whose *_alert_enabled is TRUE and whose threshold is breached, enqueues a
--     latency_alert email into organization_email_outbox (respecting cooldown).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_alert_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID,

    -- Latency thresholds (milliseconds). Industry-standard defaults.
    p50_threshold_ms INTEGER NOT NULL DEFAULT 300  CHECK (p50_threshold_ms > 0),
    p75_threshold_ms INTEGER NOT NULL DEFAULT 500  CHECK (p75_threshold_ms > 0),
    p90_threshold_ms INTEGER NOT NULL DEFAULT 800  CHECK (p90_threshold_ms > 0),
    p95_threshold_ms INTEGER NOT NULL DEFAULT 1000 CHECK (p95_threshold_ms > 0),
    p99_threshold_ms INTEGER NOT NULL DEFAULT 2000 CHECK (p99_threshold_ms > 0),

    -- Which percentiles actually trigger an email. p95/p99 on by default â€”
    -- they are the standard SLO tail-latency signals.
    p50_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    p75_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    p90_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    p95_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    p99_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    -- Error-rate gate (percentage of failed requests in the window).
    error_rate_threshold_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00
      CHECK (error_rate_threshold_percent >= 0 AND error_rate_threshold_percent <= 100),
    error_rate_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    -- Apdex target (0..1). Off by default; orgs opt in.
    apdex_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.85
      CHECK (apdex_threshold >= 0 AND apdex_threshold <= 1),
    apdex_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    -- Evaluation window + cooldown (minutes). Cooldown bounds email volume.
    evaluation_window_minutes INTEGER NOT NULL DEFAULT 5  CHECK (evaluation_window_minutes >= 1),
    cooldown_minutes INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_minutes >= 0),

    -- Master switch + explicit recipients. Empty notify_emails => fall back to
    -- the org alert/billing/owner email at send time.
    alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    notify_emails TEXT[] NOT NULL DEFAULT '{}',

    -- Last time an alert email fired for this config (cooldown bookkeeping).
    last_alerted_at TIMESTAMPTZ,

    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One config row per (org, project). project_id NULL is coalesced to a
-- sentinel so the org-wide default is a single distinct row (NULL <> NULL
-- would otherwise permit duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_alert_thresholds_scope
  ON organization_alert_thresholds(
    org_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_org_alert_thresholds_org
  ON organization_alert_thresholds(org_id);

DROP TRIGGER IF EXISTS trg_org_alert_thresholds_updated_at ON organization_alert_thresholds;
CREATE TRIGGER trg_org_alert_thresholds_updated_at BEFORE UPDATE ON organization_alert_thresholds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE organization_alert_thresholds IS
  'Per-org/project latency/error/apdex SLO thresholds deciding when latency alert emails fire. Industry-standard defaults.';

COMMIT;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (INTENTIONALLY DISABLED)
-- ----------------------------------------------------------------------------
-- Tenant isolation is enforced in the service layer (every query filters by
-- org_id) and by the requireOrgMembership / requireProjectMembership
-- middleware. This codebase never sets app.current_org_id, so enabling RLS
-- policies here would filter every query to zero rows. See migration 003 for
-- the same rationale and the opt-in path.


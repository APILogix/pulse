-- ============================================================================
-- 008_projects_create_core_schema.up.sql
-- ----------------------------------------------------------------------------
-- Canonical, idempotent, safe-to-run-on-fresh-DB snapshot of the PROJECT
-- module schema (projects + API keys), upgraded to enterprise grade.
--
-- Why this file exists:
--   * The legacy project DDL lived in migrations/011_projects.sql (and earlier
--     in schema3.sql), OUTSIDE the migrations2 lineage. migrations2/007
--     (sdk_config) already REFERENCES projects(id), so projects must exist in
--     this lineage. This migration brings projects + project_api_keys under
--     the migrations2 lineage and ADDS the enterprise columns/tables the
--     module now needs.
--
-- What it adds on top of the legacy shape:
--   * projects                â€” rate-limit config, ingestion config, security
--                               (ip allow/block, geo, https), alerting config,
--                               staging prefix, settings, soft-delete actor.
--   * project_environments    â€” per-environment config overrides (dev/stg/prod).
--   * project_api_keys         â€” key_type, lifecycle status, rotation lineage +
--                               grace period, revoke actor, auto-rotation,
--                               per-key rate-limit overrides, permissions and
--                               endpoint allow/block lists, usage/error counts.
--   * project_api_key_usage    â€” per-key per-day/hour usage analytics rollups.
--
-- Conventions match migrations2/006 and 007:
--   * Enums guarded with DO / IF NOT EXISTS so re-runs are no-ops.
--   * CREATE TABLE IF NOT EXISTS + additive ALTER ... ADD COLUMN IF NOT EXISTS
--     so running this AFTER the legacy migrations/011 only upgrades columns.
--   * Partial UNIQUE INDEXes instead of UNIQUE constraints where NULLs matter.
--   * Reuses the shared set_updated_at() trigger from migration 006.
--   * RLS intentionally disabled (tenant isolation enforced in the service
--     layer; every query filters by org_id + project_id).
--
-- NO Redis. NO ingestion endpoints. API-key resolution for ingestion is served
-- from the in-process LRU cache (config/lrucashe.ts, 30-minute TTL); this
-- schema is the source of truth the cache is warmed from / falls back to.
--
-- Depends on: 006_organizations_create_core_schema (organizations, users).
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
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_status') THEN
    CREATE TYPE project_status AS ENUM ('active','paused','archived');
  END IF;

  -- The application (projects/types.ts) emits only 'development' and
  -- 'production'. 'staging' is included for forward compatibility.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_environment') THEN
    CREATE TYPE project_environment AS ENUM ('development','staging','production');
  END IF;

  -- API-key lifecycle status. Distinct from the boolean is_active flag:
  -- is_active is the fast ingestion gate; status is the full lifecycle.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_status') THEN
    CREATE TYPE api_key_status AS ENUM ('active','revoked','expired','rotated','suspended');
  END IF;

  -- API-key capability class. Controls which permissions a key may hold.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_type') THEN
    CREATE TYPE api_key_type AS ENUM ('standard','read_only','admin','ingestion_only');
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- 2) PROJECTS
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    description TEXT,
    status project_status NOT NULL DEFAULT 'active',
    environment project_environment NOT NULL DEFAULT 'development',

    -- API-key prefixes (public key identification, one per environment).
    production_api_prefix VARCHAR(20),
    development_api_prefix VARCHAR(20),
    staging_api_prefix VARCHAR(20),

    -- Rate-limit configuration (per-project defaults; enforced by ingestion's
    -- in-process LRU rate limiter â€” NOT Redis). Stored here as the source of
    -- truth the ingestion cache is warmed from.
    rate_limit_per_second INTEGER NOT NULL DEFAULT 1000 CHECK (rate_limit_per_second > 0),
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 10000 CHECK (rate_limit_per_minute > 0),
    rate_limit_per_hour INTEGER NOT NULL DEFAULT 100000 CHECK (rate_limit_per_hour > 0),
    burst_limit INTEGER NOT NULL DEFAULT 2000 CHECK (burst_limit > 0),

    -- Ingestion configuration consumed by the (separate) ingestion module.
    allowed_event_types TEXT[] NOT NULL DEFAULT ARRAY['*'],
    blocked_event_types TEXT[] NOT NULL DEFAULT '{}',
    max_event_size_bytes INTEGER NOT NULL DEFAULT 1048576 CHECK (max_event_size_bytes > 0),
    max_batch_size INTEGER NOT NULL DEFAULT 100 CHECK (max_batch_size > 0),
    allowed_origins TEXT[] NOT NULL DEFAULT '{}',

    -- Security posture.
    require_https BOOLEAN NOT NULL DEFAULT TRUE,
    ip_allowlist INET[],
    ip_blocklist INET[],
    geo_restriction_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    allowed_countries CHAR(2)[],

    -- Alert configuration.
    alert_email VARCHAR(255),
    alert_webhook_url VARCHAR(500),
    alert_on_error_rate_threshold NUMERIC(5,2) NOT NULL DEFAULT 5.00
      CHECK (alert_on_error_rate_threshold >= 0 AND alert_on_error_rate_threshold <= 100),
    alert_on_latency_threshold_ms INTEGER NOT NULL DEFAULT 1000 CHECK (alert_on_latency_threshold_ms > 0),

    -- Free-form metadata / settings.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Soft delete + lifecycle timestamps.
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, slug)
);

-- Additive upgrades for databases that already created `projects` via the
-- legacy migrations/011_projects.sql (which had only the base columns).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS staging_api_prefix VARCHAR(20);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rate_limit_per_second INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rate_limit_per_hour INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS burst_limit INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS allowed_event_types TEXT[] NOT NULL DEFAULT ARRAY['*'];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS blocked_event_types TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS max_event_size_bytes INTEGER NOT NULL DEFAULT 1048576;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS max_batch_size INTEGER NOT NULL DEFAULT 100;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS require_https BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ip_allowlist INET[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ip_blocklist INET[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS geo_restriction_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS allowed_countries CHAR(2)[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS alert_email VARCHAR(255);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS alert_webhook_url VARCHAR(500);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS alert_on_error_rate_threshold NUMERIC(5,2) NOT NULL DEFAULT 5.00;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS alert_on_latency_threshold_ms INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_org
  ON projects(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_org_status
  ON projects(org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_active
  ON projects(id, status) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_env
  ON projects(org_id, environment) WHERE deleted_at IS NULL;
-- Stable keyset pagination (created_at, id).
CREATE INDEX IF NOT EXISTS idx_projects_cursor
  ON projects(org_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE projects IS
  'Enterprise project records scoped to an organization. Holds rate-limit, ingestion, security and alert config consumed by the ingestion + alerting modules.';

-- sdk_configs is created in migration 007, before projects exists in this
-- lineage. Attach the project FK here once projects is available.
DO $$
BEGIN
  IF to_regclass('public.sdk_configs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conname = 'fk_sdk_configs_project'
          AND conrelid = 'public.sdk_configs'::regclass
     ) THEN
    ALTER TABLE sdk_configs
      ADD CONSTRAINT fk_sdk_configs_project
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- 3) PROJECT ENVIRONMENTS (per-environment config overrides)
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS project_environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    environment project_environment NOT NULL DEFAULT 'development',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Per-environment rate-limit overrides (NULL => inherit from project).
    rate_limit_per_second INTEGER CHECK (rate_limit_per_second IS NULL OR rate_limit_per_second > 0),
    rate_limit_per_minute INTEGER CHECK (rate_limit_per_minute IS NULL OR rate_limit_per_minute > 0),
    rate_limit_per_hour INTEGER CHECK (rate_limit_per_hour IS NULL OR rate_limit_per_hour > 0),
    burst_limit INTEGER CHECK (burst_limit IS NULL OR burst_limit > 0),

    -- Per-environment ingestion overrides.
    allowed_event_types TEXT[] NOT NULL DEFAULT ARRAY['*'],
    blocked_event_types TEXT[] NOT NULL DEFAULT '{}',
    max_event_size_bytes INTEGER CHECK (max_event_size_bytes IS NULL OR max_event_size_bytes > 0),
    max_batch_size INTEGER CHECK (max_batch_size IS NULL OR max_batch_size > 0),

    require_https BOOLEAN NOT NULL DEFAULT TRUE,
    ip_allowlist INET[],
    ip_blocklist INET[],

    alert_email VARCHAR(255),
    alert_webhook_url VARCHAR(500),

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (project_id, environment)
);

CREATE INDEX IF NOT EXISTS idx_project_envs_project
  ON project_environments(project_id, is_active);
CREATE INDEX IF NOT EXISTS idx_project_envs_org
  ON project_environments(org_id);

DROP TRIGGER IF EXISTS trg_project_envs_updated_at ON project_environments;
CREATE TRIGGER trg_project_envs_updated_at BEFORE UPDATE ON project_environments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE project_environments IS
  'Per-environment config overrides for a project. NULL override columns inherit the project-level value.';

COMMIT;

-- ============================================================================
-- 4) PROJECT API KEYS (enterprise-grade key management)
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS project_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- org_id is denormalized from projects so the ingestion candidate lookup
    -- and org-scoped audit writes never need a second join.
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    environment project_environment NOT NULL DEFAULT 'development',

    -- Key cryptography. The raw key is NEVER stored: only the SHA-256 hex hash
    -- (for constant-time verification) and the public prefix (for candidate
    -- narrowing before the hash compare).
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix VARCHAR(32) NOT NULL,
    key_type api_key_type NOT NULL DEFAULT 'standard',

    -- Identity.
    name VARCHAR(255),
    description TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Lifecycle. is_active is the fast boolean gate; status is the full state.
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    status api_key_status NOT NULL DEFAULT 'active',

    -- Rotation lineage + grace period (old key stays valid until grace ends).
    rotated_from_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
    rotated_at TIMESTAMPTZ,
    rotated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    rotation_reason TEXT,
    grace_period_ends_at TIMESTAMPTZ,

    -- Revocation.
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_reason TEXT,

    -- Expiration + optional auto-rotation policy.
    expires_at TIMESTAMPTZ,
    auto_rotate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    auto_rotate_days INTEGER NOT NULL DEFAULT 90 CHECK (auto_rotate_days > 0),

    -- Usage tracking.
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,
    last_used_user_agent TEXT,
    usage_count BIGINT NOT NULL DEFAULT 0,
    error_count BIGINT NOT NULL DEFAULT 0,

    -- Per-key rate-limit overrides (NULL => inherit from project/environment).
    rate_limit_per_second INTEGER CHECK (rate_limit_per_second IS NULL OR rate_limit_per_second > 0),
    rate_limit_per_minute INTEGER CHECK (rate_limit_per_minute IS NULL OR rate_limit_per_minute > 0),
    rate_limit_per_hour INTEGER CHECK (rate_limit_per_hour IS NULL OR rate_limit_per_hour > 0),

    -- Authorization.
    permissions TEXT[] NOT NULL DEFAULT ARRAY['ingest:write','ingest:read'],
    allowed_endpoints TEXT[] NOT NULL DEFAULT ARRAY['*'],
    blocked_endpoints TEXT[] NOT NULL DEFAULT '{}',

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive upgrades for databases that already created `project_api_keys` via
-- the legacy migrations/011_projects.sql.
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS key_type api_key_type NOT NULL DEFAULT 'standard';
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS status api_key_status NOT NULL DEFAULT 'active';
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS rotated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS rotation_reason TEXT;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS auto_rotate_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS auto_rotate_days INTEGER NOT NULL DEFAULT 90;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS last_used_user_agent TEXT;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS error_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_second INTEGER;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_hour INTEGER;
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT ARRAY['ingest:write','ingest:read'];
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS allowed_endpoints TEXT[] NOT NULL DEFAULT ARRAY['*'];
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS blocked_endpoints TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE project_api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill org_id for any rows created before the column existed.
UPDATE project_api_keys k
   SET org_id = p.org_id
  FROM projects p
 WHERE k.project_id = p.id
   AND k.org_id IS NULL;

-- Primary ingestion auth lookup: narrow active keys by prefix, then the
-- service does a constant-time hash compare against the candidate set.
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix_active
  ON project_api_keys(key_prefix) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_api_keys_project
  ON project_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_project_active
  ON project_api_keys(project_id, is_active, environment) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_api_keys_org
  ON project_api_keys(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_status
  ON project_api_keys(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_type
  ON project_api_keys(key_type, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_expiry
  ON project_api_keys(expires_at) WHERE expires_at IS NOT NULL AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_api_keys_grace
  ON project_api_keys(grace_period_ends_at) WHERE grace_period_ends_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used
  ON project_api_keys(last_used_at) WHERE last_used_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_api_keys_updated_at ON project_api_keys;
CREATE TRIGGER trg_api_keys_updated_at BEFORE UPDATE ON project_api_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE project_api_keys IS
  'Enterprise project API keys. Raw key never stored (SHA-256 hash + prefix only). Supports key types, rotation w/ grace period, auto-rotation, per-key rate limits and permissions.';

COMMIT;

-- ============================================================================
-- 5) PROJECT API KEY USAGE (per-key analytics rollups)
-- ----------------------------------------------------------------------------
-- One row per (key, date, hour). hour = NULL is the daily rollup row. Populated
-- incrementally by the management/analytics path (NOT on the ingestion hot
-- path, which only touches last_used_at). Drives the per-key usage endpoint.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS project_api_key_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    usage_date DATE NOT NULL,
    usage_hour INTEGER CHECK (usage_hour IS NULL OR (usage_hour >= 0 AND usage_hour <= 23)),

    request_count BIGINT NOT NULL DEFAULT 0,
    success_count BIGINT NOT NULL DEFAULT 0,
    error_count BIGINT NOT NULL DEFAULT 0,

    avg_latency_ms NUMERIC(10,2),
    p95_latency_ms NUMERIC(10,2),
    p99_latency_ms NUMERIC(10,2),

    bytes_ingested BIGINT NOT NULL DEFAULT 0,
    events_ingested BIGINT NOT NULL DEFAULT 0,
    events_dropped BIGINT NOT NULL DEFAULT 0,
    rate_limit_hits BIGINT NOT NULL DEFAULT 0,

    endpoint_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    top_ips JSONB NOT NULL DEFAULT '{}'::jsonb,
    top_user_agents JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique per (key, date, hour). hour NULL coalesced to -1 so the daily rollup
-- row is a single distinct row (NULL <> NULL would allow duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_key_usage_period
  ON project_api_key_usage(key_id, usage_date, COALESCE(usage_hour, -1));
CREATE INDEX IF NOT EXISTS idx_api_key_usage_key
  ON project_api_key_usage(key_id, usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_project
  ON project_api_key_usage(project_id, usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_org
  ON project_api_key_usage(org_id, usage_date DESC);

DROP TRIGGER IF EXISTS trg_api_key_usage_updated_at ON project_api_key_usage;
CREATE TRIGGER trg_api_key_usage_updated_at BEFORE UPDATE ON project_api_key_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE project_api_key_usage IS
  'Per-key usage analytics rollups (daily + hourly). Not written on the ingestion hot path.';

COMMIT;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (INTENTIONALLY DISABLED)
-- ----------------------------------------------------------------------------
-- Tenant isolation is enforced in the service layer (every query filters by
-- org_id, and project access is gated by organization membership) and by the
-- authenticate middleware. This codebase never sets app.current_org_id, so
-- enabling RLS here would filter every query to zero rows. See migrations2/006
-- for the same rationale.
--
-- AUDIT: project + API-key lifecycle events are written to
-- organization_audit_logs (created in migrations2/006) via the organization
-- repository â€” projects and API keys are org-owned resources, so they share
-- the organization's enterprise audit trail rather than a separate table.


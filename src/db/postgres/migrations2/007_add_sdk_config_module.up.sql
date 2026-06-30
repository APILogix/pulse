-- ============================================================================
-- 007_add_sdk_config_module.up.sql
-- ----------------------------------------------------------------------------
-- Remote SDK configuration for the organization module: org/project-scoped,
-- auto-versioned config blobs that SDKs fetch at runtime, with immutable
-- version history, rollback, and per-deployment rollout tracking.
--
-- Conventions match migrations2/006:
--   * CREATE TABLE IF NOT EXISTS + additive ALTERs (re-run safe).
--   * Partial UNIQUE INDEXes where NULLs (project_id) matter.
--   * Reuses the shared set_updated_at() trigger from migration 006.
--   * RLS intentionally disabled (tenant isolation enforced in the service
--     layer; every query filters by org_id).
--
-- version_hash is the SHA-256 of the canonical JSON of config_value, computed
-- in the application (sdk-config.service.ts) so clients can validate/ETag.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) SDK CONFIGS (current/latest rows live here; history in *_versions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdk_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

    config_key VARCHAR(255) NOT NULL,
    config_type VARCHAR(50) NOT NULL DEFAULT 'json'
      CHECK (config_type IN ('json','yaml','env','feature_flag')),

    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    version_hash VARCHAR(64) NOT NULL,
    is_latest BOOLEAN NOT NULL DEFAULT TRUE,

    config_value JSONB NOT NULL,
    schema_version VARCHAR(50),

    environment VARCHAR(50) NOT NULL DEFAULT 'all',
    target_sdk_versions VARCHAR(50)[],
    target_platforms VARCHAR(50)[],
    rollout_percentage INTEGER NOT NULL DEFAULT 100
      CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,

    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one "latest" row per (org, project, config_key, environment).
-- project_id NULL is coalesced to a sentinel so an org-wide config is a single
-- distinct scope (NULL <> NULL would otherwise allow duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sdk_configs_latest_scope
  ON sdk_configs(
    org_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    config_key,
    environment
  ) WHERE is_latest = TRUE;

CREATE INDEX IF NOT EXISTS idx_sdk_configs_org ON sdk_configs(org_id, is_active, is_latest);
CREATE INDEX IF NOT EXISTS idx_sdk_configs_project ON sdk_configs(project_id, is_active) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sdk_configs_key ON sdk_configs(config_key, org_id);
CREATE INDEX IF NOT EXISTS idx_sdk_configs_version ON sdk_configs(org_id, config_key, version);

DROP TRIGGER IF EXISTS trg_sdk_configs_updated_at ON sdk_configs;
CREATE TRIGGER trg_sdk_configs_updated_at BEFORE UPDATE ON sdk_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sdk_configs IS
  'Org/project-scoped remote SDK config. One is_latest row per scope; history in sdk_config_versions.';

-- ----------------------------------------------------------------------------
-- 2) SDK CONFIG VERSIONS (immutable history / rollback source)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdk_config_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES sdk_configs(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    version_hash VARCHAR(64) NOT NULL,
    config_value JSONB NOT NULL,
    config_value_encrypted TEXT,
    change_type VARCHAR(20) NOT NULL
      CHECK (change_type IN ('create','update','rollback','delete')),
    change_summary TEXT,
    change_diff JSONB,
    rolled_back_at TIMESTAMPTZ,
    rolled_back_by UUID REFERENCES users(id),
    rolled_back_to_version INTEGER,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (config_id, version)
);

CREATE INDEX IF NOT EXISTS idx_sdk_config_versions_config ON sdk_config_versions(config_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_sdk_config_versions_hash ON sdk_config_versions(version_hash);

COMMENT ON TABLE sdk_config_versions IS
  'Append-only version history for sdk_configs. Each create/update/rollback writes one row.';

-- ----------------------------------------------------------------------------
-- 3) SDK CONFIG DEPLOYMENTS (rollout tracking per version)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdk_config_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES sdk_configs(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','deploying','deployed','failed','rolled_back')),
    rollout_percentage INTEGER NOT NULL DEFAULT 0
      CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    target_count INTEGER,
    reached_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sdk_config_deployments_config ON sdk_config_deployments(config_id, status);

DROP TRIGGER IF EXISTS trg_sdk_config_deployments_updated_at ON sdk_config_deployments;
CREATE TRIGGER trg_sdk_config_deployments_updated_at BEFORE UPDATE ON sdk_config_deployments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sdk_config_deployments IS
  'Rollout/acknowledgement tracking for an sdk_configs version.';

COMMIT;

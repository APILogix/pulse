-- Normalized final definition for project_api_keys.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/005_create_project_api_keys.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/009_converge_project_api_keys.up.sql
-- - canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
-- - canonical_migrations_draft/04_projects/018_normalize_project_api_keys_and_usage.up.sql
-- - canonical_migrations_draft/04_projects/024_update_api_key_public_prefix_constraint.up.sql
-- - migrations/003_project_module_refactor.sql

CREATE TABLE IF NOT EXISTS project_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  status api_key_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  revoked_by UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  public_key VARCHAR(64) NOT NULL UNIQUE,
  secret_hash TEXT,
  key_type api_key_type NOT NULL DEFAULT 'read_write',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rotated_from_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
  rotated_at TIMESTAMPTZ,
  rotated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rotation_reason TEXT,
  rotation_state api_key_rotation_state NOT NULL DEFAULT 'none',
  rotation_version INTEGER NOT NULL DEFAULT 1,
  grace_period_ends_at TIMESTAMPTZ,
  revoked_reason TEXT,
  auto_rotate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_rotate_days INTEGER,
  last_used_ip INET,
  usage_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  rate_limit_per_second INTEGER NOT NULL DEFAULT 0,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 0,
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 0,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_endpoints TEXT[] NOT NULL DEFAULT '{}',
  blocked_endpoints TEXT[] NOT NULL DEFAULT '{}',
  allowed_sdks TEXT[] NOT NULL DEFAULT '{}',
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  allowed_ips INET[] NOT NULL DEFAULT '{}',
  allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  allowed_event_types TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  sampling_rules JSONB NOT NULL DEFAULT '{}',
  feature_flags JSONB NOT NULL DEFAULT '{}',
  sdk_config JSONB NOT NULL DEFAULT '{}'
) WITH (fillfactor = 85);

CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_cleanup
  ON project_api_keys(revoked_at, deleted_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_api_keys_tenant_env ON project_api_keys(organization_id, project_id, environment_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_api_keys_lifecycle ON project_api_keys(status, expires_at, grace_period_ends_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_env
  ON project_api_keys(environment_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_rotation
  ON project_api_keys(rotated_from_key_id)
  WHERE rotated_from_key_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_api_keys_env_active
  ON project_api_keys (project_id, environment_id, status)
  WHERE deleted_at IS NULL;

-- High-performance covering index for gateway authentication lookup
CREATE INDEX IF NOT EXISTS idx_project_api_keys_auth_covering
  ON project_api_keys (public_key)
  INCLUDE (id, project_id, organization_id, environment_id, status, expires_at, secret_hash)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_created_by
  ON project_api_keys(created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_by
  ON project_api_keys(revoked_by)
  WHERE revoked_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_rotated_by
  ON project_api_keys(rotated_by)
  WHERE rotated_by IS NOT NULL;

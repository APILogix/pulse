-- Normalized final definition for connector_configs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/001_create_connector_configs.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/06_connectors/014_link_project_routing.up.sql
-- - migrations/003_project_module_refactor.sql
-- - migrations/004_enterprise_database_integrity.sql

CREATE TABLE IF NOT EXISTS connector_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_setup'
  CHECK (status IN (
  'pending_setup','active','inactive',
  'disabled','expired','revoked',
  'degraded','error','rate_limited'
  )),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  supports_rich_formatting BOOLEAN NOT NULL DEFAULT FALSE,
  supports_threading BOOLEAN NOT NULL DEFAULT FALSE,
  supports_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limit_requests INTEGER NOT NULL DEFAULT 60,
  rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60,
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_backoff_base_ms INTEGER NOT NULL DEFAULT 1000,
  retry_backoff_multiplier NUMERIC(5,2) NOT NULL DEFAULT 2.0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_threshold INTEGER NOT NULL DEFAULT 5,
  last_health_check_at TIMESTAMPTZ,
  last_successful_delivery_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_name_org
ON connector_configs (organization_id, lower(name))
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_org
ON connector_configs (organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_project
ON connector_configs (project_id)
WHERE deleted_at IS NULL AND project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_connector_provider
ON connector_configs (provider)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_status
ON connector_configs (status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_default
ON connector_configs (organization_id, is_default)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_last_health
ON connector_configs (last_health_check_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_last_delivery
ON connector_configs (last_successful_delivery_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_configs_tenant_id
  ON connector_configs(id, organization_id);

CREATE INDEX IF NOT EXISTS idx_connector_configs_org_provider_status
  ON connector_configs (organization_id, provider, status)
  WHERE deleted_at IS NULL;


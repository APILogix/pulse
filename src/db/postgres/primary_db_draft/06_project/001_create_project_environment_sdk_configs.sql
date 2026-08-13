-- Normalized final definition for project_environment_sdk_configs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql

CREATE TABLE IF NOT EXISTS project_environment_sdk_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  published_revision_id UUID NOT NULL,
  current_revision INTEGER NOT NULL,
  current_hash CHAR(64) NOT NULL,
  schema_version VARCHAR(50) NOT NULL DEFAULT '1',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT project_environment_sdk_configs_revision_check CHECK (current_revision > 0),
  CONSTRAINT project_environment_sdk_configs_hash_check CHECK (current_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(environment_id),
  UNIQUE(id, environment_id, project_id, organization_id),
  FOREIGN KEY(project_id, organization_id) REFERENCES projects(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY(environment_id, project_id, organization_id)
  REFERENCES project_environments(id, project_id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_environment_sdk_configs_project
  ON project_environment_sdk_configs(organization_id, project_id, environment_id);

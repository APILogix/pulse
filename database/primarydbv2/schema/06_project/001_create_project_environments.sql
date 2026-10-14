-- Normalized final definition for project_environments.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/007_create_project_environments.up.sql
-- - migrations/003_project_module_refactor.sql
-- - canonical_migrations_draft/04_projects/016_add_environment_runtime_configuration.up.sql
-- - canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql

CREATE TABLE IF NOT EXISTS project_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  color VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  type project_environment_type NOT NULL,
  UNIQUE (project_id, slug),
  UNIQUE (project_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_environments_active_slug
  ON project_environments(project_id, slug) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_environments_default
  ON project_environments(project_id) WHERE is_default AND is_active AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_environments_tenant_id
  ON project_environments(id, project_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_project_environments_org_type
  ON project_environments(organization_id, type) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_environments_project_list
  ON project_environments(project_id, is_active, type, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_environments_active
  ON project_environments(project_id, is_active)
  WHERE deleted_at IS NULL;

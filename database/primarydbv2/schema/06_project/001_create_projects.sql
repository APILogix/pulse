-- Normalized final definition for projects.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/001_create_projects.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/007_create_project_environments.up.sql
-- - canonical_migrations_draft/04_projects/022_add_project_public_id.sql
-- - migrations/003_project_module_refactor.sql
-- - canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  description TEXT,
  status project_status NOT NULL DEFAULT 'active',
  icon VARCHAR(255),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  public_id TEXT NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_status
  ON projects(status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_cursor
  ON projects(org_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_archived
  ON projects(archived_at)
  WHERE archived_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_org_status
  ON projects(org_id, status)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_id_org
  ON projects(id, org_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_active_slug
  ON projects(org_id, lower(slug)) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_public_id ON projects (public_id);

CREATE INDEX IF NOT EXISTS idx_projects_created_by
  ON projects(created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_updated_by
  ON projects(updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_deleted_by
  ON projects(deleted_by)
  WHERE deleted_by IS NOT NULL;

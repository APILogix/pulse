-- Normalized final definition for project_members.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/002_create_project_members.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/008_converge_project_members.up.sql
-- - migrations/003_project_module_refactor.sql

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role project_member_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  status project_member_status NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  removed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  role_id UUID REFERENCES project_roles(id) ON DELETE SET NULL,
  UNIQUE (project_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_members_project_user_unique
  ON project_members(project_id, user_id);

CREATE INDEX IF NOT EXISTS idx_project_members_project
  ON project_members(project_id);

CREATE INDEX IF NOT EXISTS idx_project_members_user
  ON project_members(user_id);

CREATE INDEX IF NOT EXISTS idx_project_members_org_user
  ON project_members(organization_id, user_id);

CREATE INDEX IF NOT EXISTS idx_project_members_role
  ON project_members(project_id, role);

CREATE INDEX IF NOT EXISTS idx_project_members_status
  ON project_members(status);

CREATE INDEX IF NOT EXISTS idx_project_members_active
  ON project_members(project_id, user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_project_members_project_status
  ON project_members(project_id, status);

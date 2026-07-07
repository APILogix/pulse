BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_member_role') THEN
    CREATE TYPE project_member_role AS ENUM ('owner', 'admin', 'developer', 'viewer');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role project_member_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(32) DEFAULT 'active',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
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

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS project_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(project_id, slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_roles_tenant_id ON project_roles(id, project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_project_roles_org_project ON project_roles(organization_id, project_id);
INSERT INTO project_roles (project_id, organization_id, name, slug, description, is_system, is_default, permissions)
SELECT p.id, p.org_id, r.name, r.slug, r.description, true, r.is_default, r.permissions
FROM projects p CROSS JOIN (VALUES
 ('Owner','owner','Full project control',false,'["*"]'::jsonb),
 ('Admin','admin','Project administration',false,'["project:read","project:write","members:manage","alerts:manage"]'::jsonb),
 ('Developer','developer','Develop and ingest',false,'["project:read","events:write","analytics:read"]'::jsonb),
 ('QA','qa','Quality assurance',false,'["project:read","events:write","analytics:read","alerts:read"]'::jsonb),
 ('Viewer','viewer','Read-only project access',true,'["project:read","analytics:read","alerts:read"]'::jsonb)
) AS r(name,slug,description,is_default,permissions)
ON CONFLICT (project_id, slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
  is_system=true, is_default=EXCLUDED.is_default, permissions=EXCLUDED.permissions, updated_at=NOW();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_members' AND column_name='invited_by')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_members' AND column_name='added_by_user_id') THEN
    ALTER TABLE project_members RENAME COLUMN invited_by TO added_by_user_id;
  END IF;
END $$;
ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES project_roles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_members' AND column_name='joined_at') THEN
    EXECUTE 'UPDATE project_members SET added_at=COALESCE(added_at,joined_at)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_members' AND column_name='invited_at') THEN
    EXECUTE 'UPDATE project_members SET added_at=COALESCE(added_at,invited_at)';
  END IF;
  IF (SELECT udt_name <> 'project_member_status' FROM information_schema.columns
      WHERE table_schema='public' AND table_name='project_members' AND column_name='status') THEN
    EXECUTE $sql$UPDATE project_members SET status=CASE WHEN status IN ('pending','active','inactive','removed') THEN status ELSE 'active' END$sql$;
  END IF;
END $$;
UPDATE project_members m SET
  organization_id=p.org_id,
  role_id=r.id,
  added_at=COALESCE(m.added_at,m.created_at,NOW()),
  created_at=COALESCE(m.created_at,NOW()), updated_at=COALESCE(m.updated_at,NOW()), version=COALESCE(m.version,1)
FROM projects p, project_roles r
WHERE p.id=m.project_id AND r.project_id=m.project_id AND r.slug=m.role::text;
DO $$
BEGIN
  IF (SELECT udt_name <> 'project_member_status' FROM information_schema.columns
      WHERE table_schema='public' AND table_name='project_members' AND column_name='status') THEN
    ALTER TABLE project_members ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE project_members ALTER COLUMN status TYPE project_member_status USING status::text::project_member_status;
  END IF;
END $$;
ALTER TABLE project_members
  ALTER COLUMN role_id SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'active', ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN added_at SET DEFAULT NOW(), ALTER COLUMN added_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(), ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(), ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN version SET DEFAULT 1, ALTER COLUMN version SET NOT NULL;
ALTER TABLE project_members
  DROP COLUMN IF EXISTS invited_by,
  DROP COLUMN IF EXISTS invited_at,
  DROP COLUMN IF EXISTS joined_at,
  DROP COLUMN IF EXISTS created_by;
UPDATE project_members SET removed_at=COALESCE(removed_at,updated_at,NOW()) WHERE status='removed' AND removed_at IS NULL;
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_removal_lifecycle_check;
ALTER TABLE project_members ADD CONSTRAINT project_members_removal_lifecycle_check
  CHECK ((status='removed' AND removed_at IS NOT NULL) OR status<>'removed');
CREATE INDEX IF NOT EXISTS idx_project_members_active_project ON project_members(project_id, role) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_project_members_active_user ON project_members(organization_id, user_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS project_member_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invited_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  role project_member_role NOT NULL DEFAULT 'viewer',
  status project_invitation_status NOT NULL DEFAULT 'pending',
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_invitations_token_hash ON project_member_invitations(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_invitations_pending_email ON project_member_invitations(project_id, lower(email)) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_project_invitations_tenant_status ON project_member_invitations(organization_id, project_id, status, expires_at);
COMMENT ON TABLE project_roles IS 'Project-local RBAC roles; five system roles are seeded for every project.';
COMMENT ON COLUMN project_member_invitations.token_hash IS 'One-way hash only; raw invitation tokens are never persisted.';
COMMIT;

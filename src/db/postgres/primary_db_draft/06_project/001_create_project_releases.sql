-- Normalized final definition for project_releases.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/003_create_project_releases.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/007_create_project_environments.up.sql

CREATE TABLE IF NOT EXISTS project_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version VARCHAR(100) NOT NULL,
  commit_sha VARCHAR(64),
  branch VARCHAR(150),
  released_by UUID REFERENCES users(id),
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_releases_project
  ON project_releases(project_id);

CREATE INDEX IF NOT EXISTS idx_project_releases_version
  ON project_releases(project_id, version);

CREATE INDEX IF NOT EXISTS idx_project_releases_time
  ON project_releases(project_id, released_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_releases_commit
  ON project_releases(commit_sha)
  WHERE commit_sha IS NOT NULL;

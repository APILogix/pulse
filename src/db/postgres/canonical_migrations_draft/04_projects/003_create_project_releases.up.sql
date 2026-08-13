BEGIN;

CREATE TABLE IF NOT EXISTS project_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment project_environment NOT NULL,
  version VARCHAR(100) NOT NULL,
  commit_sha VARCHAR(64),
  branch VARCHAR(150),
  released_by UUID REFERENCES users(id),
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_releases' AND column_name = 'environment'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_project_releases_environment ON project_releases(environment);
    CREATE INDEX IF NOT EXISTS idx_project_releases_project_env_time ON project_releases(project_id, environment, released_at DESC);
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_releases' AND column_name = 'environment_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_project_releases_environment_id ON project_releases(environment_id);
    CREATE INDEX IF NOT EXISTS idx_project_releases_project_env_id_time ON project_releases(project_id, environment_id, released_at DESC);
  END IF;
END $$;

COMMIT;

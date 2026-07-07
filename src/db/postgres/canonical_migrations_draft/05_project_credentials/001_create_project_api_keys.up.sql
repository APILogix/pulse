BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_status') THEN
    CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment project_environment NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix VARCHAR(20) NOT NULL,
  scopes TEXT[] DEFAULT '{}',
  status api_key_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  revoked_by UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_project
  ON project_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_org
  ON project_api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
  ON project_api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_status
  ON project_api_keys(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_expiry
  ON project_api_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used
  ON project_api_keys(last_used_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_project_env
  ON project_api_keys(project_id, environment)
  WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_cleanup
  ON project_api_keys(revoked_at, deleted_at)
  WHERE deleted_at IS NULL;

COMMIT;

-- Project API Keys & Rotation Schema
-- File: 06_projects/003_project_api_keys.sql

CREATE TABLE IF NOT EXISTS project_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(32) NOT NULL,
  key_hash VARCHAR(128) UNIQUE NOT NULL,
  type api_key_type NOT NULL DEFAULT 'ingestion',
  status api_key_status NOT NULL DEFAULT 'active',
  environment project_environment NOT NULL DEFAULT 'production',
  allowed_origins TEXT[] DEFAULT '{}'::text[],
  rate_limit_rps INT DEFAULT 1000,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_api_key_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  old_key_hash VARCHAR(128) NOT NULL,
  new_key_hash VARCHAR(128) NOT NULL,
  state api_key_rotation_state NOT NULL DEFAULT 'grace_period',
  grace_period_ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

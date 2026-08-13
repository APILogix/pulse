-- SDK Configurations Schema
-- File: 06_projects/004_sdk_configurations.sql

CREATE TABLE IF NOT EXISTS project_environment_sdk_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_proj_env_sdk UNIQUE (project_id, environment_id)
);

CREATE TABLE IF NOT EXISTS project_environment_sdk_config_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sdk_config_id UUID NOT NULL REFERENCES project_environment_sdk_configs(id) ON DELETE CASCADE,
  revision_number INT NOT NULL,
  config JSONB NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sdk_config_rev UNIQUE (sdk_config_id, revision_number)
);

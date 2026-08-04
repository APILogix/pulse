BEGIN;

CREATE TABLE IF NOT EXISTS environment_sdk_config_lookup (
  environment_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  config_hash TEXT,
  compiled_snapshot JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_environment_sdk_config_lookup_project
  ON environment_sdk_config_lookup(project_id, environment_id);

CREATE INDEX IF NOT EXISTS idx_environment_sdk_config_lookup_org
  ON environment_sdk_config_lookup(organization_id, synced_at DESC);

COMMIT;

-- Normalized final definition for project_environment_sdk_config_revisions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
-- - canonical_migrations_draft/04_projects/019_upgrade_environment_sdk_config_snapshot.up.sql
-- - canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
-- - canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql

CREATE TABLE IF NOT EXISTS project_environment_sdk_config_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES project_environment_sdk_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  requested_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  compiled_snapshot JSONB NOT NULL,
  config_hash CHAR(64) NOT NULL,
  schema_version VARCHAR(50) NOT NULL DEFAULT '1',
  change_type VARCHAR(20) NOT NULL DEFAULT 'publish',
  change_summary TEXT,
  rolled_back_to_revision INTEGER,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_environment_sdk_revisions_number_check CHECK (revision_number > 0),
  CONSTRAINT project_environment_sdk_revisions_hash_check CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sdk_revisions_requested_config_object CHECK (jsonb_typeof(requested_config) = 'object'),
  CONSTRAINT sdk_revisions_compiled_snapshot_object CHECK (jsonb_typeof(compiled_snapshot) = 'object'),
  CONSTRAINT project_environment_sdk_revisions_change_type_check
  CHECK (change_type IN ('initial','publish','rollback')),
  CONSTRAINT project_environment_sdk_revisions_rollback_check CHECK (
  (change_type = 'rollback' AND rolled_back_to_revision IS NOT NULL)
  OR (change_type <> 'rollback' AND rolled_back_to_revision IS NULL)
  ),
  UNIQUE(config_id, revision_number),
  UNIQUE(id, config_id),
  FOREIGN KEY(config_id, environment_id, project_id, organization_id)
  REFERENCES project_environment_sdk_configs(id, environment_id, project_id, organization_id)
  ON DELETE CASCADE,
  FOREIGN KEY(project_id, organization_id) REFERENCES projects(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY(environment_id, project_id, organization_id)
  REFERENCES project_environments(id, project_id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_environment_sdk_revisions_history
  ON project_environment_sdk_config_revisions(config_id, revision_number DESC);

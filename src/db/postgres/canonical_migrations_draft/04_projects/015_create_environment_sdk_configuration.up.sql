BEGIN;

-- One SDK configuration head per project environment. Credentials only select
-- the environment; they never carry or cache an SDK configuration document.
DROP TABLE IF EXISTS project_member_invitations CASCADE;
DROP TABLE IF EXISTS project_roles CASCADE;
DROP VIEW IF EXISTS sdk_config_client_view CASCADE;
DROP TABLE IF EXISTS sdk_config_field_policies CASCADE;
DROP TABLE IF EXISTS sdk_config_templates CASCADE;
DROP TABLE IF EXISTS sdk_config_deployments CASCADE;
DROP TABLE IF EXISTS sdk_config_versions CASCADE;
DROP TABLE IF EXISTS sdk_configs CASCADE;

ALTER TABLE project_api_keys
  DROP COLUMN IF EXISTS sampling_rules,
  DROP COLUMN IF EXISTS feature_flags,
  DROP COLUMN IF EXISTS sdk_config;

CREATE TABLE IF NOT EXISTS project_environment_sdk_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  published_revision_id UUID NOT NULL,
  current_revision INTEGER NOT NULL,
  current_hash CHAR(64) NOT NULL,
  schema_version VARCHAR(50) NOT NULL DEFAULT '1',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT project_environment_sdk_configs_revision_check CHECK (current_revision > 0),
  CONSTRAINT project_environment_sdk_configs_hash_check CHECK (current_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(environment_id),
  UNIQUE(id, environment_id, project_id, organization_id),
  FOREIGN KEY(project_id, organization_id) REFERENCES projects(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY(environment_id, project_id, organization_id)
    REFERENCES project_environments(id, project_id, organization_id) ON DELETE CASCADE
);

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

ALTER TABLE project_environment_sdk_configs
  DROP CONSTRAINT IF EXISTS fk_project_environment_sdk_configs_published_revision;
ALTER TABLE project_environment_sdk_configs
  ADD CONSTRAINT fk_project_environment_sdk_configs_published_revision
  FOREIGN KEY(published_revision_id, id)
  REFERENCES project_environment_sdk_config_revisions(id, config_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_project_environment_sdk_configs_project
  ON project_environment_sdk_configs(organization_id, project_id, environment_id);
CREATE INDEX IF NOT EXISTS idx_project_environment_sdk_revisions_history
  ON project_environment_sdk_config_revisions(config_id, revision_number DESC);

-- Revision 1 is compiled and inserted explicitly by SdkConfigProvisioner in the
-- same application transaction that creates an environment. There is no SQL
-- compiler, placeholder snapshot, or database provisioning trigger.
DROP TRIGGER IF EXISTS trg_project_environments_sdk_config ON project_environments;
DROP FUNCTION IF EXISTS provision_environment_sdk_config();

CREATE OR REPLACE FUNCTION reject_sdk_config_revision_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SDK configuration revisions are immutable' USING ERRCODE='55000';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_environment_sdk_revisions_immutable
  ON project_environment_sdk_config_revisions;
CREATE TRIGGER trg_project_environment_sdk_revisions_immutable
BEFORE UPDATE ON project_environment_sdk_config_revisions
FOR EACH ROW EXECUTE FUNCTION reject_sdk_config_revision_update();

DROP TRIGGER IF EXISTS trg_project_environment_sdk_configs_updated_at
  ON project_environment_sdk_configs;
CREATE TRIGGER trg_project_environment_sdk_configs_updated_at
BEFORE UPDATE ON project_environment_sdk_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE project_environment_sdk_configs IS
  'One SDK configuration head per project environment.';
COMMENT ON TABLE project_environment_sdk_config_revisions IS
  'Append-only editable intent plus the sole complete compiled SDK document.';
COMMENT ON COLUMN project_environment_sdk_config_revisions.requested_config IS
  'Editable allowlisted intent only; never a complete SDK snapshot.';
COMMENT ON COLUMN project_environment_sdk_config_revisions.compiled_snapshot IS
  'The sole authoritative complete immutable schema-v1 SDK document.';
COMMENT ON COLUMN project_api_keys.environment_id IS
  'Authentication scope only; SDK configuration resolves through the selected environment.';

COMMIT;

BEGIN;

-- Remove superseded access and remote-config models when converging an
-- existing database. Fresh installs never create these tables.
DROP TABLE IF EXISTS project_member_invitations CASCADE;
DROP TABLE IF EXISTS project_roles CASCADE;
DROP TABLE IF EXISTS sdk_config_deployments CASCADE;
DROP TABLE IF EXISTS sdk_config_versions CASCADE;
DROP TABLE IF EXISTS sdk_configs CASCADE;

-- Credentials authenticate a client and select an environment. Configuration
-- is owned only by the selected environment.
ALTER TABLE project_api_keys
  DROP COLUMN IF EXISTS sampling_rules,
  DROP COLUMN IF EXISTS feature_flags,
  DROP COLUMN IF EXISTS sdk_config;

CREATE TABLE IF NOT EXISTS project_environment_sdk_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  published_revision_id UUID,
  current_revision INTEGER NOT NULL DEFAULT 0,
  current_hash CHAR(64),
  schema_version VARCHAR(50),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT project_environment_sdk_configs_revision_check CHECK (current_revision >= 0),
  CONSTRAINT project_environment_sdk_configs_hash_check CHECK (
    current_hash IS NULL OR current_hash ~ '^[0-9a-f]{64}$'
  ),
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
  config_value JSONB NOT NULL,
  config_hash CHAR(64) NOT NULL,
  schema_version VARCHAR(50),
  change_type VARCHAR(20) NOT NULL DEFAULT 'publish',
  change_summary TEXT,
  rolled_back_to_revision INTEGER,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_environment_sdk_revisions_number_check CHECK (revision_number > 0),
  CONSTRAINT project_environment_sdk_revisions_hash_check CHECK (config_hash ~ '^[0-9a-f]{64}$'),
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
INSERT INTO project_environment_sdk_configs(
  organization_id, project_id, environment_id, created_by, updated_by
)
SELECT e.organization_id, e.project_id, e.id, NULL, NULL
FROM project_environments e
ON CONFLICT(environment_id) DO NOTHING;

INSERT INTO project_environment_sdk_config_revisions(
  config_id, organization_id, project_id, environment_id, revision_number,
  config_value, config_hash, change_type, change_summary, published_by
)
SELECT h.id, h.organization_id, h.project_id, h.environment_id, 1,
       '{}'::jsonb, encode(digest(('{}'::jsonb)::text, 'sha256'), 'hex'),
       'initial', 'Initial environment SDK configuration', h.created_by
FROM project_environment_sdk_configs h
WHERE h.published_revision_id IS NULL
ON CONFLICT(config_id, revision_number) DO NOTHING;

UPDATE project_environment_sdk_configs h
SET published_revision_id = r.id,
    current_revision = r.revision_number,
    current_hash = r.config_hash,
    updated_at = NOW()
FROM project_environment_sdk_config_revisions r
WHERE r.config_id = h.id
  AND r.revision_number = 1
  AND h.published_revision_id IS NULL;

ALTER TABLE project_environment_sdk_configs
  ALTER COLUMN published_revision_id SET NOT NULL,
  ALTER COLUMN current_hash SET NOT NULL;
ALTER TABLE project_environment_sdk_configs
  DROP CONSTRAINT IF EXISTS project_environment_sdk_configs_revision_check,
  ADD CONSTRAINT project_environment_sdk_configs_revision_check CHECK (current_revision > 0);

CREATE OR REPLACE FUNCTION provision_environment_sdk_config() RETURNS trigger AS $$
DECLARE
  head_id UUID := gen_random_uuid();
  revision_id UUID := gen_random_uuid();
  empty_hash TEXT := encode(digest(('{}'::jsonb)::text, 'sha256'), 'hex');
BEGIN
  INSERT INTO project_environment_sdk_configs(
    id, organization_id, project_id, environment_id, published_revision_id,
    current_revision, current_hash
  ) VALUES(
    head_id, NEW.organization_id, NEW.project_id, NEW.id, revision_id,
    1, empty_hash
  );

  INSERT INTO project_environment_sdk_config_revisions(
    id, config_id, organization_id, project_id, environment_id, revision_number,
    config_value, config_hash, change_type, change_summary
  ) VALUES(
    revision_id, head_id, NEW.organization_id, NEW.project_id, NEW.id, 1,
    '{}'::jsonb, empty_hash, 'initial', 'Initial environment SDK configuration'
  );

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_environments_sdk_config ON project_environments;
CREATE TRIGGER trg_project_environments_sdk_config
AFTER INSERT ON project_environments
FOR EACH ROW EXECUTE FUNCTION provision_environment_sdk_config();

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
  'One SDK configuration head per project environment; API keys only select the environment.';
COMMENT ON TABLE project_environment_sdk_config_revisions IS
  'Immutable publication history for one environment SDK configuration head.';
COMMENT ON COLUMN project_environment_sdk_configs.published_revision_id IS
  'The single revision served identically to every SDK authenticated for this environment.';
COMMENT ON COLUMN project_api_keys.environment_id IS
  'Authentication scope only; SDK configuration is resolved through the referenced environment.';

COMMIT;

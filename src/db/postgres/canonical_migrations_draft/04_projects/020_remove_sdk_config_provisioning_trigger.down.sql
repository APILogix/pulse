-- Restore the pre-refactor database-side SDK configuration provisioning trigger.
-- Excluded from automatic migration discovery by the .down.sql suffix.
--
-- WARNING: Re-enabling this trigger reintroduces database-side business logic.
-- With the application also provisioning SDK configurations inside the service
-- transaction (SdkConfigProvisioner), running both would attempt to insert two
-- heads for one environment and violate UNIQUE(environment_id). Only restore
-- this trigger if the application-side provisioning is disabled first.
BEGIN;

CREATE OR REPLACE FUNCTION provision_environment_sdk_config() RETURNS trigger AS $$
DECLARE
  head_id UUID := gen_random_uuid();
  revision_id UUID := gen_random_uuid();
  v_snapshot JSONB := pulse_build_initial_sdk_config(NEW.project_id, NEW.slug);
  v_hash TEXT := encode(digest(v_snapshot::text, 'sha256'), 'hex');
BEGIN
  INSERT INTO project_environment_sdk_configs(
    id, organization_id, project_id, environment_id, published_revision_id,
    current_revision, current_hash, schema_version
  ) VALUES(
    head_id, NEW.organization_id, NEW.project_id, NEW.id, revision_id,
    1, v_hash, '1'
  );

  INSERT INTO project_environment_sdk_config_revisions(
    id, config_id, organization_id, project_id, environment_id, revision_number,
    requested_config, compiled_snapshot, config_value, config_hash,
    change_type, change_summary
  ) VALUES(
    revision_id, head_id, NEW.organization_id, NEW.project_id, NEW.id, 1,
    '{}'::jsonb, v_snapshot, v_snapshot, v_hash,
    'initial', 'Initial compiled schema-v1 SDK configuration'
  );

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_environments_sdk_config ON project_environments;
CREATE TRIGGER trg_project_environments_sdk_config
AFTER INSERT ON project_environments
FOR EACH ROW EXECUTE FUNCTION provision_environment_sdk_config();

COMMIT;

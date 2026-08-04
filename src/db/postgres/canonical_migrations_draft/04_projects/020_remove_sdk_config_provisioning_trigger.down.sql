-- Intentionally non-restorative breaking downgrade.
--
-- Schema-v1 has one runtime compiler (RemoteSdkConfigService), one complete
-- document column (compiled_snapshot), and application-transaction provisioning.
-- Reintroducing a second snapshot column or a database SDK builder/trigger would violate
-- those invariants and can race SdkConfigProvisioner on UNIQUE(environment_id).
BEGIN;

DROP TRIGGER IF EXISTS trg_project_environments_sdk_config ON project_environments;
DROP FUNCTION IF EXISTS provision_environment_sdk_config();
DROP FUNCTION IF EXISTS pulse_build_initial_sdk_config(uuid,text);

COMMIT;

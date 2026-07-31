BEGIN;

-- SDK revision 1 is provisioned explicitly by SdkConfigProvisioner inside the
-- environment-creation transaction. No database trigger or SQL compiler owns
-- SDK configuration generation.
DROP TRIGGER IF EXISTS trg_project_environments_sdk_config ON project_environments;
DROP FUNCTION IF EXISTS provision_environment_sdk_config();
DROP FUNCTION IF EXISTS pulse_build_initial_sdk_config(UUID, TEXT);

COMMIT;

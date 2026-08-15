-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_api_keys_updated_at ON project_api_keys;
CREATE TRIGGER trg_project_api_keys_updated_at
  BEFORE UPDATE ON project_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_api_keys_version ON project_api_keys;
CREATE TRIGGER trg_project_api_keys_version
  BEFORE UPDATE ON project_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION bump_project_version();

-- Source: canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
DROP TRIGGER IF EXISTS trg_project_environment_sdk_revisions_immutable ON project_environment_sdk_config_revisions;
CREATE TRIGGER trg_project_environment_sdk_revisions_immutable
BEFORE UPDATE ON project_environment_sdk_config_revisions
FOR EACH ROW EXECUTE FUNCTION reject_sdk_config_revision_update();

-- Source: canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
DROP TRIGGER IF EXISTS trg_project_environment_sdk_configs_updated_at ON project_environment_sdk_configs;
CREATE TRIGGER trg_project_environment_sdk_configs_updated_at
BEFORE UPDATE ON project_environment_sdk_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_environments_updated_at ON project_environments;
CREATE TRIGGER trg_project_environments_updated_at
  BEFORE UPDATE ON project_environments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_member_invitations_updated_at ON project_member_invitations;
CREATE TRIGGER trg_project_member_invitations_updated_at
  BEFORE UPDATE ON project_member_invitations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_member_notif_prefs_updated_at ON project_member_notification_preferences;
CREATE TRIGGER trg_project_member_notif_prefs_updated_at
  BEFORE UPDATE ON project_member_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_members_updated_at ON project_members;
CREATE TRIGGER trg_project_members_updated_at
  BEFORE UPDATE ON project_members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_members_version ON project_members;
CREATE TRIGGER trg_project_members_version
  BEFORE UPDATE ON project_members
  FOR EACH ROW
  EXECUTE FUNCTION bump_project_version();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_notif_prefs_updated_at ON project_notification_preferences;
CREATE TRIGGER trg_project_notif_prefs_updated_at
  BEFORE UPDATE ON project_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_roles_updated_at ON project_roles;
CREATE TRIGGER trg_project_roles_updated_at
  BEFORE UPDATE ON project_roles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_project_usage_updated_at ON project_usage;
CREATE TRIGGER trg_project_usage_updated_at
  BEFORE UPDATE ON project_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/04_projects/021_remove_project_defaults_provisioning_trigger.up.sql
-- Project defaults are provisioned explicitly in application transactions.
DROP TRIGGER IF EXISTS trg_projects_provision_defaults ON projects;


-- Source: canonical_migrations_draft/04_projects/022_add_project_public_id.sql
DROP TRIGGER IF EXISTS trg_projects_public_id_immutable ON projects;
CREATE TRIGGER trg_projects_public_id_immutable
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_project_public_id_update();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_projects_version ON projects;
CREATE TRIGGER trg_projects_version
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION bump_project_version();

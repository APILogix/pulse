-- ============================================================================
-- 008_projects_create_core_schema.down.sql
-- Reverses 008_projects_create_core_schema.up.sql. Drops in FK-dependency order.
--
-- NOTE: This drops the project tables entirely. Because migrations2/007
-- (sdk_configs.project_id) references projects(id), those FKs are removed via
-- CASCADE. Enum types are dropped last, guarded so the drop is a no-op if any
-- dependent object still uses them.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS project_api_key_usage CASCADE;
DROP TABLE IF EXISTS project_api_keys CASCADE;
DROP TABLE IF EXISTS project_environments CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_type t ON t.oid = d.refobjid WHERE t.typname = 'api_key_type') THEN
    DROP TYPE IF EXISTS api_key_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_type t ON t.oid = d.refobjid WHERE t.typname = 'api_key_status') THEN
    DROP TYPE IF EXISTS api_key_status;
  END IF;
  -- project_environment / project_status may still be used by other modules
  -- (e.g. sdk_configs.environment is a VARCHAR, not this enum, but be safe).
  IF NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_type t ON t.oid = d.refobjid WHERE t.typname = 'project_environment') THEN
    DROP TYPE IF EXISTS project_environment;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_type t ON t.oid = d.refobjid WHERE t.typname = 'project_status') THEN
    DROP TYPE IF EXISTS project_status;
  END IF;
END $$;

COMMIT;


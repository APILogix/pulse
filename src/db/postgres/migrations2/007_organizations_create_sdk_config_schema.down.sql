-- ============================================================================
-- 007_organizations_create_sdk_config_schema.down.sql
-- Reverses 007_organizations_create_sdk_config_schema.up.sql. Drops in FK-dependency order.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS sdk_config_deployments CASCADE;
DROP TABLE IF EXISTS sdk_config_versions CASCADE;
DROP TABLE IF EXISTS sdk_configs CASCADE;

COMMIT;


-- ============================================================================
-- 007_add_sdk_config_module.down.sql
-- Reverses 007_add_sdk_config_module.up.sql. Drops in FK-dependency order.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS sdk_config_deployments CASCADE;
DROP TABLE IF EXISTS sdk_config_versions CASCADE;
DROP TABLE IF EXISTS sdk_configs CASCADE;

COMMIT;

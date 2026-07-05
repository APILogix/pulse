-- Failed query:
-- -- ============================================================================
-- -- 007_organizations_create_sdk_config_schema.up.sql
-- -- ----------------------------------------------------------------------------
-- -- Enterprise SDK remote-config management schema.
--
-- -- This migration intentionally does not add a foreign key from sdk_configs to
-- -- projects because migrations2/008 creates projects after this file runs. The
-- -- FK is attached from 008 once projects exists.
-- -- ============================================================================
-- -- ============================================================================
-- -- 007_organizations_create_sdk_config_schema.down.sql
-- -- Reverses 007_organizations_create_sdk_config_schema.up.sql. Drops in FK-dependency order.
-- -- ============================================================================
-- 
-- BEGIN;
-- 
-- DROP VIEW IF EXISTS sdk_config_client_view;
DROP TABLE IF EXISTS sdk_config_templates CASCADE;
DROP TABLE IF EXISTS sdk_config_field_policies CAS-- CADE;
DROP TABLE IF EXISTS sdk_config_deployments CASCADE;
DROP TABLE IF EXISTS sdk_config_versions CASCADE;
DROP TABLE IF EXISTS sdk_configs CASCADE;

COMMIT;


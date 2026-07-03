-- ============================================================================
-- 002_connectors_create_notification_schema.down.sql
-- ----------------------------------------------------------------------------
-- Clean rollback of everything created by 002_connectors_create_notification_schema.up.sql.
-- Drops tables in FK-safe order, then the helper function and enum types.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS connector_audit_logs      CASCADE;
DROP TABLE IF EXISTS connector_health_checks   CASCADE;
DROP TABLE IF EXISTS notification_dead_letter   CASCADE;
DROP TABLE IF EXISTS notification_deliveries    CASCADE;
DROP TABLE IF EXISTS notification_routes        CASCADE;
DROP TABLE IF EXISTS notification_templates     CASCADE;
DROP TABLE IF EXISTS connector_secrets          CASCADE;
DROP TABLE IF EXISTS connector_configs          CASCADE;

DROP FUNCTION IF EXISTS connector_set_updated_at() CASCADE;

DROP TYPE IF EXISTS delivery_status;
DROP TYPE IF EXISTS notification_severity;
DROP TYPE IF EXISTS connector_status;
DROP TYPE IF EXISTS connector_type;

COMMIT;


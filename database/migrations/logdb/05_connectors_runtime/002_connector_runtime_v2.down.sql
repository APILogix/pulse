-- =============================================================================
-- Log DB : L6 rollback — typed connector runtime (v2)
--
-- Safe while ALERTING_V2_WRITE is off: the legacy generic tables from
-- 001_connector_runtime.up.sql are untouched by L6 and remain authoritative.
--
-- DESTRUCTIVE for v2 rows only.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS connector_dead_letters;
DROP TABLE IF EXISTS connector_audit_logs_v2;
DROP TABLE IF EXISTS connector_test_runs_v2;
DROP TABLE IF EXISTS connector_health_checks_v2;
DROP TABLE IF EXISTS connector_delivery_attempts_v2;
DROP TABLE IF EXISTS connector_deliveries_v2;

DROP TYPE IF EXISTS connector_delivery_status_v2;

DELETE FROM logdb_migrations
 WHERE filename = '05_connectors_runtime/002_connector_runtime_v2.up.sql';

COMMIT;

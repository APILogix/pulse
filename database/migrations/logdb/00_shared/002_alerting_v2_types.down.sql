-- =============================================================================
-- Log DB : L1 rollback — Alerting v2 runtime enums
--
-- Safe to run only AFTER 05_connectors_runtime/002 and 06_alert_runtime/002 have
-- been rolled back, because those tables depend on these types. DROP TYPE without
-- CASCADE is deliberate: it fails loudly if a dependent table still exists rather
-- than silently destroying runtime data.
-- =============================================================================

BEGIN;

DELETE FROM logdb_schema_notes WHERE subject = 'alerting_v2_runtime';

DROP TYPE IF EXISTS alert_usage_kind;
DROP TYPE IF EXISTS notification_job_status;
DROP TYPE IF EXISTS alert_state;
DROP TYPE IF EXISTS alert_event_kind;
DROP TYPE IF EXISTS notification_channel_kind;

DELETE FROM logdb_migrations WHERE filename = '00_shared/002_alerting_v2_types.up.sql';

COMMIT;

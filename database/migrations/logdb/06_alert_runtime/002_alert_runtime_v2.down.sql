-- =============================================================================
-- Log DB : L3 rollback — typed alert runtime (v2)
--
-- Rollback contract (07-migration-plan.md §8, step 1/3): dropping the v2 tables is
-- safe because the LEGACY generic tables from 001_alert_runtime.up.sql are never
-- modified by L3 and remain authoritative while ALERTING_V2_WRITE is off.
--
-- DESTRUCTIVE for v2 rows only. Do NOT run after the L9 view swap has made v2 the
-- authoritative store — at that point roll back L9 first.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS alert_dead_letter_events_v2;
DROP TABLE IF EXISTS alert_metrics_v2;
DROP TABLE IF EXISTS alert_acknowledgments_v2;
DROP TABLE IF EXISTS alert_delivery_attempts_v2;
DROP TABLE IF EXISTS alert_notification_ledger;
DROP TABLE IF EXISTS alert_notification_jobs;
DROP TABLE IF EXISTS alert_rule_eval_state;
DROP TABLE IF EXISTS alert_event_history_v2;
DROP TABLE IF EXISTS alert_event_state;
DROP TABLE IF EXISTS alert_events_v2;

DELETE FROM logdb_migrations WHERE filename = '06_alert_runtime/002_alert_runtime_v2.up.sql';

COMMIT;

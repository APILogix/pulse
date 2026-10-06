-- Migration: 000006_analytics_engine_rollup_columns.down.sql
-- Database: LogDB v2
-- Description: Rollback Analytics Engine control tables and state

BEGIN;

DROP TABLE IF EXISTS analytics_worker_runs CASCADE;
DROP TABLE IF EXISTS analytics_watermarks CASCADE;
DROP TABLE IF EXISTS anomaly_detections CASCADE;
DROP TABLE IF EXISTS slo_definition_cache CASCADE;
DROP TABLE IF EXISTS release_comparison CASCADE;
DROP TABLE IF EXISTS cron_monitor_state CASCADE;

COMMIT;

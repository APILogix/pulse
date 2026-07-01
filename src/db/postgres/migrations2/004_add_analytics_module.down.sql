-- ============================================================================
-- 004_add_analytics_module.down.sql
-- ----------------------------------------------------------------------------
-- Rollback of 004. DROP TABLE on a TimescaleDB hypertable transparently drops
-- all of its chunks and its compression/retention policies, so no extra
-- TimescaleDB-specific teardown is required here. The timescaledb extension
-- itself is intentionally left installed. update_updated_at_column() is shared
-- and left intact.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS refresh_hourly_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS create_event_partitions(INTEGER);

DROP TABLE IF EXISTS analytics_alerts                CASCADE;
DROP TABLE IF EXISTS analytics_saved_queries         CASCADE;
DROP TABLE IF EXISTS analytics_dashboards            CASCADE;
DROP TABLE IF EXISTS analytics_user_sessions         CASCADE;
DROP TABLE IF EXISTS analytics_performance_summary   CASCADE;
DROP TABLE IF EXISTS analytics_error_groups          CASCADE;
DROP TABLE IF EXISTS analytics_daily_rollup          CASCADE;
DROP TABLE IF EXISTS analytics_hourly_rollup         CASCADE;

DROP TABLE IF EXISTS events_replays                  CASCADE;
DROP TABLE IF EXISTS events_cron_checkins            CASCADE;
DROP TABLE IF EXISTS events_profiles                 CASCADE;
DROP TABLE IF EXISTS events_logs                     CASCADE;
DROP TABLE IF EXISTS events_metrics                  CASCADE;
DROP TABLE IF EXISTS events_traces                   CASCADE;
DROP TABLE IF EXISTS events_spans                    CASCADE;
DROP TABLE IF EXISTS events_requests                 CASCADE;
DROP TABLE IF EXISTS events_messages                 CASCADE;
DROP TABLE IF EXISTS events_errors                   CASCADE;

DROP TYPE IF EXISTS analytics_alert_operator;
DROP TYPE IF EXISTS rollup_granularity;
DROP TYPE IF EXISTS error_group_status;
DROP TYPE IF EXISTS cron_status;
DROP TYPE IF EXISTS log_level;
DROP TYPE IF EXISTS analytics_metric_type;
DROP TYPE IF EXISTS span_kind;
DROP TYPE IF EXISTS span_status;
DROP TYPE IF EXISTS event_severity;

COMMIT;

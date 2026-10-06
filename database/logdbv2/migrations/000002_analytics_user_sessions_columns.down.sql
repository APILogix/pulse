-- Migration Rollback: 000002_analytics_user_sessions_columns.down.sql
-- Database: LogDB v2

ALTER TABLE analytics_user_sessions
  DROP COLUMN IF EXISTS duration_seconds,
  DROP COLUMN IF EXISTS event_count,
  DROP COLUMN IF EXISTS error_count,
  DROP COLUMN IF EXISTS pages,
  DROP COLUMN IF EXISTS created_at;

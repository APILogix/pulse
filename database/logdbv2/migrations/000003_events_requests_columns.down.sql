-- Migration Rollback: 000003_events_requests_columns.down.sql
-- Database: LogDB v2

ALTER TABLE events_requests
  DROP COLUMN IF EXISTS route,
  DROP COLUMN IF EXISTS url,
  DROP COLUMN IF EXISTS latency_ms;

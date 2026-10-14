-- Migration: 000004_events_requests_observability_columns.down.sql
-- Database: LogDB v2
-- Description: Rollback events_requests observability columns and events_traces public_id

BEGIN;

DROP INDEX IF EXISTS idx_events_requests_error_time;
DROP INDEX IF EXISTS idx_events_requests_slow_time;
DROP INDEX IF EXISTS idx_events_traces_pubid;

ALTER TABLE events_requests
  DROP COLUMN IF EXISTS is_error,
  DROP COLUMN IF EXISTS is_slow,
  DROP COLUMN IF EXISTS service,
  DROP COLUMN IF EXISTS framework,
  DROP COLUMN IF EXISTS server_name,
  DROP COLUMN IF EXISTS severity,
  DROP COLUMN IF EXISTS body_size,
  DROP COLUMN IF EXISTS response_size,
  DROP COLUMN IF EXISTS span_count,
  DROP COLUMN IF EXISTS root_span_status,
  DROP COLUMN IF EXISTS is_partial,
  DROP COLUMN IF EXISTS client_ip_hash,
  DROP COLUMN IF EXISTS user_agent,
  DROP COLUMN IF EXISTS referer,
  DROP COLUMN IF EXISTS geo_region,
  DROP COLUMN IF EXISTS geo_asn,
  DROP COLUMN IF EXISTS browser_family,
  DROP COLUMN IF EXISTS browser_version_major,
  DROP COLUMN IF EXISTS os_name,
  DROP COLUMN IF EXISTS os_version_major,
  DROP COLUMN IF EXISTS device_type,
  DROP COLUMN IF EXISTS is_bot;

ALTER TABLE events_traces
  DROP COLUMN IF EXISTS public_id;

COMMIT;

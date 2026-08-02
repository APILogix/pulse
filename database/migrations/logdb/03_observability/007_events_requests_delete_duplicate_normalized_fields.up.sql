BEGIN;

-- Remove duplicate normalized request columns after canonical columns have
-- been backfilled by 006_events_requests_current_schema_update.up.sql.
-- Do not remove payload or metadata.
DROP INDEX IF EXISTS idx_events_requests_route_time;
DROP INDEX IF EXISTS idx_requests_route;

ALTER TABLE events_requests
  DROP COLUMN IF EXISTS is_slow,
  DROP COLUMN IF EXISTS url,
  DROP COLUMN IF EXISTS route,
  DROP COLUMN IF EXISTS latency_ms;


  

ALTER TABLE events_requests
  ADD COLUMN IF NOT EXISTS is_slow BOOLEAN
    GENERATED ALWAYS AS (COALESCE(duration_ms, 0) >= 1000) STORED;

CREATE INDEX IF NOT EXISTS idx_events_requests_endpoint_time
  ON events_requests(organization_id, project_id, endpoint, timestamp DESC);

COMMIT;

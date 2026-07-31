BEGIN;

-- TelemetryWriter.writeMetrics persists request correlation when the SDK
-- includes it. Existing Log DBs that already applied 002_typed_event_runtime
-- need this additive migration because that file cannot be replayed.
ALTER TABLE events_metrics
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_metrics_request_time
  ON events_metrics(organization_id, project_id, request_id, timestamp DESC)
  WHERE request_id IS NOT NULL;

COMMIT;

BEGIN;

ALTER TABLE events_messages
  ADD COLUMN IF NOT EXISTS tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS logger_name TEXT,
  ADD COLUMN IF NOT EXISTS message_category TEXT,
  ADD COLUMN IF NOT EXISTS message_source TEXT;

CREATE INDEX IF NOT EXISTS idx_events_messages_project_severity_time
  ON events_messages(organization_id, project_id, severity, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_events_messages_project_time
  ON events_messages(organization_id, project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_events_messages_project_request
  ON events_messages(organization_id, project_id, request_id, timestamp DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_messages_project_trace
  ON events_messages(organization_id, project_id, trace_id, timestamp DESC)
  WHERE trace_id IS NOT NULL;

COMMIT;

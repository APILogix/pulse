BEGIN;

DROP INDEX IF EXISTS idx_events_messages_project_severity_time;
DROP INDEX IF EXISTS idx_events_messages_project_time;
DROP INDEX IF EXISTS idx_events_messages_project_request;
DROP INDEX IF EXISTS idx_events_messages_project_trace;

ALTER TABLE events_messages
  DROP COLUMN IF EXISTS tenant_id,
  DROP COLUMN IF EXISTS logger_name,
  DROP COLUMN IF EXISTS message_category,
  DROP COLUMN IF EXISTS message_source;

COMMIT;

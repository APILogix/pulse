BEGIN;

ALTER TABLE events_errors
  ADD COLUMN IF NOT EXISTS status_code SMALLINT,
  ADD COLUMN IF NOT EXISTS status_text TEXT,
  ADD COLUMN IF NOT EXISTS handled BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_events_errors_project_status_time
  ON events_errors (
    organization_id,
    project_id,
    status_code,
    occurred_at DESC
  )
  WHERE status_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_project_handled_time
  ON events_errors (
    organization_id,
    project_id,
    handled,
    occurred_at DESC
  )
  WHERE handled IS NOT NULL;

COMMIT;
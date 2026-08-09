BEGIN;

-- Error groups v2: lifecycle state is authoritative in error_groups. Regression
-- is represented by history/outbox events and always reopens the group to OPEN.
ALTER TABLE error_groups
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_release VARCHAR(100),
  ADD COLUMN IF NOT EXISTS fingerprint_version SMALLINT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS latest_event_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS latest_environment VARCHAR(64),
  ADD COLUMN IF NOT EXISTS latest_service VARCHAR(100);

ALTER TABLE events_errors
  ADD COLUMN IF NOT EXISTS fingerprint_version SMALLINT NOT NULL DEFAULT 1;

UPDATE error_groups
   SET status = CASE WHEN UPPER(status) = 'REGRESSED' THEN 'OPEN' ELSE UPPER(status) END,
       is_regression = FALSE,
       updated_at = NOW()
 WHERE status IS NOT NULL;

ALTER TABLE error_groups
  DROP CONSTRAINT IF EXISTS error_groups_status_ck,
  ADD CONSTRAINT error_groups_status_ck
    CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED', 'ARCHIVED'));

ALTER TABLE error_group_history
  ADD COLUMN IF NOT EXISTS previous_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS new_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS event_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS release VARCHAR(100),
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS source_group_id UUID,
  ADD COLUMN IF NOT EXISTS target_group_id UUID;

ALTER TABLE error_group_history
  DROP CONSTRAINT IF EXISTS error_group_history_status_ck,
  ADD CONSTRAINT error_group_history_status_ck CHECK (
    (previous_status IS NULL OR previous_status IN ('OPEN', 'RESOLVED', 'IGNORED', 'ARCHIVED'))
    AND (new_status IS NULL OR new_status IN ('OPEN', 'RESOLVED', 'IGNORED', 'ARCHIVED'))
  );

CREATE INDEX IF NOT EXISTS idx_error_groups_org_project_status_seen_v2
  ON error_groups (organization_id, project_id, status, last_seen_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_project_fingerprint_v2
  ON error_groups (project_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_groups_merged_into_v2
  ON error_groups (project_id, merged_into)
  WHERE merged_into IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_error_groups_resolved_release_v2
  ON error_groups (project_id, resolved_release, resolved_at)
  WHERE status = 'RESOLVED';
CREATE INDEX IF NOT EXISTS idx_error_group_history_group_created_v2
  ON error_group_history (group_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_error_group_history_event_v2
  ON error_group_history (event_id)
  WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_errors_group_time_v2
  ON events_errors (organization_id, project_id, error_group_id, occurred_at DESC)
  WHERE error_group_id IS NOT NULL;

COMMENT ON TABLE error_groups IS
  'Authoritative mutable error-group lifecycle projection. Regression is an event, never a status.';

COMMIT;

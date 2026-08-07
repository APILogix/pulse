BEGIN;

-- Observability query-contract hardening.
-- These indexes support the server-resolved organization/project scope used by
-- the explorer, error-group history, replay, and session read paths.

CREATE INDEX IF NOT EXISTS idx_error_groups_org_project_status_seen
  ON error_groups (organization_id, project_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_groups_org_project_occurrence
  ON error_groups (organization_id, project_id, occurrence_count DESC);

CREATE INDEX IF NOT EXISTS idx_error_group_history_org_group_created
  ON error_group_history (group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_org_project_session_time
  ON events_replays (organization_id, project_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_project_time
  ON analytics_user_sessions (organization_id, project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_project_session_time
  ON analytics_user_sessions (organization_id, project_id, session_id, started_at DESC);

INSERT INTO logdb_schema_notes(subject, decision)
VALUES (
  'observability_query_contract',
  'Observability explorer reads use canonical occurredAt/durationMs/statusCode names, reject client project scope, resolve visible projects server-side, use explicit projections, signed scope-bound cursors, and fail closed when the authorized project set is empty.'
)
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;

-- State tracking for cron monitor heartbeats and missed executions
CREATE TABLE IF NOT EXISTS cron_monitor_state (
  organization_id           UUID NOT NULL,
  project_id                UUID NOT NULL,
  environment               TEXT NOT NULL,
  monitor_slug              TEXT NOT NULL,
  last_status               TEXT,
  last_checkin_at           TIMESTAMPTZ,
  last_duration_ms          NUMERIC(14,3),
  expected_interval_seconds INTEGER,
  consecutive_failures      INTEGER NOT NULL DEFAULT 0,
  checkin_count_total       BIGINT NOT NULL DEFAULT 0,
  is_missing                BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, monitor_slug)
);

CREATE INDEX IF NOT EXISTS idx_cron_monitor_state_missing
  ON cron_monitor_state (organization_id, project_id) WHERE is_missing;

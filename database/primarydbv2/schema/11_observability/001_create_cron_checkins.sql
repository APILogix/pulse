-- Normalized final definition for cron_checkins.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS cron_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  monitor_slug VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL,
  duration_ms DOUBLE PRECISION,
  environment VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_cron_monitor_time ON cron_checkins(project_id, monitor_slug, timestamp DESC);

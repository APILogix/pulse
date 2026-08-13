-- Normalized final definition for logs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  level VARCHAR(16) NOT NULL,
  message TEXT NOT NULL,
  args JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_logs_project_time ON logs(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(project_id, level, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs(project_id, trace_id) WHERE trace_id IS NOT NULL;

-- Normalized final definition for traces.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS traces (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  trace_id VARCHAR(64) NOT NULL,
  root_span JSONB NOT NULL,
  span_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms DOUBLE PRECISION,
  is_partial BOOLEAN NOT NULL DEFAULT FALSE,
  root_name TEXT,
  has_error BOOLEAN NOT NULL DEFAULT FALSE,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_unique ON traces(project_id, trace_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_traces_project_time ON traces(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_traces_errors ON traces(project_id, timestamp DESC) WHERE has_error = TRUE;

-- Normalized final definition for spans.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  trace_id VARCHAR(64) NOT NULL,
  span_id VARCHAR(64) NOT NULL,
  parent_span_id VARCHAR(64),
  name TEXT NOT NULL,
  kind VARCHAR(16),
  status VARCHAR(16),
  status_message TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_ms DOUBLE PRECISION,
  exclusive_duration_ms DOUBLE PRECISION,
  attributes JSONB,
  events JSONB,
  links JSONB,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(project_id, trace_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(project_id, parent_span_id) WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legacy_spans_trace ON spans(project_id, trace_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_legacy_spans_parent ON spans(project_id, parent_span_id) WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_project_time ON spans(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_spans_attrs_gin ON spans USING GIN (attributes);

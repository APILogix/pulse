BEGIN;

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
CREATE TABLE IF NOT EXISTS spans_default PARTITION OF spans DEFAULT;
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(project_id, trace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(project_id, parent_span_id) WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_project_time ON spans(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_attrs_gin ON spans USING GIN (attributes);

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
CREATE TABLE IF NOT EXISTS traces_default PARTITION OF traces DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_unique ON traces(project_id, trace_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_traces_project_time ON traces(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traces_errors ON traces(project_id, timestamp DESC) WHERE has_error = TRUE;

CREATE TABLE IF NOT EXISTS metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  metric_name VARCHAR(255) NOT NULL,
  metric_type VARCHAR(16) NOT NULL,
  value DOUBLE PRECISION,
  unit VARCHAR(32),
  count BIGINT,
  sum DOUBLE PRECISION,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  avg DOUBLE PRECISION,
  buckets JSONB,
  tags JSONB,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS metrics_default PARTITION OF metrics DEFAULT;
CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON metrics(project_id, metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_tags_gin ON metrics USING GIN (tags);

COMMIT;

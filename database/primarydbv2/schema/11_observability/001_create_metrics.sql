-- Normalized final definition for metrics.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

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

CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON metrics(project_id, metric_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_tags_gin ON metrics USING GIN (tags);

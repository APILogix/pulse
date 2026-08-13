-- Normalized final definition for analytics_performance_summary.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_performance_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket_date DATE NOT NULL,
  route VARCHAR(500) NOT NULL,
  method VARCHAR(10),
  p50_latency_ms INTEGER,
  p75_latency_ms INTEGER,
  p90_latency_ms INTEGER,
  p95_latency_ms INTEGER,
  p99_latency_ms INTEGER,
  request_count INTEGER DEFAULT 0,
  rpm NUMERIC,
  error_count INTEGER DEFAULT 0,
  error_rate NUMERIC,
  apdex_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_perf_summary_unique UNIQUE (organization_id, project_id, bucket_date, route, method)
);

CREATE INDEX IF NOT EXISTS idx_perf_summary_org_route
  ON analytics_performance_summary(organization_id, project_id, bucket_date DESC, route);

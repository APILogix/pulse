-- Distributed trace service dependency map edges (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS analytics_trace_service_edges (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  source_service TEXT NOT NULL,
  target_service TEXT NOT NULL,
  call_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  p95_latency_ms NUMERIC(12,3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, source_service, target_service)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS analytics_trace_service_edges_default PARTITION OF analytics_trace_service_edges DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_trace_edges_source
  ON analytics_trace_service_edges (source_service, bucket DESC);

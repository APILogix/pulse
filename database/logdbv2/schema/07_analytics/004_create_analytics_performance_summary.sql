-- Pre-aggregated service endpoint performance summaries (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS analytics_performance_summary (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  call_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  avg_duration_ms NUMERIC(12,3),
  p50_duration_ms NUMERIC(12,3),
  p95_duration_ms NUMERIC(12,3),
  p99_duration_ms NUMERIC(12,3),
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS analytics_performance_summary_default PARTITION OF analytics_performance_summary DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_perf_query
  ON analytics_performance_summary (organization_id, project_id, environment, endpoint, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_perf_brin
  ON analytics_performance_summary USING BRIN (bucket);

BEGIN;

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

DROP TRIGGER IF EXISTS trg_perf_summary_updated_at ON analytics_performance_summary;
CREATE TRIGGER trg_perf_summary_updated_at
  BEFORE UPDATE ON analytics_performance_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;

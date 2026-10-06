-- Pre-aggregated daily metric rollups (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  bucket DATE NOT NULL,
  count BIGINT NOT NULL DEFAULT 0,
  sum NUMERIC(20,6) NOT NULL DEFAULT 0,
  min NUMERIC(20,6),
  max NUMERIC(20,6),
  p50 NUMERIC(20,6),
  p90 NUMERIC(20,6),
  p99 NUMERIC(20,6),
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS analytics_daily_rollup_default PARTITION OF analytics_daily_rollup DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_daily_rollup_query
  ON analytics_daily_rollup (organization_id, project_id, environment, metric_name, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_rollup_brin
  ON analytics_daily_rollup USING BRIN (bucket);

-- Pre-aggregated geo-traffic hourly rollups (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS analytics_geo_hourly_rollup (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  city TEXT,
  bucket TIMESTAMPTZ NOT NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  avg_latency_ms NUMERIC(12,3),
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS analytics_geo_hourly_rollup_default PARTITION OF analytics_geo_hourly_rollup DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_geo_query
  ON analytics_geo_hourly_rollup (organization_id, project_id, environment, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_geo_country
  ON analytics_geo_hourly_rollup (country_code, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_geo_brin
  ON analytics_geo_hourly_rollup USING BRIN (bucket);

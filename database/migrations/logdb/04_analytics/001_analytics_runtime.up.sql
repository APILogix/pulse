BEGIN;

CREATE TABLE IF NOT EXISTS analytics_hourly_rollup (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(20,6) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, metric_name)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS analytics_hourly_rollup_default PARTITION OF analytics_hourly_rollup DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_hourly_dims_gin ON analytics_hourly_rollup USING GIN (dimensions);
CREATE INDEX IF NOT EXISTS idx_analytics_hourly_brin ON analytics_hourly_rollup USING BRIN (bucket);

CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(20,6) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, metric_name)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS analytics_daily_rollup_default PARTITION OF analytics_daily_rollup DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_daily_dims_gin ON analytics_daily_rollup USING GIN (dimensions);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_brin ON analytics_daily_rollup USING BRIN (bucket);

CREATE TABLE IF NOT EXISTS analytics_geo_hourly_rollup (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  country_code CHAR(2) NOT NULL,
  region TEXT,
  city TEXT,
  requests BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  p95_latency_ms NUMERIC(12,3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, country_code, region, city)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS analytics_geo_hourly_rollup_default PARTITION OF analytics_geo_hourly_rollup DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_geo_tenant_env_time ON analytics_geo_hourly_rollup(organization_id,project_id,environment,bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_geo_country_time ON analytics_geo_hourly_rollup(country_code, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_geo_brin ON analytics_geo_hourly_rollup USING BRIN (bucket);

CREATE TABLE IF NOT EXISTS analytics_error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unresolved',
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  occurrence_count BIGINT NOT NULL DEFAULT 0,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_last_seen ON analytics_error_groups(organization_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_attrs_gin ON analytics_error_groups USING GIN (attributes);
DROP TRIGGER IF EXISTS trg_analytics_error_groups_updated_at ON analytics_error_groups;
CREATE TRIGGER trg_analytics_error_groups_updated_at BEFORE UPDATE ON analytics_error_groups FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS analytics_performance_summary (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  service TEXT NOT NULL,
  endpoint TEXT,
  request_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  p50_latency_ms NUMERIC(12,3),
  p95_latency_ms NUMERIC(12,3),
  p99_latency_ms NUMERIC(12,3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, service, endpoint)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS analytics_performance_summary_default PARTITION OF analytics_performance_summary DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_perf_service_time ON analytics_performance_summary(service, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_perf_brin ON analytics_performance_summary USING BRIN (bucket);

CREATE TABLE IF NOT EXISTS analytics_user_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms BIGINT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);
CREATE TABLE IF NOT EXISTS analytics_user_sessions_default PARTITION OF analytics_user_sessions DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_time ON analytics_user_sessions(organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user ON analytics_user_sessions(organization_id, user_id, started_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_attrs_gin ON analytics_user_sessions USING GIN (attributes);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'analytics_endpoint_minute','analytics_endpoint_hourly','analytics_endpoint_daily',
    'analytics_service_minute','analytics_service_hourly','analytics_service_daily',
    'analytics_trace_latency','analytics_error_occurrences','analytics_error_regressions'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        organization_id UUID NOT NULL,
        project_id UUID,
        environment TEXT NOT NULL,
        bucket TIMESTAMPTZ NOT NULL,
        entity_key TEXT NOT NULL,
        total_count BIGINT NOT NULL DEFAULT 0,
        error_count BIGINT NOT NULL DEFAULT 0,
        latency_ms_p95 NUMERIC(12,3),
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (organization_id, project_id, environment, bucket, entity_key)
      ) PARTITION BY RANGE (bucket)
    $sql$, table_name);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (entity_key, bucket DESC)', 'idx_' || table_name || '_entity_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (attributes)', 'idx_' || table_name || '_attrs_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (bucket)', 'idx_' || table_name || '_bucket_brin', table_name);
  END LOOP;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_analytics_trace_edges_source ON analytics_trace_service_edges(source_service, bucket DESC);

COMMIT;

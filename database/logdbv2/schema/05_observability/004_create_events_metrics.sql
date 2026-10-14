-- Canonical metric telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_metrics (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  metric_name TEXT,
  metric_type TEXT,
  metric_unit TEXT,
  metric_namespace TEXT,
  metric_description TEXT,
  metric_value NUMERIC(20,6),
  metric_count BIGINT,
  metric_sum NUMERIC(20,6),
  metric_min NUMERIC(20,6),
  metric_max NUMERIC(20,6),
  value NUMERIC(20,6),
  count BIGINT,
  sum NUMERIC(20,6),
  min NUMERIC(20,6),
  max NUMERIC(20,6),
  avg NUMERIC(20,6),
  rate NUMERIC(20,6),
  buckets JSONB,
  p50 NUMERIC(20,6),
  p75 NUMERIC(20,6),
  p90 NUMERIC(20,6),
  p95 NUMERIC(20,6),
  p99 NUMERIC(20,6),
  metric_category TEXT,
  aggregation_type TEXT,
  temporality TEXT,
  is_monotonic BOOLEAN,
  endpoint TEXT,
  http_method TEXT,
  status_code INTEGER,
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  name TEXT,
  duration_ms NUMERIC(14,3),
  message TEXT,
  severity TEXT DEFAULT 'info',
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_metrics_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_metrics_default PARTITION OF events_metrics DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_metrics_event_unique
  ON events_metrics (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_metrics_org_project_time
  ON events_metrics (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_org_env_time
  ON events_metrics (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_env_time
  ON events_metrics (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_org_time
  ON events_metrics (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_org_env_direct_time
  ON events_metrics (organization_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_pubid
  ON events_metrics (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_metrics_name
  ON events_metrics (organization_id, project_id, metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_name_time
  ON events_metrics (organization_id, project_id, metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_category
  ON events_metrics (organization_id, project_id, metric_category, occurred_at DESC)
  WHERE metric_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_type
  ON events_metrics (organization_id, project_id, metric_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_trace
  ON events_metrics (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_span
  ON events_metrics (organization_id, span_id, occurred_at DESC)
  WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_parent_span
  ON events_metrics (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_request
  ON events_metrics (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_session
  ON events_metrics (organization_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_user
  ON events_metrics (organization_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant
  ON events_metrics (organization_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_release_time
  ON events_metrics (organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_occurred_brin
  ON events_metrics USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_metrics_watermark
  ON events_metrics (organization_id, project_id, environment, ingested_at);

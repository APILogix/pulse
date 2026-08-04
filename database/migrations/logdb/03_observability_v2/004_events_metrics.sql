BEGIN;

-- Canonical metric telemetry.
-- Range-partitioned by occurred_at for retention pruning and time-series rollups.
CREATE TABLE IF NOT EXISTS events_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,

  -- Identity & correlation
  event_id TEXT NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,

  -- Metric identity
  metric_name TEXT,
  metric_type TEXT,
  metric_unit TEXT,
  metric_namespace TEXT,
  metric_description TEXT,
  metric_category TEXT,
  aggregation_type TEXT,
  temporality TEXT,
  is_monotonic BOOLEAN,

  -- Numeric aggregates
  value DOUBLE PRECISION,
  count DOUBLE PRECISION,
  sum DOUBLE PRECISION,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  avg DOUBLE PRECISION,
  rate DOUBLE PRECISION,
  buckets JSONB,
  p50 DOUBLE PRECISION,
  p75 DOUBLE PRECISION,
  p90 DOUBLE PRECISION,
  p95 DOUBLE PRECISION,
  p99 DOUBLE PRECISION,

  -- HTTP context (promoted from tags)
  endpoint TEXT,
  http_method TEXT,
  status_code INTEGER,

  -- SDK / service context
  service TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  application_name TEXT,
  application_version TEXT,
  server_name TEXT,
  severity logdb_severity,
  message TEXT,
  name TEXT,
  duration_ms NUMERIC(14,3),

  -- Flexible storage
  tags JSONB,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,

  -- Timekeeping
  timestamp TIMESTAMPTZ NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_metrics_default PARTITION OF events_metrics DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_metrics_event_unique
  ON events_metrics (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_time
  ON events_metrics (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_env_time
  ON events_metrics (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_project_env_time
  ON events_metrics (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_project_metric_time
  ON events_metrics (project_id, metric_name, occurred_at DESC);

-- Trace / service joins
CREATE INDEX IF NOT EXISTS idx_events_metrics_trace
  ON events_metrics (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_service
  ON events_metrics (service, occurred_at DESC)
  WHERE service IS NOT NULL;

-- Metric-specific filters
CREATE INDEX IF NOT EXISTS idx_events_metrics_name_time
  ON events_metrics (organization_id, project_id, metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_name_occurred
  ON events_metrics (metric_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_metric_type_time
  ON events_metrics (organization_id, project_id, metric_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_request_time
  ON events_metrics (organization_id, project_id, request_id, timestamp DESC)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_endpoint_time
  ON events_metrics (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_http_method_time
  ON events_metrics (organization_id, project_id, http_method, occurred_at DESC)
  WHERE http_method IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_id_time
  ON events_metrics (organization_id, project_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_category_time
  ON events_metrics (organization_id, project_id, metric_category, occurred_at DESC)
  WHERE metric_category IS NOT NULL;

-- JSONB search
CREATE INDEX IF NOT EXISTS idx_events_metrics_attributes_gin
  ON events_metrics USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_events_metrics_metadata_gin
  ON events_metrics USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_events_metrics_payload_gin
  ON events_metrics USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_metrics_ai_response_gin
  ON events_metrics USING GIN (ai_response);

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_metrics_occurred_brin
  ON events_metrics USING BRIN (occurred_at);

-- Controlled vocabularies
ALTER TABLE events_metrics
  DROP CONSTRAINT IF EXISTS events_metrics_metric_category_ck,
  ADD CONSTRAINT events_metrics_metric_category_ck
    CHECK (metric_category IS NULL OR metric_category IN (
      'http', 'database', 'cache', 'queue', 'runtime', 'system', 'business', 'application',
      'network', 'memory', 'cpu', 'disk', 'custom'
    )),
  DROP CONSTRAINT IF EXISTS events_metrics_aggregation_type_ck,
  ADD CONSTRAINT events_metrics_aggregation_type_ck
    CHECK (aggregation_type IS NULL OR aggregation_type IN (
      'counter', 'gauge', 'histogram', 'summary',
      'observable_counter', 'observable_gauge', 'up_down_counter'
    )),
  DROP CONSTRAINT IF EXISTS events_metrics_temporality_ck,
  ADD CONSTRAINT events_metrics_temporality_ck
    CHECK (temporality IS NULL OR temporality IN ('delta', 'cumulative', 'unspecified'));

COMMIT;

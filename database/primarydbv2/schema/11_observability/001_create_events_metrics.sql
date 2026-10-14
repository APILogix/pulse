-- Normalized final definition for events_metrics.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id UUID NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  metric_type VARCHAR(50) NOT NULL,
  metric_unit VARCHAR(50),
  metric_namespace VARCHAR(255),
  metric_description TEXT,
  value DOUBLE PRECISION,
  unit VARCHAR(50),
  tags JSONB NOT NULL DEFAULT '{}',
  attributes JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  payload JSONB NOT NULL DEFAULT '{}',
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
  metric_category VARCHAR(50),
  aggregation_type VARCHAR(50),
  temporality VARCHAR(32),
  is_monotonic BOOLEAN,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  tenant_id VARCHAR(255),
  endpoint VARCHAR(500),
  http_method VARCHAR(10),
  status_code INTEGER,
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  application_name VARCHAR(100),
  application_version VARCHAR(50),
  server_name VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ai_response JSONB,
  CONSTRAINT events_metrics_metric_category_ck CHECK (metric_category IS NULL OR metric_category IN ('http','database','cache','queue','runtime','system','business','application','network','memory','cpu','disk','custom')),
  CONSTRAINT events_metrics_aggregation_type_ck CHECK (aggregation_type IS NULL OR aggregation_type IN ('counter','gauge','histogram','summary','observable_counter','observable_gauge','up_down_counter')),
  CONSTRAINT events_metrics_temporality_ck CHECK (temporality IS NULL OR temporality IN ('delta','cumulative','unspecified')),
  CONSTRAINT events_metrics_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_metrics_org_name_time
  ON events_metrics(organization_id, metric_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_project_metric_time
  ON events_metrics(project_id, metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_project_env_time
  ON events_metrics(project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_name_occurred
  ON events_metrics(metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_endpoint_time
  ON events_metrics(organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_http_method_time
  ON events_metrics(organization_id, project_id, http_method, occurred_at DESC)
  WHERE http_method IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metrics_tags
  ON events_metrics USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_events_metrics_attributes_gin
  ON events_metrics USING GIN (attributes);

CREATE INDEX IF NOT EXISTS idx_metrics_brin_time
  ON events_metrics USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_metrics_project_event
  ON events_metrics(project_id, event_id) NULLS NOT DISTINCT;

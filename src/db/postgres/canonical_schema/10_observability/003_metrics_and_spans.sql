-- Observability Metrics & Spans Schema
-- File: 10_observability/003_metrics_and_spans.sql

CREATE TABLE IF NOT EXISTS events_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric_name VARCHAR(128) NOT NULL,
  value NUMERIC NOT NULL,
  unit VARCHAR(32),
  tags JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trace_id VARCHAR(128) NOT NULL,
  span_id VARCHAR(128) NOT NULL,
  parent_span_id VARCHAR(128),
  name VARCHAR(255) NOT NULL,
  kind VARCHAR(32) DEFAULT 'internal',
  duration_ms NUMERIC(10,3) NOT NULL,
  status_code VARCHAR(32) DEFAULT 'ok',
  attributes JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

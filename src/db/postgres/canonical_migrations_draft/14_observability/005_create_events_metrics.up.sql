BEGIN;

CREATE TABLE IF NOT EXISTS events_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  metric_type analytics_metric_type NOT NULL,
  value NUMERIC NOT NULL,
  unit VARCHAR(50),
  tags JSONB DEFAULT '{}',
  count INTEGER,
  sum NUMERIC,
  min NUMERIC,
  max NUMERIC,
  buckets JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_metrics_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_metrics_org_name_time
  ON events_metrics(organization_id, metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_tags
  ON events_metrics USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_metrics_brin_time
  ON events_metrics USING BRIN (created_at);

COMMIT;

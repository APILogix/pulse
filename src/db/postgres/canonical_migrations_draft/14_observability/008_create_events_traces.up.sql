BEGIN;

CREATE TABLE IF NOT EXISTS events_traces (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  trace_id VARCHAR(64) NOT NULL,
  root_span_name VARCHAR(500),
  root_span_id VARCHAR(64),
  span_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,
  is_partial BOOLEAN DEFAULT FALSE,
  spans_tree JSONB,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id VARCHAR(255),
  tenant_id VARCHAR(255),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_traces_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_traces_org_time
  ON events_traces(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traces_trace_id
  ON events_traces(organization_id, trace_id);
CREATE INDEX IF NOT EXISTS idx_traces_brin_time
  ON events_traces USING BRIN (created_at);

COMMIT;

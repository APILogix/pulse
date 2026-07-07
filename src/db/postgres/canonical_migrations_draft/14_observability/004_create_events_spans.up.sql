BEGIN;

CREATE TABLE IF NOT EXISTS events_spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  span_id VARCHAR(64) NOT NULL,
  trace_id VARCHAR(64) NOT NULL,
  parent_span_id VARCHAR(64),
  name VARCHAR(500) NOT NULL,
  kind span_kind,
  status span_status NOT NULL DEFAULT 'unset',
  status_message TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_ms INTEGER,
  exclusive_duration_ms INTEGER,
  attributes JSONB DEFAULT '{}',
  events JSONB,
  links JSONB,
  db_system VARCHAR(50),
  db_name VARCHAR(100),
  db_operation VARCHAR(50),
  db_collection VARCHAR(100),
  db_statement TEXT,
  http_method VARCHAR(10),
  http_url TEXT,
  http_status_code INTEGER,
  http_host VARCHAR(255),
  http_route VARCHAR(500),
  messaging_system VARCHAR(50),
  messaging_destination VARCHAR(255),
  messaging_operation VARCHAR(50),
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
  CONSTRAINT events_spans_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_spans_org_time
  ON events_spans(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace
  ON events_spans(organization_id, trace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_name
  ON events_spans(organization_id, name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_db
  ON events_spans(organization_id, db_system, timestamp DESC)
  WHERE db_system IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_http
  ON events_spans(organization_id, http_route, timestamp DESC)
  WHERE http_route IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_parent
  ON events_spans(parent_span_id)
  WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_brin_time
  ON events_spans USING BRIN (created_at);

COMMIT;

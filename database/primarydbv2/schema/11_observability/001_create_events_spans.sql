-- Normalized final definition for events_spans.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  span_id VARCHAR(64) NOT NULL,
  trace_id VARCHAR(64) NOT NULL,
  parent_span_id VARCHAR(64),
  name VARCHAR(500) NOT NULL,
  span_kind TEXT,
  span_type TEXT,
  span_status TEXT,
  message TEXT,
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

CREATE INDEX IF NOT EXISTS idx_spans_name
  ON events_spans(organization_id, name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_spans_db
  ON events_spans(organization_id, db_system, timestamp DESC)
  WHERE db_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_http
  ON events_spans(organization_id, http_route, timestamp DESC)
  WHERE http_route IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_brin_time
  ON events_spans USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_spans_project_event
  ON events_spans(project_id, event_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_spans_trace_time_asc
  ON events_spans(organization_id, trace_id, timestamp ASC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_span_id
  ON events_spans(organization_id, span_id)
  WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_slow_db
  ON events_spans(organization_id, db_system, duration_ms DESC, timestamp DESC)
  WHERE db_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_db_collection
  ON events_spans(organization_id, db_collection, timestamp DESC)
  WHERE db_collection IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_session_time
  ON events_spans(organization_id, session_id, timestamp DESC)
  WHERE session_id IS NOT NULL;

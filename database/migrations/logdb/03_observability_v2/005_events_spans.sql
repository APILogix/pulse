BEGIN;

-- Canonical span telemetry.
-- Range-partitioned by occurred_at; each row is one span within a trace.
CREATE TABLE IF NOT EXISTS events_spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_id UUID,

  -- Identity & correlation
  event_id TEXT NOT NULL,
  span_id TEXT,
  trace_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  request_id TEXT,

  -- Span identity
  span_kind TEXT,
  span_type TEXT,
  span_status TEXT,
  is_root_span BOOLEAN,
  is_http_span BOOLEAN,
  is_db_span BOOLEAN,
  is_cache_span BOOLEAN,
  is_messaging_span BOOLEAN,
  name TEXT,
  message TEXT,
  endpoint TEXT,
  depth INTEGER,

  -- Timelines
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms NUMERIC(14,3),
  exclusive_duration_ms NUMERIC(14,3),
  status_code INTEGER,

  -- HTTP context
  http_method TEXT,
  http_route TEXT,
  http_url TEXT,
  http_target TEXT,
  http_host TEXT,
  http_scheme TEXT,
  http_flavor TEXT,
  http_status_code INTEGER,
  http_status_text TEXT,
  http_response_size BIGINT,
  http_user_agent TEXT,
  client_ip_hash TEXT,

  -- Network context
  net_transport TEXT,
  net_host_name TEXT,
  net_host_ip TEXT,
  net_host_port INTEGER,
  net_peer_ip TEXT,
  net_peer_port INTEGER,

  -- Database context
  db_system TEXT,
  db_name TEXT,
  db_operation TEXT,
  db_collection TEXT,
  db_statement TEXT,

  -- Messaging context
  messaging_system TEXT,
  messaging_destination TEXT,
  messaging_operation TEXT,

  -- Events / links arrays
  events JSONB,
  links JSONB,

  -- SDK / service context
  service TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  application_name TEXT,
  application_version TEXT,
  server_name TEXT,
  severity logdb_severity,

  -- Flexible storage
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

CREATE TABLE IF NOT EXISTS events_spans_default PARTITION OF events_spans DEFAULT;

-- Unique event guard (event_id is composite for spans: event_id + span_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_spans_event_unique
  ON events_spans (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_spans_tenant_time
  ON events_spans (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_spans_tenant_env_time
  ON events_spans (organization_id, project_id, environment, occurred_at DESC);

-- Trace hierarchy
CREATE INDEX IF NOT EXISTS idx_events_spans_trace_time
  ON events_spans (organization_id, project_id, trace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_spans_span_id
  ON events_spans (organization_id, project_id, span_id)
  WHERE span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_parent_time
  ON events_spans (organization_id, project_id, trace_id, parent_span_id, start_time)
  WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_depth
  ON events_spans (organization_id, project_id, trace_id, depth)
  WHERE depth IS NOT NULL;

-- Request / endpoint / type filters
CREATE INDEX IF NOT EXISTS idx_events_spans_request_time
  ON events_spans (organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_endpoint_time
  ON events_spans (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_type_time
  ON events_spans (organization_id, project_id, span_type, occurred_at DESC)
  WHERE span_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_span_kind_time
  ON events_spans (organization_id, project_id, span_kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_spans_http_method_time
  ON events_spans (organization_id, project_id, http_method, occurred_at DESC)
  WHERE http_method IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_http_status_time
  ON events_spans (organization_id, project_id, http_status_code, occurred_at DESC)
  WHERE http_status_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_db_system_time
  ON events_spans (organization_id, project_id, db_system, occurred_at DESC)
  WHERE db_system IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_tenant_id_time
  ON events_spans (organization_id, project_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

-- JSONB search
CREATE INDEX IF NOT EXISTS idx_events_spans_attributes_gin
  ON events_spans USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_events_spans_metadata_gin
  ON events_spans USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_events_spans_payload_gin
  ON events_spans USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_spans_ai_response_gin
  ON events_spans USING GIN (ai_response);

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_spans_occurred_brin
  ON events_spans USING BRIN (occurred_at);

COMMIT;

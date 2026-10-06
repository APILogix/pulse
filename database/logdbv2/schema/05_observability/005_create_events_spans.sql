-- Canonical span telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  request_id TEXT,
  span_kind TEXT,
  span_type TEXT,
  span_status TEXT,
  is_root_span BOOLEAN DEFAULT FALSE,
  is_http_span BOOLEAN DEFAULT FALSE,
  is_db_span BOOLEAN DEFAULT FALSE,
  is_cache_span BOOLEAN DEFAULT FALSE,
  is_messaging_span BOOLEAN DEFAULT FALSE,
  name TEXT,
  message TEXT,
  endpoint TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms NUMERIC(12,3),
  exclusive_duration_ms NUMERIC(14,3),
  depth INTEGER DEFAULT 0,
  severity TEXT DEFAULT 'info',
  status_code INTEGER,
  status_message TEXT,
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  db_system TEXT,
  db_name TEXT,
  db_statement TEXT,
  db_operation TEXT,
  db_collection TEXT,
  http_method TEXT,
  http_route TEXT,
  http_url TEXT,
  http_target TEXT,
  http_status_code INTEGER,
  http_status_text TEXT,
  http_response_size BIGINT,
  http_user_agent TEXT,
  http_host TEXT,
  http_scheme TEXT,
  http_flavor TEXT,
  client_ip_hash TEXT,
  net_transport TEXT,
  net_host_name TEXT,
  net_host_ip TEXT,
  net_host_port INTEGER,
  net_peer_ip TEXT,
  net_peer_port INTEGER,
  messaging_system TEXT,
  messaging_destination TEXT,
  messaging_operation TEXT,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_spans_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_spans_default PARTITION OF events_spans DEFAULT;

-- Hot-Path High Performance Indexes
CREATE INDEX IF NOT EXISTS idx_events_spans_org_trace_time_asc
  ON events_spans (organization_id, trace_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_span_id
  ON events_spans (organization_id, span_id);

CREATE INDEX IF NOT EXISTS idx_events_spans_slow_db
  ON events_spans (organization_id, project_id, environment, db_system, duration_ms DESC)
  WHERE db_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_db_collection
  ON events_spans (organization_id, project_id, environment, db_collection, occurred_at DESC)
  WHERE db_collection IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_org_session_time
  ON events_spans (organization_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

-- Standard Query Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_spans_event_unique
  ON events_spans (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_project_time
  ON events_spans (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_env_time
  ON events_spans (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_time
  ON events_spans (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_env_direct_time
  ON events_spans (organization_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_request_time
  ON events_spans (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_pubid
  ON events_spans (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_spans_span
  ON events_spans (organization_id, span_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_parent_span
  ON events_spans (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_request
  ON events_spans (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_session
  ON events_spans (organization_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_user
  ON events_spans (organization_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_tenant
  ON events_spans (organization_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_kind
  ON events_spans (organization_id, project_id, span_kind, occurred_at DESC)
  WHERE span_kind IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_service
  ON events_spans (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_db_time
  ON events_spans (organization_id, project_id, db_system, occurred_at DESC)
  WHERE db_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_host_time
  ON events_spans (organization_id, project_id, http_host, occurred_at DESC)
  WHERE http_host IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_release_time
  ON events_spans (organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_trace_time
  ON events_spans (organization_id, trace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_parent_time
  ON events_spans (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_type_time
  ON events_spans (organization_id, project_id, span_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_endpoint_time
  ON events_spans (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_status_time
  ON events_spans (organization_id, project_id, span_status, occurred_at DESC)
  WHERE span_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_occurred_brin
  ON events_spans USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_spans_watermark
  ON events_spans (organization_id, project_id, environment, ingested_at);

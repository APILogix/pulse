BEGIN;

-- Canonical request telemetry.
-- Range-partitioned by occurred_at for retention pruning and time-window dashboards.
-- Tenant/time btree indexes support high-selectivity dashboard filters.
CREATE TABLE IF NOT EXISTS events_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_id UUID,

  -- Identity & correlation
  event_id TEXT NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,

  -- Request details
  endpoint TEXT,
  name TEXT,
  method TEXT,
  status_code INTEGER,
  duration_ms NUMERIC(14,3),
  total_duration_ms NUMERIC(14,3),
  framework TEXT,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  query_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  body JSONB,
  body_size BIGINT,
  response_size BIGINT,
  span_count INTEGER,
  span_kind TEXT,
  root_span_status TEXT,
  is_partial BOOLEAN,
  message TEXT,

  -- Client / geo enrichment
  client_ip INET,
  user_agent TEXT,
  referer TEXT,
  client_ip_hash TEXT,
  geo_country_code CHAR(2),
  geo_region TEXT,
  geo_asn BIGINT,
  browser_family TEXT,
  browser_version_major TEXT,
  os_name TEXT,
  os_version_major TEXT,
  device_type TEXT,
  is_bot BOOLEAN,
  is_slow BOOLEAN GENERATED ALWAYS AS (COALESCE(duration_ms, 0) >= 1000) STORED,
  is_error BOOLEAN GENERATED ALWAYS AS (COALESCE(status_code, 0) >= 500) STORED,

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

CREATE TABLE IF NOT EXISTS events_requests_default PARTITION OF events_requests DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_requests_event_unique
  ON events_requests (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_requests_tenant_time
  ON events_requests (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_requests_tenant_env_time
  ON events_requests (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_requests_user_time
  ON events_requests (organization_id, project_id, user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;

-- Trace / service joins
CREATE INDEX IF NOT EXISTS idx_events_requests_trace
  ON events_requests (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_requests_service
  ON events_requests (service, occurred_at DESC)
  WHERE service IS NOT NULL;

-- Request-specific filters
CREATE INDEX IF NOT EXISTS idx_events_requests_endpoint_time
  ON events_requests (organization_id, project_id, endpoint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_requests_duration_time
  ON events_requests (organization_id, project_id, duration_ms, timestamp DESC)
  WHERE duration_ms IS NOT NULL;

-- JSONB search
CREATE INDEX IF NOT EXISTS idx_events_requests_attributes_gin
  ON events_requests USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_events_requests_metadata_gin
  ON events_requests USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_events_requests_payload_gin
  ON events_requests USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_requests_ai_response_gin
  ON events_requests USING GIN (ai_response);

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_requests_occurred_brin
  ON events_requests USING BRIN (occurred_at);

COMMENT ON TABLE events_requests IS 'Canonical request telemetry. Range partitions support time-window dashboards and retention pruning; tenant/time btree indexes support high-selectivity dashboard filters.';

COMMIT;

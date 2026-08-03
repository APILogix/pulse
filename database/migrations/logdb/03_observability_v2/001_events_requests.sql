BEGIN;

-- Canonical request telemetry.
-- Range-partitioned by occurred_at for retention pruning and time-window dashboards.
-- Tenant/time btree indexes support high-selectivity dashboard filters.
CREATE TABLE IF NOT EXISTS events_requests (
 -- Identity
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  api_key_name TEXT NOT NULL,

  -- Correlation
  event_id TEXT NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,

  -- Request
  endpoint TEXT,
  name TEXT,
  method TEXT,
  status_code INTEGER,
  duration_ms NUMERIC(14,3),
  body_size BIGINT,
  response_size BIGINT,

  -- Trace summary
  span_count INTEGER,
  root_span_status TEXT,
  is_partial BOOLEAN,

  -- Client
  client_ip_hash TEXT,
  user_agent TEXT,
  referer TEXT,

  -- Geo
  geo_country_code CHAR(2),
  geo_region TEXT,
  geo_asn BIGINT,

  -- Device
  browser_family TEXT,
  browser_version_major TEXT,
  os_name TEXT,
  os_version_major TEXT,
  device_type TEXT,
  is_bot BOOLEAN,

  -- Service
  service TEXT,
  framework TEXT,
  release TEXT,
  server_name TEXT,

  -- SDK
  sdk_name TEXT,
  sdk_version TEXT,

  -- Severity
  severity logdb_severity,

  -- Flags
  is_slow BOOLEAN GENERATED ALWAYS AS (COALESCE(duration_ms,0) >= 1000) STORED,
  is_error BOOLEAN GENERATED ALWAYS AS (COALESCE(status_code,0) >= 500) STORED,

  -- Flexible
  attributes JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  payload JSONB NOT NULL DEFAULT '{}',

  -- AI
  ai_response JSONB,

  -- Time
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

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

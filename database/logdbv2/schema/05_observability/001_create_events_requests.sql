-- Canonical request telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  environment TEXT NOT NULL,
  endpoint TEXT,
  name TEXT,
  public_id TEXT,
  method TEXT,
  route TEXT,
  url TEXT,
  status_code INTEGER,
  duration_ms NUMERIC(12,3),
  latency_ms NUMERIC(12,3),
  is_slow BOOLEAN GENERATED ALWAYS AS (COALESCE(duration_ms, latency_ms) > 1000) STORED,
  is_error BOOLEAN GENERATED ALWAYS AS (status_code >= 500) STORED,
  service TEXT,
  framework TEXT,
  server_name TEXT,
  severity TEXT DEFAULT 'info',
  body_size BIGINT,
  response_size BIGINT,
  request_size_bytes BIGINT,
  response_size_bytes BIGINT,
  span_count INTEGER DEFAULT 0,
  root_span_status TEXT,
  is_partial BOOLEAN DEFAULT FALSE,
  client_ip_hash TEXT,
  user_agent TEXT,
  referer TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  geo_region TEXT,
  geo_asn INTEGER,
  browser_family TEXT,
  browser_version_major TEXT,
  os_name TEXT,
  os_version_major TEXT,
  device_type TEXT,
  is_bot BOOLEAN DEFAULT FALSE,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  ip_address INET,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_requests_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_requests_default PARTITION OF events_requests DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_requests_event_unique
  ON events_requests (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_requests_tenant_time
  ON events_requests (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_requests_tenant_env_time
  ON events_requests (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_requests_pubid
  ON events_requests (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_requests_org_time
  ON events_requests (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_requests_org_env_time
  ON events_requests (organization_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_requests_org_trace_time
  ON events_requests (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_org_request_time
  ON events_requests (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_geo_time
  ON events_requests (organization_id, project_id, geo_country_code, occurred_at DESC)
  WHERE geo_country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_release_time
  ON events_requests (organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_session_time
  ON events_requests (organization_id, project_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_sdk_time
  ON events_requests (organization_id, project_id, sdk_name, sdk_version, occurred_at DESC)
  WHERE sdk_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_occurred_brin
  ON events_requests USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_requests_watermark
  ON events_requests (organization_id, project_id, environment, ingested_at);

CREATE INDEX IF NOT EXISTS idx_events_requests_error_time
  ON events_requests (organization_id, project_id, occurred_at DESC)
  WHERE is_error = TRUE;

CREATE INDEX IF NOT EXISTS idx_events_requests_slow_time
  ON events_requests (organization_id, project_id, occurred_at DESC)
  WHERE is_slow = TRUE;

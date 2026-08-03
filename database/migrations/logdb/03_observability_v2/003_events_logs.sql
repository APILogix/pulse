BEGIN;

-- Canonical log telemetry.
-- Append-heavy and range-partitioned by occurred_at for high write throughput.
CREATE TABLE IF NOT EXISTS events_logs (
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

  -- Log content
  level TEXT,
  logger TEXT,
  logger_name TEXT,
  log_source TEXT,
  log_category TEXT,
  name TEXT,
  message TEXT,
  args JSONB,

  -- HTTP context (promoted from payload/context)
  endpoint TEXT,
  http_method TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  user_ip INET,

  -- Classification / context
  context JSONB,
  tags JSONB,
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

CREATE TABLE IF NOT EXISTS events_logs_default PARTITION OF events_logs DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_logs_event_unique
  ON events_logs (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_logs_tenant_time
  ON events_logs (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_logs_tenant_env_time
  ON events_logs (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_logs_occurred_at
  ON events_logs (project_id, occurred_at DESC);

-- Trace / service joins
CREATE INDEX IF NOT EXISTS idx_events_logs_trace
  ON events_logs (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_logs_service
  ON events_logs (service, occurred_at DESC)
  WHERE service IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_logs_trace_id
  ON events_logs (project_id, trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_logs_request_id
  ON events_logs (project_id, request_id)
  WHERE request_id IS NOT NULL;

-- Log-specific filters
CREATE INDEX IF NOT EXISTS idx_events_logs_level_time
  ON events_logs (organization_id, project_id, level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_logs_logger_time
  ON events_logs (project_id, logger, occurred_at DESC)
  WHERE logger IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_logs_category_time
  ON events_logs (project_id, log_category, occurred_at DESC)
  WHERE log_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_logs_endpoint_time
  ON events_logs (project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

-- JSONB search
CREATE INDEX IF NOT EXISTS idx_events_logs_attributes_gin
  ON events_logs USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_events_logs_metadata_gin
  ON events_logs USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_events_logs_payload_gin
  ON events_logs USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_logs_ai_response_gin
  ON events_logs USING GIN (ai_response);

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_logs_occurred_brin
  ON events_logs USING BRIN (occurred_at);

-- Controlled vocabularies
ALTER TABLE events_logs
  DROP CONSTRAINT IF EXISTS events_logs_log_category_ck,
  ADD CONSTRAINT events_logs_log_category_ck
    CHECK (log_category IS NULL OR log_category IN (
      'http', 'application', 'database', 'cache', 'queue', 'worker', 'cron',
      'security', 'authentication', 'authorization', 'business', 'system', 'runtime', 'custom', 'unknown'
    )),
  DROP CONSTRAINT IF EXISTS events_logs_log_source_ck,
  ADD CONSTRAINT events_logs_log_source_ck
    CHECK (log_source IS NULL OR log_source IN (
      'sdk', 'console', 'framework', 'middleware', 'application', 'worker', 'cron', 'queue', 'unknown'
    ));

COMMENT ON TABLE events_logs IS 'Canonical log telemetry. Append-heavy and range-partitioned by occurred_at for high write throughput.';

COMMIT;

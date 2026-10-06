-- Canonical log telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  level TEXT,
  severity TEXT DEFAULT 'info',
  logger TEXT,
  logger_name TEXT,
  name TEXT,
  log_source TEXT,
  log_category TEXT,
  endpoint TEXT,
  http_method TEXT,
  status_code INTEGER,
  duration_ms NUMERIC(14,3),
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  user_ip INET,
  message TEXT,
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  args JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_logs_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_logs_default PARTITION OF events_logs DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_logs_event_unique
  ON events_logs (
    organization_id,
    project_id,
    environment,
    event_id,
    occurred_at
  );

CREATE INDEX IF NOT EXISTS idx_events_logs_org_project_time
  ON events_logs (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_env_time
  ON events_logs (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_time
  ON events_logs (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_env_direct_time
  ON events_logs (organization_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_pubid
  ON events_logs (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_logs_trace
  ON events_logs (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_span
  ON events_logs (organization_id, span_id, occurred_at DESC)
  WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_parent_span
  ON events_logs (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_request
  ON events_logs (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_session
  ON events_logs (organization_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_user
  ON events_logs (organization_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_tenant
  ON events_logs (organization_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_level
  ON events_logs (organization_id, project_id, level, occurred_at DESC)
  WHERE level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_logger
  ON events_logs (organization_id, project_id, logger, occurred_at DESC)
  WHERE logger IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_logger_name
  ON events_logs (organization_id, project_id, logger_name, occurred_at DESC)
  WHERE logger_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_service
  ON events_logs (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_endpoint
  ON events_logs (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_category
  ON events_logs (organization_id, project_id, log_category, occurred_at DESC)
  WHERE log_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_status_code
  ON events_logs (organization_id, project_id, status_code, occurred_at DESC)
  WHERE status_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_release_time
  ON events_logs (organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_occurred_brin
  ON events_logs USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_logs_watermark
  ON events_logs (organization_id, project_id, environment, ingested_at);

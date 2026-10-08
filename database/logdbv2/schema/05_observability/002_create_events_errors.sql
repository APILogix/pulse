-- Canonical error telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_errors (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  api_key_name TEXT NOT NULL,
  environment TEXT NOT NULL,
  event_id TEXT NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  fingerprint TEXT,
  fingerprint_version INTEGER DEFAULT 1,
  error_group_id UUID,
  error_name TEXT NOT NULL,
  error_message TEXT,
  message TEXT,
  mechanism TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  stack_trace TEXT,
  stack_frames JSONB NOT NULL DEFAULT '[]'::jsonb,
  breadcrumbs JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_id TEXT,
  severity TEXT NOT NULL DEFAULT 'error',
  status_code INTEGER,
  status_text TEXT,
  handled BOOLEAN NOT NULL DEFAULT false,
  service TEXT,
  route TEXT,
  method TEXT,
  url TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  ip_address INET,
  geo_country_code CHAR(2),
  geo_city TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_errors_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_errors_default PARTITION OF events_errors DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_errors_event_unique
  ON events_errors (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_errors_org_project_time
  ON events_errors (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_errors_org_env_time
  ON events_errors (organization_id, project_id, environment, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_events_errors_pubid
  ON events_errors (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_errors_group_time_v2
  ON events_errors (organization_id, project_id, error_group_id, occurred_at DESC)
  WHERE error_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_fingerprint
  ON events_errors (organization_id, project_id, fingerprint, occurred_at DESC)
  WHERE fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_trace
  ON events_errors (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_span
  ON events_errors (organization_id, span_id, occurred_at DESC)
  WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_parent_span
  ON events_errors (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_request
  ON events_errors (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_session
  ON events_errors (organization_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_user
  ON events_errors (organization_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_service
  ON events_errors (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_route
  ON events_errors (organization_id, project_id, route, occurred_at DESC)
  WHERE route IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_occurred_brin
  ON events_errors USING BRIN (occurred_at) WITH (pages_per_range = 128);

CREATE INDEX IF NOT EXISTS idx_events_errors_watermark
  ON events_errors (organization_id, project_id, environment, ingested_at);

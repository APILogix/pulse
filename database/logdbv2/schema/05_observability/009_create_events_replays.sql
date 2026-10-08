-- Canonical session replay telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_replays (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  request_id TEXT,
  segment_id INTEGER,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  endpoint TEXT,
  severity TEXT DEFAULT 'info',
  status_code INTEGER,
  name TEXT,
  message TEXT,
  duration_ms NUMERIC(12,3),
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
  CONSTRAINT events_replays_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_replays_default PARTITION OF events_replays DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_replays_event_unique
  ON events_replays (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_replays_org_project_time
  ON events_replays (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_org_env_time
  ON events_replays (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_tenant_env_time
  ON events_replays (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_service
  ON events_replays (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_replays_org_time
  ON events_replays (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_session
  ON events_replays (organization_id, session_id, segment_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_replays_pubid
  ON events_replays (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_replays_occurred_brin
  ON events_replays USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_replays_watermark
  ON events_replays (organization_id, project_id, environment, ingested_at);

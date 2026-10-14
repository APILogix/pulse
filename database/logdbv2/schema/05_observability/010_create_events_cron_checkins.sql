-- Canonical cron monitor check-in telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_cron_checkins (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  monitor_slug TEXT NOT NULL,
  monitor_name TEXT,
  status TEXT NOT NULL,
  is_success BOOLEAN DEFAULT FALSE,
  duration_ms NUMERIC(12,3),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  checkin_type TEXT,
  schedule_type TEXT,
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  endpoint TEXT,
  severity TEXT DEFAULT 'info',
  message TEXT,
  name TEXT,
  status_code INTEGER,
  expected_schedule TEXT,
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_cron_checkins_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_cron_checkins_default PARTITION OF events_cron_checkins DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_cron_checkins_event_unique
  ON events_cron_checkins (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_project_time
  ON events_cron_checkins (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_env_time
  ON events_cron_checkins (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_tenant_env_time
  ON events_cron_checkins (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_time
  ON events_cron_checkins (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_pubid
  ON events_cron_checkins (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_monitor
  ON events_cron_checkins (organization_id, project_id, monitor_slug, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_monitor_time
  ON events_cron_checkins (organization_id, project_id, monitor_slug, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_status
  ON events_cron_checkins (organization_id, project_id, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_success
  ON events_cron_checkins (organization_id, project_id, is_success, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_trace
  ON events_cron_checkins (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_release_time
  ON events_cron_checkins (organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_occurred_brin
  ON events_cron_checkins USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_watermark
  ON events_cron_checkins (organization_id, project_id, environment, ingested_at);

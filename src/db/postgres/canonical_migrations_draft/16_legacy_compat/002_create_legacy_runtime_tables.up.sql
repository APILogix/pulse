BEGIN;

CREATE TABLE IF NOT EXISTS logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  level VARCHAR(16) NOT NULL,
  message TEXT NOT NULL,
  args JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS logs_default PARTITION OF logs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_logs_project_time ON logs(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(project_id, level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  profile_type VARCHAR(16) NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms DOUBLE PRECISION,
  profile JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS profiles_default PARTITION OF profiles DEFAULT;
CREATE INDEX IF NOT EXISTS idx_profiles_project_time ON profiles(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_trace ON profiles(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cron_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  monitor_slug VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL,
  duration_ms DOUBLE PRECISION,
  environment VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS cron_checkins_default PARTITION OF cron_checkins DEFAULT;
CREATE INDEX IF NOT EXISTS idx_cron_monitor_time ON cron_checkins(project_id, monitor_slug, timestamp DESC);

CREATE TABLE IF NOT EXISTS replays (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  session_id VARCHAR(64) NOT NULL,
  segment_id INTEGER NOT NULL,
  events JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS replays_default PARTITION OF replays DEFAULT;
CREATE INDEX IF NOT EXISTS idx_replays_session ON replays(project_id, session_id, segment_id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  message TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL,
  context JSONB,
  breadcrumbs JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS messages_default PARTITION OF messages DEFAULT;
CREATE INDEX IF NOT EXISTS idx_messages_project_time ON messages(project_id, severity, timestamp DESC);

CREATE TABLE IF NOT EXISTS sdk_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  session_id VARCHAR(64) NOT NULL,
  started_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  event_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  crashed BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS sdk_sessions_default PARTITION OF sdk_sessions DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdk_sessions_unique ON sdk_sessions(project_id, session_id, timestamp);

COMMIT;

-- Canonical CPU/memory profile telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_profiles (
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
  profile_type TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
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
  profile_data JSONB,
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
  CONSTRAINT events_profiles_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_profiles_default PARTITION OF events_profiles DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_profiles_event_unique
  ON events_profiles (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_profiles_org_project_time
  ON events_profiles (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_org_env_time
  ON events_profiles (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_tenant_env_time
  ON events_profiles (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_org_time
  ON events_profiles (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_pubid
  ON events_profiles (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_profiles_type
  ON events_profiles (organization_id, project_id, profile_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_occurred_brin
  ON events_profiles USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_profiles_watermark
  ON events_profiles (organization_id, project_id, environment, ingested_at);

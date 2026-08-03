BEGIN;

-- Canonical profile telemetry (CPU/memory performance profiles).
-- Range-partitioned by occurred_at for retention pruning.
CREATE TABLE IF NOT EXISTS events_profiles (
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

  -- Profile content
  profile_type TEXT,
  name TEXT,
  message TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  profile_data JSONB,

  -- SDK / service context
  service TEXT,
  endpoint TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  application_name TEXT,
  application_version TEXT,
  server_name TEXT,
  severity logdb_severity,
  status_code INTEGER,
  duration_ms NUMERIC(14,3),

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

CREATE TABLE IF NOT EXISTS events_profiles_default PARTITION OF events_profiles DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_profiles_event_unique
  ON events_profiles (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_profiles_tenant_time
  ON events_profiles (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_profiles_tenant_env_time
  ON events_profiles (organization_id, project_id, environment, occurred_at DESC);

-- Trace / service joins
CREATE INDEX IF NOT EXISTS idx_events_profiles_trace
  ON events_profiles (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_profiles_service
  ON events_profiles (service, occurred_at DESC)
  WHERE service IS NOT NULL;

-- JSONB search
CREATE INDEX IF NOT EXISTS idx_events_profiles_attributes_gin
  ON events_profiles USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_events_profiles_metadata_gin
  ON events_profiles USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_events_profiles_payload_gin
  ON events_profiles USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_profiles_ai_response_gin
  ON events_profiles USING GIN (ai_response);

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_profiles_occurred_brin
  ON events_profiles USING BRIN (occurred_at);

COMMIT;

BEGIN;

-- Canonical replay telemetry (session replay segments).
-- Range-partitioned by occurred_at for retention pruning.
CREATE TABLE IF NOT EXISTS events_replays (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,

  -- Identity & correlation
  event_id TEXT NOT NULL,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  request_id TEXT,

  -- Replay content
  segment_id INTEGER,
  name TEXT,
  message TEXT,
  events JSONB,

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
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_replays_default PARTITION OF events_replays DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_replays_event_unique
  ON events_replays (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_replays_tenant_time
  ON events_replays (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_replays_tenant_env_time
  ON events_replays (organization_id, project_id, environment, occurred_at DESC);

-- Trace / service joins
CREATE INDEX IF NOT EXISTS idx_events_replays_trace
  ON events_replays (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_replays_service
  ON events_replays (service, occurred_at DESC)
  WHERE service IS NOT NULL;

-- JSONB search
CREATE INDEX IF NOT EXISTS idx_events_replays_attributes_gin
  ON events_replays USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_events_replays_metadata_gin
  ON events_replays USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_events_replays_payload_gin
  ON events_replays USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_replays_ai_response_gin
  ON events_replays USING GIN (ai_response);

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_replays_occurred_brin
  ON events_replays USING BRIN (occurred_at);

COMMIT;

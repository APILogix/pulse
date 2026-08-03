BEGIN;

-- Canonical error telemetry.
-- JSONB GIN indexes support issue triage filters; trace index joins errors to traces.
CREATE TABLE IF NOT EXISTS events_errors (
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

  -- Error identity
  fingerprint TEXT,
  error_group_id UUID,
  error_name TEXT,
  severity logdb_severity,
  status_code INTEGER,
  status_text TEXT,
  handled BOOLEAN,

  -- Error content
  message TEXT,
  name TEXT,
  stack_frames JSONB,
  breadcrumbs JSONB,
  contexts JSONB,

  -- SDK / service context
  service TEXT,
  endpoint TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  application_name TEXT,
  application_version TEXT,
  server_name TEXT,
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

CREATE TABLE IF NOT EXISTS events_errors_default PARTITION OF events_errors DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_errors_event_unique
  ON events_errors (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_errors_tenant_time
  ON events_errors (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_errors_tenant_env_time
  ON events_errors (organization_id, project_id, environment, occurred_at DESC);

-- Trace / service joins
CREATE INDEX IF NOT EXISTS idx_events_errors_trace
  ON events_errors (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_errors_service
  ON events_errors (service, occurred_at DESC)
  WHERE service IS NOT NULL;

-- Error-specific filters
CREATE INDEX IF NOT EXISTS idx_events_errors_fingerprint_time
  ON events_errors (organization_id, project_id, fingerprint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_errors_project_status_time
  ON events_errors (organization_id, project_id, status_code, occurred_at DESC)
  WHERE status_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_errors_project_handled_time
  ON events_errors (organization_id, project_id, handled, occurred_at DESC)
  WHERE handled IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_errors_group_id
  ON events_errors (error_group_id);

-- JSONB search
CREATE INDEX IF NOT EXISTS idx_events_errors_attributes_gin
  ON events_errors USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_events_errors_metadata_gin
  ON events_errors USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_events_errors_payload_gin
  ON events_errors USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_errors_ai_response_gin
  ON events_errors USING GIN (ai_response);

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_errors_occurred_brin
  ON events_errors USING BRIN (occurred_at);

COMMENT ON TABLE events_errors IS 'Canonical error telemetry. JSONB GIN indexes support issue triage filters; trace index joins errors to traces without cross-database constraints.';

COMMIT;

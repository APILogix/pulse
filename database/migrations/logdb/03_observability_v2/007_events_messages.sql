BEGIN;

-- Canonical message telemetry (breadcrumb / audit / messaging events).
-- Range-partitioned by occurred_at for retention pruning.
CREATE TABLE IF NOT EXISTS events_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,

  -- Identity & correlation
  event_id TEXT NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,

  -- Message content
  name TEXT,
  message TEXT,
  severity logdb_severity,
  status_code INTEGER,
  duration_ms NUMERIC(14,3),
  logger_name TEXT,
  message_category TEXT,
  message_source TEXT,
  user_ip INET,

  -- Context
  tags JSONB,
  contexts JSONB,
  breadcrumbs JSONB,
  service TEXT,
  endpoint TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  application_name TEXT,
  application_version TEXT,
  server_name TEXT,

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

CREATE TABLE IF NOT EXISTS events_messages_default PARTITION OF events_messages DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_messages_event_unique
  ON events_messages (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_messages_tenant_time
  ON events_messages (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_messages_tenant_env_time
  ON events_messages (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_messages_project_time
  ON events_messages (organization_id, project_id, occurred_at DESC);

-- Trace / service joins
CREATE INDEX IF NOT EXISTS idx_events_messages_trace
  ON events_messages (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_service
  ON events_messages (service, occurred_at DESC)
  WHERE service IS NOT NULL;

-- Message-specific filters
CREATE INDEX IF NOT EXISTS idx_events_messages_project_severity_time
  ON events_messages (organization_id, project_id, severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_messages_project_request
  ON events_messages (organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_project_trace
  ON events_messages (organization_id, project_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

-- JSONB search
CREATE INDEX IF NOT EXISTS idx_events_messages_attributes_gin
  ON events_messages USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_events_messages_metadata_gin
  ON events_messages USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_events_messages_payload_gin
  ON events_messages USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_messages_ai_response_gin
  ON events_messages USING GIN (ai_response);

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_messages_occurred_brin
  ON events_messages USING BRIN (occurred_at);

COMMIT;

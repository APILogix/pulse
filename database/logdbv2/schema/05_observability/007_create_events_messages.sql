-- Canonical message telemetry (breadcrumb / audit / messaging events).
-- Range-partitioned by occurred_at for retention pruning.
CREATE TABLE IF NOT EXISTS events_messages (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,

  -- Identity & correlation
  event_id UUID NOT NULL,
  public_id TEXT,
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

-- Correlation lookups
CREATE INDEX IF NOT EXISTS idx_events_messages_trace_time
  ON events_messages (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_span_time
  ON events_messages (span_id, occurred_at DESC)
  WHERE span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_session_time
  ON events_messages (organization_id, project_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_user_time
  ON events_messages (organization_id, project_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_request_time
  ON events_messages (organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

-- Public ID
CREATE INDEX IF NOT EXISTS idx_events_messages_pubid
  ON events_messages (organization_id, project_id, public_id)
  WHERE public_id IS NOT NULL;

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_messages_occurred_brin
  ON events_messages USING BRIN (occurred_at);

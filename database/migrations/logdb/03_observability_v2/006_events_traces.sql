BEGIN;

-- Canonical trace telemetry (one row per trace, root span denormalized).
-- Range-partitioned by occurred_at for retention pruning and trace lookup.
CREATE TABLE IF NOT EXISTS events_traces (
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
  tenant_id TEXT,
  request_id TEXT,

  -- Root span identity
  root_span_name TEXT,
  root_span_id TEXT,
  span_kind TEXT,
  root_span_status TEXT,
  endpoint TEXT,
  http_method TEXT,
  status_code INTEGER,
  is_partial BOOLEAN,

  -- Trace metrics
  duration_ms NUMERIC(14,3),
  total_duration_ms NUMERIC(14,3),
  response_size BIGINT,
  span_count INTEGER,
  spans_tree JSONB,

  -- Client context
  user_agent TEXT,
  client_ip_hash TEXT,

  -- SDK / service context
  service TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  application_name TEXT,
  application_version TEXT,
  server_name TEXT,
  severity logdb_severity,
  message TEXT,
  name TEXT,

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

CREATE TABLE IF NOT EXISTS events_traces_default PARTITION OF events_traces DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_traces_event_unique
  ON events_traces (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_traces_tenant_time
  ON events_traces (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_traces_tenant_env_time
  ON events_traces (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_traces_org_proj_time
  ON events_traces (organization_id, project_id, occurred_at DESC);

-- Trace lookups
CREATE INDEX IF NOT EXISTS idx_events_traces_trace_time
  ON events_traces (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_traces_trace_id_hash
  ON events_traces (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_traces_request_time
  ON events_traces (organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

-- Service / endpoint / status filters
CREATE INDEX IF NOT EXISTS idx_events_traces_service
  ON events_traces (service, occurred_at DESC)
  WHERE service IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_traces_endpoint_time
  ON events_traces (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_traces_status_time
  ON events_traces (organization_id, project_id, status_code, occurred_at DESC)
  WHERE status_code IS NOT NULL;

-- JSONB search
-- No GIN indexes on attributes/metadata/payload/ai_response: written on
-- every ingested trace but never queried via JSONB containment/path
-- operators anywhere in the codebase. See docs/ingestionv2/gin-index-audit.md.
-- Historically created and later dropped by
-- 031_remaining_jsonb_gin_hot_path.sql; that migration remains for
-- deployments migrating forward from an older schema, but a fresh database
-- created from this file never creates them in the first place.

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_traces_occurred_brin
  ON events_traces USING BRIN (occurred_at);

COMMIT;

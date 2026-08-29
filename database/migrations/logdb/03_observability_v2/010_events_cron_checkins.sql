BEGIN;

-- Canonical cron / monitor check-in telemetry.
-- Range-partitioned by occurred_at for retention pruning.
CREATE TABLE IF NOT EXISTS events_cron_checkins (
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

  -- Monitor identity
  monitor_slug TEXT,
  monitor_name TEXT,
  status TEXT,
  is_success BOOLEAN,
  checkin_type TEXT,
  schedule_type TEXT,

  -- Execution timeline
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms NUMERIC(14,3),
  severity logdb_severity,
  status_code INTEGER,
  message TEXT,
  name TEXT,

  -- Context
  tags JSONB,
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

CREATE TABLE IF NOT EXISTS events_cron_checkins_default PARTITION OF events_cron_checkins DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_cron_checkins_event_unique
  ON events_cron_checkins (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_tenant_time
  ON events_cron_checkins (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_tenant_env_time
  ON events_cron_checkins (organization_id, project_id, environment, occurred_at DESC);

-- Trace / service joins
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_trace
  ON events_cron_checkins (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_service
  ON events_cron_checkins (service, occurred_at DESC)
  WHERE service IS NOT NULL;

-- Cron-specific filters
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_monitor_time
  ON events_cron_checkins (project_id, monitor_slug, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_monitor_time
  ON events_cron_checkins (organization_id, project_id, monitor_slug, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_slug_occurred
  ON events_cron_checkins (monitor_slug, occurred_at DESC)
  WHERE monitor_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_status_time
  ON events_cron_checkins (project_id, status, occurred_at DESC)
  WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_success_time
  ON events_cron_checkins (project_id, is_success, occurred_at DESC)
  WHERE is_success IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_type_time
  ON events_cron_checkins (project_id, checkin_type, occurred_at DESC)
  WHERE checkin_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_tenant_id_time
  ON events_cron_checkins (organization_id, project_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

-- JSONB search
-- No GIN indexes on attributes/metadata/payload/ai_response: written on
-- every ingested cron check-in but never queried via JSONB
-- containment/path operators anywhere in the codebase. See
-- docs/ingestionv2/gin-index-audit.md. Historically created and later
-- dropped by 031_remaining_jsonb_gin_hot_path.sql; that migration remains
-- for deployments migrating forward from an older schema, but a fresh
-- database created from this file never creates them in the first place.

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_occurred_brin
  ON events_cron_checkins USING BRIN (occurred_at);

-- Controlled vocabularies
ALTER TABLE events_cron_checkins
  DROP CONSTRAINT IF EXISTS events_cron_checkins_status_ck,
  ADD CONSTRAINT events_cron_checkins_status_ck
    CHECK (status IS NULL OR status IN ('ok', 'error', 'in_progress', 'failed', 'timeout', 'missed')),
  DROP CONSTRAINT IF EXISTS events_cron_checkins_checkin_type_ck,
  ADD CONSTRAINT events_cron_checkins_checkin_type_ck
    CHECK (checkin_type IS NULL OR checkin_type IN ('heartbeat', 'scheduled', 'manual', 'retry', 'unknown'));

COMMIT;

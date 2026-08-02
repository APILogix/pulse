-- ============================================================
-- 011_normalize_cron_checkins.sql
-- Enterprise normalization for events_cron_checkins.
-- Inspired by Sentry Crons, Datadog Scheduled Jobs, Better Stack Heartbeats.
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- ============================================================
BEGIN;

-- ── 1. Add all missing canonical columns ─────────────────────────────────────

ALTER TABLE events_cron_checkins
  -- Cron-specific identity
  ADD COLUMN IF NOT EXISTS monitor_name    TEXT,
  ADD COLUMN IF NOT EXISTS tenant_id       TEXT,
  -- Derived/computed fields
  ADD COLUMN IF NOT EXISTS is_success      BOOLEAN,
  ADD COLUMN IF NOT EXISTS checkin_type    TEXT,
  ADD COLUMN IF NOT EXISTS schedule_type   TEXT,
  -- Execution timeline
  ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at     TIMESTAMPTZ,
  -- Flexible storage
  ADD COLUMN IF NOT EXISTS tags            JSONB,
  ADD COLUMN IF NOT EXISTS attributes      JSONB;

-- ── 2. Backfill existing rows from payload ─────────────────────────────────────
UPDATE events_cron_checkins
SET
  -- Monitor identity
  monitor_slug  = COALESCE(monitor_slug,  payload->>'monitorSlug'),
  monitor_name  = COALESCE(monitor_name,  payload->>'monitorName', payload->>'name'),
  status        = COALESCE(status,        payload->>'status'),
  tenant_id     = COALESCE(tenant_id,     payload->>'tenantId', payload#>>'{extra,tenantId}'),

  -- Duration from payload.duration (SDK sends seconds or ms depending on version)
  duration_ms   = COALESCE(
    duration_ms,
    NULLIF(payload->>'duration', '')::numeric
  ),

  -- Timeline reconstruction
  started_at  = COALESCE(started_at,  NULLIF(payload->>'startedAt', '')::timestamptz),
  finished_at = COALESCE(finished_at, NULLIF(payload->>'finishedAt', '')::timestamptz),

  -- Schedule type
  schedule_type = COALESCE(schedule_type, payload->>'scheduleType', payload#>>'{schedule,type}'),

  -- Timestamps
  occurred_at = COALESCE(occurred_at, timestamp),
  timestamp   = COALESCE(timestamp,   occurred_at),

  -- SDK metadata
  project_id          = COALESCE(project_id, NULLIF(payload #>> '{metadata,projectId}', '')::uuid),
  environment         = COALESCE(environment, payload #>> '{metadata,environment}'),
  sdk_name            = COALESCE(sdk_name,    payload #>> '{metadata,sdkName}'),
  sdk_version         = COALESCE(sdk_version, payload #>> '{metadata,sdkVersion}'),
  application_name    = COALESCE(application_name,    payload #>> '{metadata,applicationName}'),
  application_version = COALESCE(application_version, payload #>> '{metadata,applicationVersion}'),
  release             = COALESCE(release,     payload #>> '{metadata,release}'),

  -- Tags from payload
  tags = COALESCE(
    NULLIF(tags, 'null'::jsonb),
    CASE WHEN jsonb_typeof(payload->'tags') = 'object' THEN payload->'tags' ELSE '{}'::jsonb END,
    '{}'::jsonb
  ),

  -- Attributes (custom SDK/business values)
  attributes = COALESCE(
    NULLIF(attributes, 'null'::jsonb),
    CASE WHEN jsonb_typeof(payload->'attributes') = 'object' THEN payload->'attributes' ELSE '{}'::jsonb END,
    '{}'::jsonb
  )
WHERE TRUE;

-- ── 3. Derive computed fields ──────────────────────────────────────────────────

-- is_success: TRUE when status is 'ok'
UPDATE events_cron_checkins
SET is_success = (status = 'ok')
WHERE is_success IS NULL AND status IS NOT NULL;

-- checkin_type: classify from available payload context
UPDATE events_cron_checkins
SET checkin_type = CASE
  WHEN payload->>'checkinType' IS NOT NULL THEN payload->>'checkinType'
  WHEN payload->>'type' = 'heartbeat' OR monitor_slug ILIKE '%heartbeat%' OR monitor_slug ILIKE '%ping%' THEN 'heartbeat'
  WHEN payload->>'scheduleType' IS NOT NULL OR payload#>>'{schedule,type}' IS NOT NULL THEN 'scheduled'
  WHEN payload->>'retry' = 'true' THEN 'retry'
  WHEN payload->>'manual' = 'true' THEN 'manual'
  ELSE 'scheduled'
END
WHERE checkin_type IS NULL;

-- ── 4. CHECK constraints for controlled vocabulary ─────────────────────────────
ALTER TABLE events_cron_checkins
  DROP CONSTRAINT IF EXISTS events_cron_checkins_status_ck,
  ADD CONSTRAINT events_cron_checkins_status_ck
    CHECK (status IS NULL OR status IN ('ok', 'error', 'in_progress', 'failed', 'timeout', 'missed')),
  DROP CONSTRAINT IF EXISTS events_cron_checkins_checkin_type_ck,
  ADD CONSTRAINT events_cron_checkins_checkin_type_ck
    CHECK (checkin_type IS NULL OR checkin_type IN ('heartbeat', 'scheduled', 'manual', 'retry', 'unknown'));

-- ── 5. Indexes ─────────────────────────────────────────────────────────────────
-- Already exist: idx_events_cron_checkins_tenant_env_time, idx_events_cron_checkins_tenant_time,
--                idx_events_cron_checkins_trace, idx_events_cron_checkins_service,
--                idx_events_cron_checkins_occurred_brin

-- Monitor history: the primary access pattern (Sentry Crons-style timeline)
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_monitor_time
  ON events_cron_checkins(project_id, monitor_slug, occurred_at DESC);

-- Status-based alerting and filtering
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_status_time
  ON events_cron_checkins(project_id, status, occurred_at DESC)
  WHERE status IS NOT NULL;

-- Monitor slug standalone (cross-project admin dashboards)
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_slug_occurred
  ON events_cron_checkins(monitor_slug, occurred_at DESC)
  WHERE monitor_slug IS NOT NULL;

-- Success rate calculations (fast COUNT FILTER queries)
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_success_time
  ON events_cron_checkins(project_id, is_success, occurred_at DESC)
  WHERE is_success IS NOT NULL;

-- Organization-level cross-project monitor dashboards
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_monitor_time
  ON events_cron_checkins(organization_id, project_id, monitor_slug, occurred_at DESC);

-- Tenant isolation (multi-tenant SaaS)
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_tenant_id_time
  ON events_cron_checkins(organization_id, project_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

-- Checkin type breakdown
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_type_time
  ON events_cron_checkins(project_id, checkin_type, occurred_at DESC)
  WHERE checkin_type IS NOT NULL;

COMMIT;

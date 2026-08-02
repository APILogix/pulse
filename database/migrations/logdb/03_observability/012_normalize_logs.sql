-- ============================================================
-- 012_normalize_logs.sql
-- Enterprise normalization for events_logs.
-- Replaces JSON parsing latency with structured canonical columns.
-- ============================================================
BEGIN;

-- ── 1. Add missing canonical columns ──────────────────────────────────────────
ALTER TABLE events_logs
  ADD COLUMN IF NOT EXISTS parent_span_id  TEXT,
  ADD COLUMN IF NOT EXISTS tenant_id       TEXT,
  ADD COLUMN IF NOT EXISTS name            TEXT,
  ADD COLUMN IF NOT EXISTS logger_name     TEXT,
  ADD COLUMN IF NOT EXISTS log_source      TEXT,
  ADD COLUMN IF NOT EXISTS log_category    TEXT,
  ADD COLUMN IF NOT EXISTS endpoint        TEXT,
  ADD COLUMN IF NOT EXISTS http_method     TEXT,
  ADD COLUMN IF NOT EXISTS status_code     INTEGER,
  ADD COLUMN IF NOT EXISTS duration_ms     INTEGER,
  ADD COLUMN IF NOT EXISTS attributes      JSONB;

-- ── 2. Backfill from payload and context ─────────────────────────────────────
UPDATE events_logs
SET
  -- Identifiers & Correlation
  tenant_id       = COALESCE(tenant_id, payload->>'tenantId', payload#>>'{extra,tenantId}'),
  parent_span_id  = COALESCE(parent_span_id, payload->>'parentSpanId'),
  logger_name     = COALESCE(logger_name, payload->>'logger_name', payload->>'loggerName', logger),

  -- Titles & Naming
  name = COALESCE(
    name,
    payload->>'name',
    CASE
      WHEN message ILIKE 'GET %' OR message ILIKE 'POST %' OR message ILIKE 'PUT %' OR message ILIKE 'DELETE %' OR message ILIKE 'PATCH %'
        THEN 'HTTP Request'
      WHEN message ILIKE '%error%' OR level IN ('error', 'fatal')
        THEN 'Error Log'
      WHEN logger ILIKE '%db%' OR logger ILIKE '%postgres%'
        THEN 'Database Query'
      WHEN logger ILIKE '%cache%' OR logger ILIKE '%redis%'
        THEN 'Cache Operation'
      WHEN logger ILIKE '%worker%' OR logger ILIKE '%job%' OR logger ILIKE '%queue%'
        THEN 'Background Job'
      ELSE 'Log Event'
    END
  ),

  -- HTTP Information extraction (from message and context)
  http_method = COALESCE(
    http_method,
    payload->>'httpMethod',
    payload#>>'{context,http,method}',
    (regexp_match(message, '^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+'))[1]
  ),
  endpoint = COALESCE(
    endpoint,
    payload->>'endpoint',
    payload#>>'{context,http,url}',
    (regexp_match(message, '^(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+([^?\s]+)'))[1]
  ),
  status_code = COALESCE(
    status_code,
    (payload->>'statusCode')::integer,
    (payload#>>'{context,http,status_code}')::integer,
    (regexp_match(message, 'HTTP.*?\s([2-5][0-9]{2})\b'))[1]::integer,
    (regexp_match(message, '\b([2-5][0-9]{2})\b.*?\s\d+ms'))[1]::integer
  ),
  duration_ms = COALESCE(
    duration_ms,
    (payload->>'durationMs')::integer,
    (payload#>>'{context,http,duration_ms}')::integer,
    (regexp_match(message, '\b(\d+)\s*ms\b'))[1]::integer
  ),

  -- Classification
  log_source = COALESCE(
    log_source,
    payload->>'logSource',
    payload->>'log_source',
    CASE
      WHEN payload->>'sdk_name' IS NOT NULL THEN 'sdk'
      WHEN logger ILIKE '%express%' OR logger ILIKE '%koa%' OR logger ILIKE '%fastify%' THEN 'framework'
      WHEN logger ILIKE '%middleware%' THEN 'middleware'
      WHEN logger ILIKE '%worker%' OR logger ILIKE '%job%' THEN 'worker'
      ELSE 'unknown'
    END
  ),
  log_category = COALESCE(
    log_category,
    payload->>'logCategory',
    payload->>'log_category',
    CASE
      WHEN message ILIKE '%GET %' OR message ILIKE '%POST %' OR logger ILIKE '%http%' THEN 'http'
      WHEN logger ILIKE '%db%' OR logger ILIKE '%sql%' OR logger ILIKE '%postgres%' THEN 'database'
      WHEN logger ILIKE '%redis%' OR logger ILIKE '%cache%' THEN 'cache'
      WHEN logger ILIKE '%auth%' OR message ILIKE '%login%' OR message ILIKE '%unauthorized%' THEN 'authentication'
      WHEN logger ILIKE '%queue%' OR logger ILIKE '%worker%' THEN 'worker'
      WHEN level IN ('error', 'fatal') OR message ILIKE '%exception%' THEN 'application'
      ELSE 'application'
    END
  ),

  -- SDK metadata normalization
  project_id          = COALESCE(project_id, NULLIF(payload#>>'{metadata,projectId}', '')::uuid),
  environment         = COALESCE(environment, payload#>>'{metadata,environment}'),
  sdk_name            = COALESCE(sdk_name, payload#>>'{metadata,sdkName}'),
  sdk_version         = COALESCE(sdk_version, payload#>>'{metadata,sdkVersion}'),
  application_name    = COALESCE(application_name, payload#>>'{metadata,applicationName}'),
  application_version = COALESCE(application_version, payload#>>'{metadata,applicationVersion}'),
  release             = COALESCE(release, payload#>>'{metadata,release}'),

  -- Timestamps
  occurred_at = COALESCE(occurred_at, timestamp),
  timestamp   = COALESCE(timestamp, occurred_at),

  -- Attributes
  attributes = COALESCE(
    NULLIF(attributes, 'null'::jsonb),
    CASE WHEN jsonb_typeof(payload->'attributes') = 'object' THEN payload->'attributes' ELSE '{}'::jsonb END,
    '{}'::jsonb
  )
WHERE TRUE;

-- ── 3. Check constraints for categorical values ──────────────────────────────
ALTER TABLE events_logs
  DROP CONSTRAINT IF EXISTS events_logs_log_category_ck,
  ADD CONSTRAINT events_logs_log_category_ck
    CHECK (log_category IS NULL OR log_category IN ('http', 'application', 'database', 'cache', 'queue', 'worker', 'cron', 'security', 'authentication', 'authorization', 'business', 'system', 'runtime', 'custom', 'unknown')),
  DROP CONSTRAINT IF EXISTS events_logs_log_source_ck,
  ADD CONSTRAINT events_logs_log_source_ck
    CHECK (log_source IS NULL OR log_source IN ('sdk', 'console', 'framework', 'middleware', 'application', 'worker', 'cron', 'queue', 'unknown'));

-- ── 4. High-Performance Indexing ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_events_logs_occurred_at
  ON events_logs(project_id, occurred_at DESC);

-- Drop old level-only index if it exists, since we replace it with a composite one below
-- Wait, the instruction said "Review existing indexes before creating new ones. Remove duplicate..."
-- We have idx_events_logs_level_time which is (organization_id, project_id, level, timestamp DESC)
-- We will keep the existing idx_events_logs_level_time and add the ones requested.

CREATE INDEX IF NOT EXISTS idx_events_logs_endpoint_time
  ON events_logs(project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_trace_id
  ON events_logs(project_id, trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_request_id
  ON events_logs(project_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_logger_time
  ON events_logs(project_id, logger, occurred_at DESC)
  WHERE logger IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_category_time
  ON events_logs(project_id, log_category, occurred_at DESC)
  WHERE log_category IS NOT NULL;

COMMIT;

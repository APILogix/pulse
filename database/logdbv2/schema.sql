-- Consolidated final-state LogDB schema.
-- Source: database/migrations/logdb ordered forward migrations.
-- 08_automation_runtime is intentionally excluded: its later 002 migration removes all of its tables from the final LogDB state.


-- ===== Source: database/migrations/logdb/00_shared/001_foundation.up.sql =====
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE OR REPLACE FUNCTION logdb_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_job_state') THEN
    CREATE TYPE logdb_job_state AS ENUM ('pending', 'active', 'completed', 'failed', 'dead_letter', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_severity') THEN
    CREATE TYPE logdb_severity AS ENUM ('debug', 'info', 'warning', 'error', 'critical', 'fatal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_delivery_status') THEN
    CREATE TYPE logdb_delivery_status AS ENUM ('pending', 'delivered', 'failed', 'retrying', 'discarded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_ai_status') THEN
    CREATE TYPE logdb_ai_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS logdb_schema_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL UNIQUE,
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  ('database_boundary', 'Log DB tables intentionally store primary-database identifiers as UUID/TEXT values without REFERENCES constraints. Application services validate ownership and authorization.'),
  ('partitioning_policy', 'Continuously growing event, usage, runtime, audit, AI, automation, and retention tables are range-partitioned by bucket, occurred_at, created_at, or started_at to support retention pruning and dashboard time filters.'),
  ('indexing_policy', 'BRIN indexes support time-window scans on append-heavy tables; btree indexes target tenant-scoped dashboards and worker claims; GIN indexes are limited to JSONB payloads used by search or filtering.')
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;


-- ===== Source: database/migrations/logdb/00_shared/002_alerting_v2_types.up.sql =====
-- =============================================================================
-- Log DB : L1 â€” Alerting v2 runtime enums
-- Architecture : docs/alerting-redesign/02-data-model.md Â§3, Â§7
--                docs/alerting-redesign/adr/0006-database-ownership.md
-- Increment    : 1 (schema ownership stabilization)
--
-- Additive only. Creates the enum vocabulary shared by the typed v2 runtime
-- tables. `notification_channel_kind` is intentionally created with the SAME
-- name and SAME value order in BOTH databases so payloads translate 1:1 with
-- no mapping table (02-data-model.md Â§5).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel_kind') THEN
    CREATE TYPE notification_channel_kind AS ENUM (
      'in_app','email','slack','discord','teams','pagerduty','webhook','sms'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_kind') THEN
    CREATE TYPE alert_event_kind AS ENUM (
      'fired','recovered','duplicate','suppressed','silenced'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_state') THEN
    CREATE TYPE alert_state AS ENUM (
      'pending','firing','acknowledged','resolved','suppressed','silenced','expired','error'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_job_status') THEN
    CREATE TYPE notification_job_status AS ENUM (
      'pending','queued','sent','failed','suppressed','cancelled','expired'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_usage_kind') THEN
    CREATE TYPE alert_usage_kind AS ENUM (
      'alert_generated','alert_suppressed','alert_delivered','alert_failed',
      'connector_send','email_sent','slack_message','sms_sent','webhook_call',
      'discord_message','teams_message','pagerduty_event','delivery_retry'
    );
  END IF;
END $$;

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  (
    'alerting_v2_runtime',
    'Alert and connector runtime facts are owned by the Log DB and are append-oriented. '
    || 'alert_event_state is the single documented mutable projection (ADR-0006) and is '
    || 'rebuildable from alert_events_v2 + alert_event_history_v2.'
  )
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;


-- ===== Source: database/migrations/logdb/00_shared/003_alert_state_lifecycle.up.sql =====
BEGIN;

ALTER TYPE alert_state ADD VALUE IF NOT EXISTS 'healthy';
ALTER TYPE alert_state ADD VALUE IF NOT EXISTS 'triggered';
ALTER TYPE alert_state ADD VALUE IF NOT EXISTS 'escalated';
ALTER TYPE alert_state ADD VALUE IF NOT EXISTS 'closed';

COMMIT;


-- ===== Source: database/migrations/logdb/01_usage/001_usage_rollups.up.sql =====
BEGIN;

-- Intentionally inert. Usage counters, billing attribution, API-key usage, and
-- project/environment usage rollups are authoritative control-plane data. The
-- dedicated Log DB stores typed telemetry and analytics facts, not a second
-- billing ledger.

COMMIT;


-- ===== Source: database/migrations/logdb/02_ingestion/001_ingestion_runtime.up.sql =====
BEGIN;

-- The dedicated Log DB stores telemetry and derived operational facts only.
-- pg-boss jobs, ingestion_dead_letter_jobs, usage_counter_staging, billing
-- rollups, and their administration remain authoritative in the control-plane
-- database and are intentionally not duplicated here.

CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pending_count BIGINT NOT NULL DEFAULT 0,
  active_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  oldest_pending_at TIMESTAMPTZ,
  worker_count INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);
CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot_default PARTITION OF ingestion_queue_snapshot DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_queue_time ON ingestion_queue_snapshot(queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_brin ON ingestion_queue_snapshot USING BRIN (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(18,6) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);
CREATE TABLE IF NOT EXISTS ingestion_metrics_default PARTITION OF ingestion_metrics DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_name_time ON ingestion_metrics(metric_name, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_dimensions_gin ON ingestion_metrics USING GIN (dimensions);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_brin ON ingestion_metrics USING BRIN (captured_at);

CREATE TABLE IF NOT EXISTS worker_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  queue TEXT NOT NULL,
  processed_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  avg_duration_ms NUMERIC(12,3),
  p95_duration_ms NUMERIC(12,3),
  memory_mb NUMERIC(12,3),
  cpu_percent NUMERIC(6,3),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);
CREATE TABLE IF NOT EXISTS worker_performance_default PARTITION OF worker_performance DEFAULT;
CREATE INDEX IF NOT EXISTS idx_worker_performance_worker_time ON worker_performance(worker_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_performance_brin ON worker_performance USING BRIN (captured_at);

CREATE TABLE IF NOT EXISTS backpressure_gauge (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pressure_score NUMERIC(8,4) NOT NULL CHECK (pressure_score >= 0),
  reason TEXT,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);
CREATE TABLE IF NOT EXISTS backpressure_gauge_default PARTITION OF backpressure_gauge DEFAULT;
CREATE INDEX IF NOT EXISTS idx_backpressure_queue_time ON backpressure_gauge(queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_backpressure_brin ON backpressure_gauge USING BRIN (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_id UUID,
  event_type TEXT,
  error_code TEXT NOT NULL,
  error_message TEXT,
  payload JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT ingestion_failures_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);
CREATE TABLE IF NOT EXISTS ingestion_failures_default PARTITION OF ingestion_failures DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_tenant_env_time
  ON ingestion_failures(organization_id,project_id,environment,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_error_time ON ingestion_failures(error_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_payload_gin ON ingestion_failures USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_brin ON ingestion_failures USING BRIN (occurred_at);

COMMIT;


-- ===== Source: database/migrations/logdb/02_ingestion/002_ingestion_fix.sql =====


-- ===== Source: database/migrations/logdb/03_observability_v2/001_events_requests.sql =====
BEGIN;

-- Canonical request telemetry.
-- Range-partitioned by occurred_at for retention pruning and time-window dashboards.

CREATE TABLE IF NOT EXISTS events_requests (
    -- Identity
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID NOT NULL,
    api_key_name TEXT NOT NULL,

    -- Correlation
    event_id TEXT NOT NULL,
    request_id TEXT,
    trace_id TEXT,
    span_id TEXT,
    parent_span_id TEXT,
    session_id TEXT,
    user_id TEXT,
    tenant_id TEXT,

    -- Environment
    environment TEXT,

    -- Request
    endpoint TEXT,
    name TEXT,
    method TEXT,
    status_code INTEGER,
    duration_ms NUMERIC(14,3),
    body_size BIGINT,
    response_size BIGINT,

    -- Trace summary
    span_count INTEGER,
    root_span_status TEXT,
    is_partial BOOLEAN,

    -- Client
    client_ip_hash TEXT,
    user_agent TEXT,
    referer TEXT,

    -- Geo
    geo_country_code CHAR(2),
    geo_region TEXT,
    geo_asn BIGINT,

    -- Device
    browser_family TEXT,
    browser_version_major TEXT,
    os_name TEXT,
    os_version_major TEXT,
    device_type TEXT,
    is_bot BOOLEAN,

    -- Service
    service TEXT,
    framework TEXT,
    release TEXT,
    server_name TEXT,

    -- SDK
    sdk_name TEXT,
    sdk_version TEXT,

    -- Severity
    severity logdb_severity,

    -- Flags
    is_slow BOOLEAN GENERATED ALWAYS AS (COALESCE(duration_ms,0) >= 1000) STORED,
    is_error BOOLEAN GENERATED ALWAYS AS (COALESCE(status_code,0) >= 500) STORED,

    -- Flexible
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- AI
    ai_response JSONB,

    -- Time
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

-- Default partition
CREATE TABLE IF NOT EXISTS events_requests_default
PARTITION OF events_requests
DEFAULT;

-- ============================================================================
-- UNIQUE
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_requests_event_unique
ON events_requests (
    organization_id,
    event_id,
    occurred_at
);

-- ============================================================================
-- TENANT FILTERS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_requests_tenant_time
ON events_requests (
    organization_id,
    project_id,
    occurred_at DESC
);

CREATE INDEX IF NOT EXISTS idx_events_requests_tenant_env_time
ON events_requests (
    organization_id,
    project_id,
    environment,
    occurred_at DESC
);

CREATE INDEX IF NOT EXISTS idx_events_requests_user_time
ON events_requests (
    organization_id,
    project_id,
    user_id,
    occurred_at DESC
)
WHERE user_id IS NOT NULL;

-- ============================================================================
-- TRACE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_requests_trace
ON events_requests (
    trace_id,
    occurred_at DESC
)
WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_service
ON events_requests (
    service,
    occurred_at DESC
)
WHERE service IS NOT NULL;

-- ============================================================================
-- REQUEST FILTERS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_requests_endpoint_time
ON events_requests (
    organization_id,
    project_id,
    endpoint,
    occurred_at DESC
);

CREATE INDEX IF NOT EXISTS idx_events_requests_duration_time
ON events_requests (
    organization_id,
    project_id,
    duration_ms,
    occurred_at DESC
)
WHERE duration_ms IS NOT NULL;

-- ============================================================================
-- JSONB
-- ============================================================================
--
-- No GIN indexes on attributes/metadata/payload/ai_response: these columns
-- are written on every ingested request but never queried via JSONB
-- containment/path operators anywhere in the codebase (the observability
-- query-engine's field registry marks them non-filterable). A broad GIN
-- index tokenizes the whole document on every insert with no offsetting
-- read benefit, so it is intentionally omitted from this hot-path table.
-- See docs/ingestionv2/gin-index-audit.md. Historically these were created
-- and later dropped by 025_request_ingestion_hot_path.sql; that migration
-- remains for deployments migrating forward from an older schema, but a
-- fresh database created from this file never creates them in the first
-- place.

-- ============================================================================
-- BRIN
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_requests_occurred_brin
ON events_requests
USING BRIN (occurred_at);

COMMENT ON TABLE events_requests IS
'Canonical request telemetry. Range-partitioned by occurred_at for retention pruning and dashboard queries.';

COMMIT;

-- ===== Source: database/migrations/logdb/03_observability_v2/002_events_errors.sql =====
BEGIN;

-- ============================================================================
-- Canonical error telemetry
-- ============================================================================

CREATE TABLE IF NOT EXISTS events_errors (
    -- Identity
    id UUID NOT NULL DEFAULT gen_random_uuid(),

    -- Tenant
    organization_id UUID NOT NULL,
    project_id UUID,
    api_key_name TEXT NOT NULL,

    -- Environment
    environment TEXT NOT NULL,

    -- Correlation
    event_id TEXT NOT NULL,
    request_id TEXT,
    trace_id TEXT,
    span_id TEXT,
    parent_span_id TEXT,
    session_id TEXT,
    user_id TEXT,

    -- Error grouping
    fingerprint TEXT,
    error_group_id UUID,

    -- Error classification
    error_name TEXT NOT NULL,
    message TEXT NOT NULL,
    severity logdb_severity NOT NULL,
    mechanism TEXT,
    handled BOOLEAN,

    -- HTTP
    method TEXT,
    route TEXT,
    url TEXT,
    status_code INTEGER,
    status_text TEXT,

    -- Debugging
    stack_frames JSONB,
    breadcrumbs JSONB,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Service
    service TEXT,
    server_name TEXT,
    release TEXT,

    sdk_name TEXT,
    sdk_version TEXT,

    application_name TEXT,
    application_version TEXT,

    -- Extension
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    extra JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_response JSONB,

    -- Time
    occurred_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

-- ============================================================================
-- Default Partition
-- ============================================================================

CREATE TABLE IF NOT EXISTS events_errors_default
PARTITION OF events_errors DEFAULT;

-- ============================================================================
-- Lookup Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_errors_event_id
ON events_errors (
    organization_id,
    event_id,
    occurred_at DESC
);

CREATE INDEX IF NOT EXISTS idx_events_errors_org_project_time
ON events_errors (
    organization_id,
    project_id,
    occurred_at DESC
);

CREATE INDEX IF NOT EXISTS idx_events_errors_org_env_time
ON events_errors (
    organization_id,
    project_id,
    environment,
    occurred_at DESC
);

-- ============================================================================
-- Trace Correlation
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_errors_trace
ON events_errors (
    organization_id,
    trace_id,
    occurred_at DESC
)
WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_span
ON events_errors (
    organization_id,
    span_id,
    occurred_at DESC
)
WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_parent_span
ON events_errors (
    organization_id,
    parent_span_id,
    occurred_at DESC
)
WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_request
ON events_errors (
    organization_id,
    request_id,
    occurred_at DESC
)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_session
ON events_errors (
    organization_id,
    session_id,
    occurred_at DESC
)
WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_user
ON events_errors (
    organization_id,
    user_id,
    occurred_at DESC
)
WHERE user_id IS NOT NULL;

-- ============================================================================
-- Error Grouping
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_errors_group
ON events_errors (
    organization_id,
    error_group_id,
    occurred_at DESC
)
WHERE error_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_fingerprint
ON events_errors (
    organization_id,
    project_id,
    fingerprint,
    occurred_at DESC
)
WHERE fingerprint IS NOT NULL;

-- ============================================================================
-- Filters
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_errors_severity
ON events_errors (
    organization_id,
    project_id,
    severity,
    occurred_at DESC
);

CREATE INDEX IF NOT EXISTS idx_events_errors_status
ON events_errors (
    organization_id,
    project_id,
    status_code,
    occurred_at DESC
)
WHERE status_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_handled
ON events_errors (
    organization_id,
    project_id,
    handled,
    occurred_at DESC
)
WHERE handled IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_service
ON events_errors (
    organization_id,
    project_id,
    service,
    occurred_at DESC
)
WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_route
ON events_errors (
    organization_id,
    project_id,
    route,
    occurred_at DESC
)
WHERE route IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_method
ON events_errors (
    organization_id,
    project_id,
    method,
    occurred_at DESC
)
WHERE method IS NOT NULL;

-- ============================================================================
-- JSONB
-- ============================================================================
--
-- No GIN indexes on context/tags/extra/metadata/payload/ai_response: written
-- on every ingested error but never queried via JSONB containment/path
-- operators anywhere in the codebase. See docs/ingestionv2/gin-index-audit.md.
-- Historically created and later dropped by
-- 031_remaining_jsonb_gin_hot_path.sql; that migration remains for
-- deployments migrating forward from an older schema, but a fresh database
-- created from this file never creates them in the first place.

-- ============================================================================
-- BRIN
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_errors_occurred_brin
ON events_errors
USING BRIN (occurred_at);

COMMENT ON TABLE events_errors IS
'Canonical error telemetry table partitioned by occurred_at for high-volume observability workloads.';

COMMIT;

-- ===== Source: database/migrations/logdb/03_observability_v2/003_events_logs.sql =====
BEGIN;

-- ============================================================================
-- Canonical Log Telemetry
-- Append-heavy and range partitioned by occurred_at.
-- ============================================================================

CREATE TABLE IF NOT EXISTS events_logs (
    -- Identity
    id UUID NOT NULL DEFAULT gen_random_uuid(),

    -- Tenant
    organization_id UUID NOT NULL,
    project_id UUID,
    environment TEXT NOT NULL,
    api_key_name TEXT NOT NULL,

    -- Correlation
    event_id TEXT NOT NULL,
    request_id TEXT,
    trace_id TEXT,
    span_id TEXT,
    parent_span_id TEXT,
    session_id TEXT,
    user_id TEXT,
    tenant_id TEXT,

    -- Log Content
    level TEXT,
    logger TEXT,
    logger_name TEXT,
    log_source TEXT,
    log_category TEXT,
    name TEXT,
    message TEXT,

    args JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- HTTP Context
    endpoint TEXT,
    http_method TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    user_ip INET,

    -- Classification
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Runtime
    service TEXT,
    release TEXT,
    sdk_name TEXT,
    sdk_version TEXT,
    application_name TEXT,
    application_version TEXT,
    server_name TEXT,
    severity logdb_severity,

    -- Flexible
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_response JSONB,

    -- Time
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

-- ============================================================================
-- Default Partition
-- ============================================================================

CREATE TABLE IF NOT EXISTS events_logs_default
PARTITION OF events_logs
DEFAULT;

-- ============================================================================
-- Event Lookup
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_logs_event
ON events_logs (
    organization_id,
    event_id,
    occurred_at DESC
);

-- ============================================================================
-- Tenant / Dashboard Queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_logs_org_project_time
ON events_logs (
    organization_id,
    project_id,
    occurred_at DESC
);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_project_env_time
ON events_logs (
    organization_id,
    project_id,
    environment,
    occurred_at DESC
);

-- ============================================================================
-- Trace Correlation
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_logs_trace
ON events_logs (
    organization_id,
    project_id,
    trace_id,
    occurred_at DESC
)
WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_span
ON events_logs (
    organization_id,
    project_id,
    span_id,
    occurred_at DESC
)
WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_parent_span
ON events_logs (
    organization_id,
    project_id,
    parent_span_id,
    occurred_at DESC
)
WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_request
ON events_logs (
    organization_id,
    project_id,
    request_id,
    occurred_at DESC
)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_session
ON events_logs (
    organization_id,
    project_id,
    session_id,
    occurred_at DESC
)
WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_user
ON events_logs (
    organization_id,
    project_id,
    user_id,
    occurred_at DESC
)
WHERE user_id IS NOT NULL;

-- ============================================================================
-- Log Filters
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_logs_level
ON events_logs (
    organization_id,
    project_id,
    level,
    occurred_at DESC
);

CREATE INDEX IF NOT EXISTS idx_events_logs_logger
ON events_logs (
    organization_id,
    project_id,
    logger,
    occurred_at DESC
)
WHERE logger IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_category
ON events_logs (
    organization_id,
    project_id,
    log_category,
    occurred_at DESC
)
WHERE log_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_endpoint
ON events_logs (
    organization_id,
    project_id,
    endpoint,
    occurred_at DESC
)
WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_service
ON events_logs (
    organization_id,
    project_id,
    service,
    occurred_at DESC
)
WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_severity
ON events_logs (
    organization_id,
    project_id,
    severity,
    occurred_at DESC
);

-- ============================================================================
-- JSONB
-- ============================================================================
--
-- No GIN indexes on context/tags/attributes/metadata/payload/ai_response:
-- written on every ingested log line but never queried via JSONB
-- containment/path operators anywhere in the codebase. See
-- docs/ingestionv2/gin-index-audit.md. Historically created and later
-- dropped by 029_span_log_ingestion_hot_path.sql; that migration remains for
-- deployments migrating forward from an older schema, but a fresh database
-- created from this file never creates them in the first place.

-- ============================================================================
-- Time-Series
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_logs_occurred_brin
ON events_logs
USING BRIN (occurred_at);

-- ============================================================================
-- Validation
-- ============================================================================

ALTER TABLE events_logs
DROP CONSTRAINT IF EXISTS events_logs_log_category_ck,
ADD CONSTRAINT events_logs_log_category_ck
CHECK (
    log_category IS NULL OR
    log_category IN (
        'http',
        'application',
        'database',
        'cache',
        'queue',
        'worker',
        'cron',
        'security',
        'authentication',
        'authorization',
        'business',
        'system',
        'runtime',
        'custom',
        'unknown'
    )
),

DROP CONSTRAINT IF EXISTS events_logs_log_source_ck,
ADD CONSTRAINT events_logs_log_source_ck
CHECK (
    log_source IS NULL OR
    log_source IN (
        'sdk',
        'console',
        'framework',
        'middleware',
        'application',
        'worker',
        'cron',
        'queue',
        'unknown'
    )
);

COMMENT ON TABLE events_logs IS
'Canonical log telemetry table. Range-partitioned by occurred_at for high-volume append workloads and optimized for observability dashboards.';

COMMIT;

-- ===== Source: database/migrations/logdb/03_observability_v2/004_events_metrics.sql =====
BEGIN;

-- Canonical metric telemetry.
-- Range-partitioned by occurred_at for retention pruning and time-series rollups.
CREATE TABLE IF NOT EXISTS events_metrics (
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

  -- Metric identity
  metric_name TEXT,
  metric_type TEXT,
  metric_unit TEXT,
  metric_namespace TEXT,
  metric_description TEXT,
  metric_category TEXT,
  aggregation_type TEXT,
  temporality TEXT,
  is_monotonic BOOLEAN,

  -- Numeric aggregates
  value DOUBLE PRECISION,
  count DOUBLE PRECISION,
  sum DOUBLE PRECISION,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  avg DOUBLE PRECISION,
  rate DOUBLE PRECISION,
  buckets JSONB,
  p50 DOUBLE PRECISION,
  p75 DOUBLE PRECISION,
  p90 DOUBLE PRECISION,
  p95 DOUBLE PRECISION,
  p99 DOUBLE PRECISION,

  -- HTTP context (promoted from tags)
  endpoint TEXT,
  http_method TEXT,
  status_code INTEGER,

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
  duration_ms NUMERIC(14,3),

  -- Flexible storage
  tags JSONB,
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

CREATE TABLE IF NOT EXISTS events_metrics_default PARTITION OF events_metrics DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_metrics_event_unique
  ON events_metrics (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_time
  ON events_metrics (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_env_time
  ON events_metrics (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_project_env_time
  ON events_metrics (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_project_metric_time
  ON events_metrics (project_id, metric_name, occurred_at DESC);

-- Trace / service joins
CREATE INDEX IF NOT EXISTS idx_events_metrics_trace
  ON events_metrics (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_service
  ON events_metrics (service, occurred_at DESC)
  WHERE service IS NOT NULL;

-- Metric-specific filters
CREATE INDEX IF NOT EXISTS idx_events_metrics_name_time
  ON events_metrics (organization_id, project_id, metric_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_name_occurred
  ON events_metrics (metric_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_metric_type_time
  ON events_metrics (organization_id, project_id, metric_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_request_time
  ON events_metrics (organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_endpoint_time
  ON events_metrics (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_http_method_time
  ON events_metrics (organization_id, project_id, http_method, occurred_at DESC)
  WHERE http_method IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_id_time
  ON events_metrics (organization_id, project_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_metrics_category_time
  ON events_metrics (organization_id, project_id, metric_category, occurred_at DESC)
  WHERE metric_category IS NOT NULL;

-- JSONB search
-- No GIN indexes on attributes/metadata/payload/ai_response: written on
-- every ingested metric but never queried via JSONB containment/path
-- operators anywhere in the codebase. See docs/ingestionv2/gin-index-audit.md.
-- Historically created and later dropped by
-- 031_remaining_jsonb_gin_hot_path.sql; that migration remains for
-- deployments migrating forward from an older schema, but a fresh database
-- created from this file never creates them in the first place.

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_metrics_occurred_brin
  ON events_metrics USING BRIN (occurred_at);

-- Controlled vocabularies
ALTER TABLE events_metrics
  DROP CONSTRAINT IF EXISTS events_metrics_metric_category_ck,
  ADD CONSTRAINT events_metrics_metric_category_ck
    CHECK (metric_category IS NULL OR metric_category IN (
      'http', 'database', 'cache', 'queue', 'runtime', 'system', 'business', 'application',
      'network', 'memory', 'cpu', 'disk', 'custom'
    )),
  DROP CONSTRAINT IF EXISTS events_metrics_aggregation_type_ck,
  ADD CONSTRAINT events_metrics_aggregation_type_ck
    CHECK (aggregation_type IS NULL OR aggregation_type IN (
      'counter', 'gauge', 'histogram', 'summary',
      'observable_counter', 'observable_gauge', 'up_down_counter'
    )),
  DROP CONSTRAINT IF EXISTS events_metrics_temporality_ck,
  ADD CONSTRAINT events_metrics_temporality_ck
    CHECK (temporality IS NULL OR temporality IN ('delta', 'cumulative', 'unspecified'));

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/005_events_spans.sql =====
BEGIN;

-- Canonical span telemetry.
-- Range-partitioned by occurred_at; each row is one span within a trace.
CREATE TABLE IF NOT EXISTS events_spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,

  -- Identity & correlation
  event_id TEXT NOT NULL,
  span_id TEXT,
  trace_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  request_id TEXT,

  -- Span identity
  span_kind TEXT,
  span_type TEXT,
  span_status TEXT,
  is_root_span BOOLEAN,
  is_http_span BOOLEAN,
  is_db_span BOOLEAN,
  is_cache_span BOOLEAN,
  is_messaging_span BOOLEAN,
  name TEXT,
  message TEXT,
  endpoint TEXT,
  depth INTEGER,

  -- Timelines
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms NUMERIC(14,3),
  exclusive_duration_ms NUMERIC(14,3),
  status_code INTEGER,

  -- HTTP context
  http_method TEXT,
  http_route TEXT,
  http_url TEXT,
  http_target TEXT,
  http_host TEXT,
  http_scheme TEXT,
  http_flavor TEXT,
  http_status_code INTEGER,
  http_status_text TEXT,
  http_response_size BIGINT,
  http_user_agent TEXT,
  client_ip_hash TEXT,

  -- Network context
  net_transport TEXT,
  net_host_name TEXT,
  net_host_ip TEXT,
  net_host_port INTEGER,
  net_peer_ip TEXT,
  net_peer_port INTEGER,

  -- Database context
  db_system TEXT,
  db_name TEXT,
  db_operation TEXT,
  db_collection TEXT,
  db_statement TEXT,

  -- Messaging context
  messaging_system TEXT,
  messaging_destination TEXT,
  messaging_operation TEXT,

  -- Events / links arrays
  events JSONB,
  links JSONB,

  -- SDK / service context
  service TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  application_name TEXT,
  application_version TEXT,
  server_name TEXT,
  severity logdb_severity,

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

CREATE TABLE IF NOT EXISTS events_spans_default PARTITION OF events_spans DEFAULT;

-- Unique event guard (event_id is composite for spans: event_id + span_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_spans_event_unique
  ON events_spans (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_spans_tenant_time
  ON events_spans (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_spans_tenant_env_time
  ON events_spans (organization_id, project_id, environment, occurred_at DESC);

-- Trace hierarchy
CREATE INDEX IF NOT EXISTS idx_events_spans_trace_time
  ON events_spans (organization_id, project_id, trace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_spans_span_id
  ON events_spans (organization_id, project_id, span_id)
  WHERE span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_parent_time
  ON events_spans (organization_id, project_id, trace_id, parent_span_id, start_time)
  WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_depth
  ON events_spans (organization_id, project_id, trace_id, depth)
  WHERE depth IS NOT NULL;

-- Request / endpoint / type filters
CREATE INDEX IF NOT EXISTS idx_events_spans_request_time
  ON events_spans (organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_endpoint_time
  ON events_spans (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_type_time
  ON events_spans (organization_id, project_id, span_type, occurred_at DESC)
  WHERE span_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_span_kind_time
  ON events_spans (organization_id, project_id, span_kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_spans_http_method_time
  ON events_spans (organization_id, project_id, http_method, occurred_at DESC)
  WHERE http_method IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_http_status_time
  ON events_spans (organization_id, project_id, http_status_code, occurred_at DESC)
  WHERE http_status_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_db_system_time
  ON events_spans (organization_id, project_id, db_system, occurred_at DESC)
  WHERE db_system IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_tenant_id_time
  ON events_spans (organization_id, project_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

-- JSONB search
-- No GIN indexes on attributes/metadata/payload/ai_response: written on
-- every ingested span but never queried via JSONB containment/path
-- operators anywhere in the codebase. See docs/ingestionv2/gin-index-audit.md.
-- Historically created and later dropped by
-- 029_span_log_ingestion_hot_path.sql; that migration remains for
-- deployments migrating forward from an older schema, but a fresh database
-- created from this file never creates them in the first place.

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_spans_occurred_brin
  ON events_spans USING BRIN (occurred_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/006_events_traces.sql =====
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


-- ===== Source: database/migrations/logdb/03_observability_v2/007_events_messages.sql =====
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
-- No GIN indexes on attributes/metadata/payload/ai_response: written on
-- every ingested message but never queried via JSONB containment/path
-- operators anywhere in the codebase. See docs/ingestionv2/gin-index-audit.md.
-- Historically created and later dropped by
-- 031_remaining_jsonb_gin_hot_path.sql; that migration remains for
-- deployments migrating forward from an older schema, but a fresh database
-- created from this file never creates them in the first place.

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_messages_occurred_brin
  ON events_messages USING BRIN (occurred_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/008_events_profiles.sql =====
BEGIN;

-- Canonical profile telemetry (CPU/memory performance profiles).
-- Range-partitioned by occurred_at for retention pruning.
CREATE TABLE IF NOT EXISTS events_profiles (
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
-- No GIN indexes on attributes/metadata/payload/ai_response: written on
-- every ingested profile but never queried via JSONB containment/path
-- operators anywhere in the codebase. See docs/ingestionv2/gin-index-audit.md.
-- Historically created and later dropped by
-- 031_remaining_jsonb_gin_hot_path.sql; that migration remains for
-- deployments migrating forward from an older schema, but a fresh database
-- created from this file never creates them in the first place.

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_profiles_occurred_brin
  ON events_profiles USING BRIN (occurred_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/009_events_replays.sql =====
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
-- No GIN indexes on attributes/metadata/payload/ai_response: written on
-- every ingested replay segment but never queried via JSONB
-- containment/path operators anywhere in the codebase. See
-- docs/ingestionv2/gin-index-audit.md. Historically created and later
-- dropped by 031_remaining_jsonb_gin_hot_path.sql; that migration remains
-- for deployments migrating forward from an older schema, but a fresh
-- database created from this file never creates them in the first place.

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_replays_occurred_brin
  ON events_replays USING BRIN (occurred_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/010_events_cron_checkins.sql =====
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


-- ===== Source: database/migrations/logdb/03_observability_v2/011_error_groups.sql =====
BEGIN;

-- Error grouping table.
-- Mutable projection rebuilt from events_errors; unique per project + fingerprint.
CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  occurrence_count BIGINT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_event_id VARCHAR(64) NOT NULL,
  latest_event_id VARCHAR(64) NOT NULL,
  highest_severity VARCHAR(16) NOT NULL,
  latest_severity VARCHAR(16) NOT NULL,

  -- Regression tracking
  is_regression BOOLEAN NOT NULL DEFAULT FALSE,
  regression_count INTEGER NOT NULL DEFAULT 0,
  last_regressed_at TIMESTAMPTZ,

  -- Snapshot
  latest_release VARCHAR(100),
  latest_sdk_version VARCHAR(50),
  latest_application_version VARCHAR(50),
  last_error_message TEXT,
  last_error_name VARCHAR(255),
  last_status_code INTEGER,
  last_trace_id VARCHAR(64),
  last_request_id VARCHAR(64),

  -- Merge support
  merged_into UUID NULL,
  is_merged BOOLEAN NOT NULL DEFAULT FALSE,

  -- Optimistic locking
  version INTEGER NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_error_groups_project_fingerprint UNIQUE (project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_project_status_last_seen
  ON error_groups (project_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_project_occurrence
  ON error_groups (project_id, occurrence_count DESC);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/012_error_group_history.sql =====
BEGIN;

-- Audit history for error_group changes (status, merge, regression, etc.).
CREATE TABLE IF NOT EXISTS error_group_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  action VARCHAR(64) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  actor_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_group_history_group_id
  ON error_group_history (group_id, created_at DESC);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/013_ingestion_queue_snapshot.sql =====
BEGIN;

-- Ingestion queue snapshot.
-- Captures queue depth / worker counts at a point in time for ingestion health dashboards.
CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pending_count BIGINT NOT NULL DEFAULT 0,
  active_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  oldest_pending_at TIMESTAMPTZ,
  worker_count INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot_default PARTITION OF ingestion_queue_snapshot DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_queue_time
  ON ingestion_queue_snapshot (queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_brin
  ON ingestion_queue_snapshot USING BRIN (captured_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/014_ingestion_metrics.sql =====
BEGIN;

-- Ingestion runtime metrics.
-- Custom ingestion counters / gauges submitted by ingestion workers.
CREATE TABLE IF NOT EXISTS ingestion_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(18,6) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_metrics_default PARTITION OF ingestion_metrics DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_name_time
  ON ingestion_metrics (metric_name, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_dimensions_gin
  ON ingestion_metrics USING GIN (dimensions);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_brin
  ON ingestion_metrics USING BRIN (captured_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/015_worker_performance.sql =====
BEGIN;

-- Worker performance telemetry.
-- Captures throughput, latency percentiles, and resource usage per worker.
CREATE TABLE IF NOT EXISTS worker_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  queue TEXT NOT NULL,
  processed_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  avg_duration_ms NUMERIC(12,3),
  p95_duration_ms NUMERIC(12,3),
  memory_mb NUMERIC(12,3),
  cpu_percent NUMERIC(6,3),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS worker_performance_default PARTITION OF worker_performance DEFAULT;

CREATE INDEX IF NOT EXISTS idx_worker_performance_worker_time
  ON worker_performance (worker_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_performance_brin
  ON worker_performance USING BRIN (captured_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/016_backpressure_gauge.sql =====
BEGIN;

-- Backpressure gauge.
-- Score + reason for ingestion backpressure events.
CREATE TABLE IF NOT EXISTS backpressure_gauge (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pressure_score NUMERIC(8,4) NOT NULL CHECK (pressure_score >= 0),
  reason TEXT,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS backpressure_gauge_default PARTITION OF backpressure_gauge DEFAULT;

CREATE INDEX IF NOT EXISTS idx_backpressure_queue_time
  ON backpressure_gauge (queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_backpressure_brin
  ON backpressure_gauge USING BRIN (captured_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/017_ingestion_failures.sql =====
BEGIN;

-- Ingestion failures.
-- Records events that failed ingest-time validation / parsing.
CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_id UUID,
  event_type TEXT,
  error_code TEXT NOT NULL,
  error_message TEXT,
  payload JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT ingestion_failures_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ingestion_failures_default PARTITION OF ingestion_failures DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ingestion_failures_tenant_env_time
  ON ingestion_failures (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_error_time
  ON ingestion_failures (error_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_payload_gin
  ON ingestion_failures USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_brin
  ON ingestion_failures USING BRIN (occurred_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/018_events_errors_idempotency.sql =====
BEGIN;

-- Unique event guard for idempotent error ingestion.
-- Matches the ON CONFLICT (organization_id, event_id, occurred_at) clause used by ErrorRepository.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_errors_event_unique
  ON events_errors (organization_id, event_id, occurred_at);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/019_observability_query_contract.sql =====
BEGIN;

-- Observability query-contract hardening.
-- These indexes support the server-resolved organization/project scope used by
-- the explorer, error-group history, replay, and session read paths.

CREATE INDEX IF NOT EXISTS idx_error_groups_org_project_status_seen
  ON error_groups (organization_id, project_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_groups_org_project_occurrence
  ON error_groups (organization_id, project_id, occurrence_count DESC);

CREATE INDEX IF NOT EXISTS idx_error_group_history_org_group_created
  ON error_group_history (group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_org_project_session_time
  ON events_replays (organization_id, project_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

INSERT INTO logdb_schema_notes(subject, decision)
VALUES (
  'observability_query_contract',
  'Observability explorer reads use canonical occurredAt/durationMs/statusCode names, reject client project scope, resolve visible projects server-side, use explicit projections, signed scope-bound cursors, and fail closed when the authorized project set is empty.'
)
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/020_error_groups_lifecycle_redesign.sql =====
BEGIN;

-- Error groups v2: lifecycle state is authoritative in error_groups. Regression
-- is represented by history/outbox events and always reopens the group to OPEN.
ALTER TABLE error_groups
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_release VARCHAR(100),
  ADD COLUMN IF NOT EXISTS fingerprint_version SMALLINT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS latest_event_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS latest_environment VARCHAR(64),
  ADD COLUMN IF NOT EXISTS latest_service VARCHAR(100);

ALTER TABLE events_errors
  ADD COLUMN IF NOT EXISTS fingerprint_version SMALLINT NOT NULL DEFAULT 1;

UPDATE error_groups
   SET status = CASE WHEN UPPER(status) = 'REGRESSED' THEN 'OPEN' ELSE UPPER(status) END,
       is_regression = FALSE,
       updated_at = NOW()
 WHERE status IS NOT NULL;

ALTER TABLE error_groups
  DROP CONSTRAINT IF EXISTS error_groups_status_ck,
  ADD CONSTRAINT error_groups_status_ck
    CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED', 'ARCHIVED'));

ALTER TABLE error_group_history
  ADD COLUMN IF NOT EXISTS previous_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS new_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS event_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS release VARCHAR(100),
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS source_group_id UUID,
  ADD COLUMN IF NOT EXISTS target_group_id UUID;

ALTER TABLE error_group_history
  DROP CONSTRAINT IF EXISTS error_group_history_status_ck,
  ADD CONSTRAINT error_group_history_status_ck CHECK (
    (previous_status IS NULL OR previous_status IN ('OPEN', 'RESOLVED', 'IGNORED', 'ARCHIVED'))
    AND (new_status IS NULL OR new_status IN ('OPEN', 'RESOLVED', 'IGNORED', 'ARCHIVED'))
  );

CREATE INDEX IF NOT EXISTS idx_error_groups_org_project_status_seen_v2
  ON error_groups (organization_id, project_id, status, last_seen_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_project_fingerprint_v2
  ON error_groups (project_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_groups_merged_into_v2
  ON error_groups (project_id, merged_into)
  WHERE merged_into IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_error_groups_resolved_release_v2
  ON error_groups (project_id, resolved_release, resolved_at)
  WHERE status = 'RESOLVED';
CREATE INDEX IF NOT EXISTS idx_error_group_history_group_created_v2
  ON error_group_history (group_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_error_group_history_event_v2
  ON error_group_history (event_id)
  WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_errors_group_time_v2
  ON events_errors (organization_id, project_id, error_group_id, occurred_at DESC)
  WHERE error_group_id IS NOT NULL;

COMMENT ON TABLE error_groups IS
  'Authoritative mutable error-group lifecycle projection. Regression is an event, never a status.';

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/021_public_ids.sql =====
BEGIN;

-- ============================================================================
-- 1. SEQUENCES FOR PUBLIC ID GENERATION
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS seq_pubid_requests START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_errors START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_error_groups START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_traces START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_spans START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_logs START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_metrics START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_messages START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_replays START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_profiles START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_cron_checkins START WITH 1 INCREMENT BY 1;

-- ============================================================================
-- 2. ALTER TABLES TO ADD PUBLIC_ID COLUMN WITH DEFAULT SEQUENCE
-- ============================================================================

-- 2.1 events_requests (REQ)
ALTER TABLE events_requests
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0'));

-- 2.2 events_errors (ERR)
ALTER TABLE events_errors
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0'));

-- 2.3 error_groups / analytics_error_groups (ISS)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    ALTER TABLE error_groups
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0'));
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    ALTER TABLE analytics_error_groups
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0'));
  END IF;
END $$;

-- 2.4 events_traces (TRC)
ALTER TABLE events_traces
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0'));

-- 2.5 events_spans (SPN)
ALTER TABLE events_spans
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0'));

-- 2.6 events_logs (LOG)
ALTER TABLE events_logs
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0'));

-- 2.7 events_metrics (MTR)
ALTER TABLE events_metrics
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0'));

-- 2.8 events_messages (MSG)
ALTER TABLE events_messages
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0'));

-- 2.9 events_replays (RPL)
ALTER TABLE events_replays
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0'));

-- 2.10 events_profiles (PRF)
ALTER TABLE events_profiles
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0'));

-- 2.11 events_cron_checkins (CRN)
ALTER TABLE events_cron_checkins
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0'));

-- ============================================================================
-- 3. INDEXES FOR PUBLIC ID LOOKUPS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_requests_pubid
    ON events_requests (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_errors_pubid
    ON events_errors (organization_id, project_id, public_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    CREATE INDEX IF NOT EXISTS idx_error_groups_pubid
      ON error_groups (organization_id, project_id, public_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_pubid
      ON analytics_error_groups (organization_id, project_id, public_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_traces_pubid
    ON events_traces (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_spans_pubid
    ON events_spans (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_logs_pubid
    ON events_logs (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_metrics_pubid
    ON events_metrics (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_messages_pubid
    ON events_messages (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_replays_pubid
    ON events_replays (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_profiles_pubid
    ON events_profiles (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_pubid
    ON events_cron_checkins (organization_id, project_id, public_id);

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/022_public_ids_and_trigger_guarantee.sql =====
BEGIN;

-- ============================================================================
-- 1. ENSURE ALL SEQUENCES EXIST
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS seq_pubid_requests START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_errors START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_error_groups START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_traces START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_spans START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_logs START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_metrics START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_messages START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_replays START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_profiles START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_cron_checkins START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_sessions START WITH 1 INCREMENT BY 1;

-- ============================================================================
-- 2. ENSURE ALL TABLES HAVE PUBLIC_ID COLUMN WITH DEFAULT
-- ============================================================================

-- 2.1 events_requests
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_requests') THEN
    ALTER TABLE events_requests
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_requests_pubid ON events_requests (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.2 events_errors
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_errors') THEN
    ALTER TABLE events_errors
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_errors_pubid ON events_errors (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.3 events_traces
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_traces') THEN
    ALTER TABLE events_traces
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_traces_pubid ON events_traces (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.4 events_spans
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_spans') THEN
    ALTER TABLE events_spans
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_spans_pubid ON events_spans (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.5 events_logs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_logs') THEN
    ALTER TABLE events_logs
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_logs_pubid ON events_logs (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.6 events_metrics
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_metrics') THEN
    ALTER TABLE events_metrics
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_metrics_pubid ON events_metrics (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.7 events_messages
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_messages') THEN
    ALTER TABLE events_messages
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_messages_pubid ON events_messages (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.8 events_replays
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_replays') THEN
    ALTER TABLE events_replays
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_replays_pubid ON events_replays (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.9 events_profiles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_profiles') THEN
    ALTER TABLE events_profiles
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_profiles_pubid ON events_profiles (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.10 events_cron_checkins
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_cron_checkins') THEN
    ALTER TABLE events_cron_checkins
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_pubid ON events_cron_checkins (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.11 analytics_error_groups / error_groups
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    ALTER TABLE analytics_error_groups
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_pubid ON analytics_error_groups (organization_id, project_id, public_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    ALTER TABLE error_groups
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_error_groups_pubid ON error_groups (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.12 analytics_user_sessions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_user_sessions') THEN
    ALTER TABLE analytics_user_sessions
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('SES-' || lpad(nextval('seq_pubid_sessions')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_analytics_user_sessions_pubid ON analytics_user_sessions (organization_id, public_id);
  END IF;
END $$;

-- ============================================================================
-- 3. TRIGGER FUNCTIONS WITH GUARANTEED AUTO-INSERT FOR PUBLIC_ID
-- ============================================================================

-- 3.1 Main Typed Events Contract Function
CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  -- 1. Sync timestamps
  NEW.occurred_at := COALESCE(NEW.occurred_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);

  -- 2. Lock metadata environment
  NEW.metadata := jsonb_set(
    CASE WHEN jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) = 'object'
      THEN COALESCE(NEW.metadata, '{}'::jsonb) ELSE '{}'::jsonb END,
    '{environment}', to_jsonb(NEW.environment), true
  );

  -- 3. Auto-generate public_id if not present or empty
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    IF TG_TABLE_NAME LIKE 'events_requests%' THEN
      NEW.public_id := 'REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_errors%' THEN
      NEW.public_id := 'ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_traces%' THEN
      NEW.public_id := 'TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_spans%' THEN
      NEW.public_id := 'SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_logs%' THEN
      NEW.public_id := 'LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_metrics%' THEN
      NEW.public_id := 'MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_messages%' THEN
      NEW.public_id := 'MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_replays%' THEN
      NEW.public_id := 'RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_profiles%' THEN
      NEW.public_id := 'PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_cron_checkins%' THEN
      NEW.public_id := 'CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0');
    END IF;
  END IF;

  -- 4. Fallback payload
  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW) - 'payload' - 'attributes' - 'metadata' - 'ai_response';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3.2 Error Groups Public ID Contract Function
CREATE OR REPLACE FUNCTION logdb_sync_error_groups_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3.3 User Sessions Public ID Contract Function
CREATE OR REPLACE FUNCTION logdb_sync_user_sessions_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'SES-' || lpad(nextval('seq_pubid_sessions')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply typed events trigger to all canonical event tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests',
    'events_errors',
    'events_logs',
    'events_metrics',
    'events_spans',
    'events_traces',
    'events_messages',
    'events_profiles',
    'events_replays',
    'events_cron_checkins'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_sync_typed_event_contract BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION logdb_sync_typed_event_contract()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Apply error groups trigger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON analytics_error_groups;
    CREATE TRIGGER trg_sync_error_groups_contract BEFORE INSERT OR UPDATE ON analytics_error_groups FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON error_groups;
    CREATE TRIGGER trg_sync_error_groups_contract BEFORE INSERT OR UPDATE ON error_groups FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();
  END IF;
END $$;

-- Apply user sessions trigger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_user_sessions') THEN
    DROP TRIGGER IF EXISTS trg_sync_user_sessions_contract ON analytics_user_sessions;
    CREATE TRIGGER trg_sync_user_sessions_contract BEFORE INSERT OR UPDATE ON analytics_user_sessions FOR EACH ROW EXECUTE FUNCTION logdb_sync_user_sessions_contract();
  END IF;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/023_fix_error_groups_trigger_contract.sql =====
BEGIN;

-- ============================================================================
-- Fix LogDB error_groups trigger contract
-- Removes erroneous typed event trigger (logdb_sync_typed_event_contract)
-- from error_groups and analytics_error_groups, ensuring they only use
-- logdb_sync_error_groups_contract to avoid "no field occurred_at" error (42703).
-- ============================================================================

-- 1. Ensure error_groups public ID sequence exists
CREATE SEQUENCE IF NOT EXISTS seq_pubid_error_groups START 1;

-- 2. Drop the typed-event trigger from non-typed event tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON error_groups;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON analytics_error_groups;
  END IF;
END $$;

-- 3. Ensure dedicated error groups contract function exists and assigns ISS-... public_id
CREATE OR REPLACE FUNCTION logdb_sync_error_groups_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach dedicated error groups trigger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON error_groups;
    CREATE TRIGGER trg_sync_error_groups_contract
      BEFORE INSERT OR UPDATE ON error_groups
      FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON analytics_error_groups;
  END IF;
END $$;

-- 5. Re-apply typed-event trigger ONLY to actual typed event tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests',
    'events_errors',
    'events_logs',
    'events_metrics',
    'events_spans',
    'events_traces',
    'events_messages',
    'events_profiles',
    'events_replays',
    'events_cron_checkins'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_sync_typed_event_contract BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION logdb_sync_typed_event_contract()',
        t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/024_drop_analytics_error_groups_trigger.sql =====
BEGIN;

-- Drop trg_sync_error_groups_contract from analytics_error_groups since it does not have a public_id column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON analytics_error_groups;
  END IF;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/025_request_ingestion_hot_path.sql =====
-- ============================================================================
-- Request ingestion hot-path optimization
--
-- Production profiling showed request batches spending most time inside
-- INSERT/COMMIT even for tiny batches. The request table had several broad
-- JSONB GIN indexes and a trigger that rewrote metadata on every row even
-- though the writer already supplies normalized metadata and payload.
--
-- Keep tenant/time/explorer indexes, but remove broad JSON document indexes
-- from the synchronous insert path. events_requests is partitioned, so these
-- named indexes are partitioned parent indexes and PostgreSQL does not allow
-- dropping them CONCURRENTLY.
-- ============================================================================

DROP INDEX IF EXISTS idx_events_requests_payload_gin;
DROP INDEX IF EXISTS idx_events_requests_ai_response_gin;
DROP INDEX IF EXISTS idx_events_requests_metadata_gin;
DROP INDEX IF EXISTS idx_events_requests_attributes_gin;


-- ===== Source: database/migrations/logdb/03_observability_v2/026_fast_typed_event_contract.sql =====
BEGIN;

-- ============================================================================
-- Fast typed-event contract trigger
--
-- The ingestion writer already supplies occurred_at, metadata.environment, and
-- the raw SDK payload. Keep direct-SQL safety, but avoid rewriting JSONB values
-- on the normal hot path.
-- ============================================================================

CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  -- Timestamp columns are already supplied by the writer/defaults on the hot
  -- path. These COALESCE checks preserve legacy/direct insert safety without
  -- changing valid writer-provided values.
  NEW.occurred_at := COALESCE(NEW.occurred_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);

  -- Avoid jsonb_set() and a full JSONB rewrite when metadata.environment is
  -- already correct.
  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) <> 'object' THEN
    NEW.metadata := jsonb_build_object('environment', NEW.environment);
  ELSIF NEW.metadata->>'environment' IS DISTINCT FROM NEW.environment THEN
    NEW.metadata := jsonb_set(NEW.metadata, '{environment}', to_jsonb(NEW.environment), true);
  END IF;

  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    IF TG_TABLE_NAME LIKE 'events_requests%' THEN
      NEW.public_id := 'REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_errors%' THEN
      NEW.public_id := 'ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_traces%' THEN
      NEW.public_id := 'TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_spans%' THEN
      NEW.public_id := 'SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_logs%' THEN
      NEW.public_id := 'LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_metrics%' THEN
      NEW.public_id := 'MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_messages%' THEN
      NEW.public_id := 'MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_replays%' THEN
      NEW.public_id := 'RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_profiles%' THEN
      NEW.public_id := 'PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_cron_checkins%' THEN
      NEW.public_id := 'CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0');
    END IF;
  END IF;

  -- The ingestion writer supplies payload. Keep fallback only for direct SQL
  -- inserts and older callers.
  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW) - 'payload' - 'attributes' - 'metadata' - 'ai_response';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/027_ingest_queue_notify_partition_defaults.sql =====
BEGIN;

-- ============================================================================
-- pg-boss ingest queue latency defaults
--
-- New queue creation now requests partition=true and notify=true. Existing
-- queues cannot safely change partitioning through pg-boss while jobs may be
-- present, but enabling notify is safe and lets producers wake workers without
-- waiting for the next polling interval when LISTEN/NOTIFY is available.
-- ============================================================================

DO $$
DECLARE
  q text;
BEGIN
  IF to_regclass('pgboss.queue') IS NULL THEN
    RETURN;
  END IF;

  FOREACH q IN ARRAY ARRAY[
    'ingest.error',
    'ingest.message',
    'ingest.request',
    'ingest.span',
    'ingest.trace',
    'ingest.metric',
    'ingest.log',
    'ingest.profile',
    'ingest.cron_checkin',
    'ingest.replay',
    'ingest.dlq-intake'
  ] LOOP
    UPDATE pgboss.queue
       SET notify = true,
           updated_on = now()
     WHERE name = q;

    IF EXISTS (
      SELECT 1
      FROM pgboss.queue
      WHERE name = q
        AND partition = false
    ) THEN
      RAISE NOTICE 'pg-boss ingest queue % is not partitioned. Drain and recreate this queue, or rebuild it during a maintenance window, to isolate it from pgboss.job_common.', q;
    END IF;
  END LOOP;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/028_request_ingestion_minimal_indexes.sql =====
-- Minimize events_requests write amplification for the ingestion hot path.
--
-- Keep:
--   - idx_events_requests_event_unique: idempotency / at-least-once delivery
--   - idx_events_requests_tenant_time: primary tenant timeline access path
--   - idx_events_requests_occurred_brin: cheap time pruning for append-heavy data
--   - idx_events_requests_pubid: public event lookup contract
--
-- Drop high-cardinality dashboard/convenience indexes that add one btree
-- maintenance operation per inserted request row. Query paths that need these
-- dimensions should use rollups, BRIN/time-bounded scans, or a deliberately
-- reintroduced narrow index backed by EXPLAIN evidence.
--
-- events_requests is partitioned, so these names refer to partitioned parent
-- indexes. PostgreSQL rejects DROP INDEX CONCURRENTLY for partitioned indexes.

DROP INDEX IF EXISTS idx_events_requests_tenant_env_time;
DROP INDEX IF EXISTS idx_events_requests_user_time;
DROP INDEX IF EXISTS idx_events_requests_trace;
DROP INDEX IF EXISTS idx_events_requests_service;
DROP INDEX IF EXISTS idx_events_requests_endpoint_time;
DROP INDEX IF EXISTS idx_events_requests_duration_time;
DROP INDEX IF EXISTS idx_events_requests_geo_time;
DROP INDEX IF EXISTS idx_events_requests_release_time;
DROP INDEX IF EXISTS idx_events_requests_session_time;
DROP INDEX IF EXISTS idx_events_requests_sdk_time;


-- ===== Source: database/migrations/logdb/03_observability_v2/029_span_log_ingestion_hot_path.sql =====
-- Minimize span/log write amplification for the ingestion hot path.
--
-- events_spans and events_logs are range-partitioned by occurred_at. These
-- names are partitioned parent indexes, so PostgreSQL does not allow
-- DROP INDEX CONCURRENTLY here.
--
-- Keep the typed-column indexes used by trace hierarchy, request correlation,
-- severity, endpoint, service, and time-window reads. Drop broad JSONB GIN
-- indexes that tokenize large documents on every inserted span/log row and
-- have no current production query path in this repo using JSONB containment.

DROP INDEX IF EXISTS idx_events_spans_attributes_gin;
DROP INDEX IF EXISTS idx_events_spans_metadata_gin;
DROP INDEX IF EXISTS idx_events_spans_payload_gin;
DROP INDEX IF EXISTS idx_events_spans_ai_response_gin;

DROP INDEX IF EXISTS idx_events_logs_context_gin;
DROP INDEX IF EXISTS idx_events_logs_tags_gin;
DROP INDEX IF EXISTS idx_events_logs_attributes_gin;
DROP INDEX IF EXISTS idx_events_logs_metadata_gin;
DROP INDEX IF EXISTS idx_events_logs_payload_gin;
DROP INDEX IF EXISTS idx_events_logs_ai_response_gin;


-- ===== Source: database/migrations/logdb/03_observability_v2/030_events_logs_idempotency.up.sql =====
BEGIN;

-- codex-logdb-migration: requires-operator-drain

-- Add the retry identity guard missing from events_logs.
--
-- Identity scope matches deterministicEventId(): organization, project and
-- environment identify the tenant stream; event_id identifies the SDK event;
-- occurred_at is required by PostgreSQL because events_logs is range
-- partitioned on that column.
--
-- SAFETY: CREATE INDEX on a partitioned parent is non-concurrent. A populated
-- table therefore requires an explicit operator assertion that ingestion is
-- drained. Automatic worker startup recognizes the directive above and
-- defers this file without scanning, DDL, or a ledger insert. Explicit operator
-- execution still fails before duplicate scanning or DDL without the session
-- assertion. Empty/fresh databases may proceed in operator mode without it.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  table_has_rows BOOLEAN;
  duplicate_groups BIGINT;
  surplus_rows BIGINT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM events_logs LIMIT 1)
    INTO table_has_rows;

  IF table_has_rows
     AND COALESCE(
       current_setting('pulse.events_logs_identity_drain_confirmed', true),
       ''
     ) <> 'on' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'events_logs identity migration requires a confirmed ingestion drain',
      DETAIL = 'No duplicate scan or index DDL was executed.',
      HINT = 'Stop ingestion producers and workers, drain active writes, then set pulse.events_logs_identity_drain_confirmed=on for this migration session.';
  END IF;

  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(group_size - 1), 0)::BIGINT
  INTO duplicate_groups, surplus_rows
  FROM (
    SELECT COUNT(*)::BIGINT AS group_size
    FROM events_logs
    GROUP BY organization_id, project_id, environment, event_id, occurred_at
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'events_logs scoped identity preflight failed: %s duplicate group(s), %s surplus row(s)',
        duplicate_groups,
        surplus_rows
      ),
      DETAIL = 'No rows were deleted and the unique index was not created.',
      HINT = 'Archive and remediate only exact scoped duplicates, re-run the preflight, then retry while ingestion remains drained.';
  END IF;
END
$$;

-- Keep the existing non-unique idx_events_logs_event lookup index. Its removal
-- requires separate query-plan and observation-window evidence.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_logs_event_unique
  ON events_logs (
    organization_id,
    project_id,
    environment,
    event_id,
    occurred_at
  );

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/031_remaining_jsonb_gin_hot_path.sql =====
BEGIN;

-- ============================================================================
-- Remove remaining unused JSONB GIN indexes from the ingestion hot path.
--
-- 025_request_ingestion_hot_path.sql and 029_span_log_ingestion_hot_path.sql
-- already dropped the equivalent broad attributes/metadata/payload/ai_response
-- (and context/tags/extra) GIN indexes on events_requests, events_spans, and
-- events_logs, because production profiling showed batch INSERT/COMMIT time
-- dominated by JSONB document tokenization on every inserted row, and a
-- repo-wide audit found no query path anywhere (observability explorer,
-- analytics-engine rollups, alerting evaluator, AI investigation context)
-- that issues a JSONB containment/path query (`@>`, `->`, `->>`, `?`,
-- jsonb_path_query) against these columns on ANY events_* table. The
-- observability query-engine's own field registry marks every one of these
-- columns non-filterable (`filterable: false`), so the explorer layer cannot
-- even generate a predicate against them.
--
-- The remaining events_* tables (errors, metrics, traces, messages, profiles,
-- replays, cron_checkins) still carried the same class of GIN index and were
-- missed by that earlier remediation. This migration closes that gap.
--
-- What is NOT changed:
--   - The metadata/payload/attributes/ai_response (and context/tags/extra)
--     COLUMNS themselves are untouched. They are still written by the
--     ingestion writer and still read back verbatim for the request/error
--     detail "raw event" / developer-tools views
--     (src/modules/observability/request-detail.ts,
--      src/modules/observability/error-detail.ts). Only the GIN indexes -
--     write-path overhead with no matching read path - are removed.
--   - Tenant/time/correlation btree indexes, unique event-identity indexes,
--     and BRIN time-scan indexes on every table are untouched.
--
-- These tables are range-partitioned by occurred_at, so these names refer to
-- partitioned parent indexes; PostgreSQL rejects DROP INDEX CONCURRENTLY for
-- partitioned indexes (same constraint documented in 025/029), so this runs
-- as a normal transactional DROP like its predecessors.
-- ============================================================================

-- events_errors (002_events_errors.sql)
DROP INDEX IF EXISTS idx_events_errors_context_gin;
DROP INDEX IF EXISTS idx_events_errors_tags_gin;
DROP INDEX IF EXISTS idx_events_errors_extra_gin;
DROP INDEX IF EXISTS idx_events_errors_metadata_gin;
DROP INDEX IF EXISTS idx_events_errors_payload_gin;
DROP INDEX IF EXISTS idx_events_errors_ai_response_gin;

-- events_metrics (004_events_metrics.sql)
DROP INDEX IF EXISTS idx_events_metrics_attributes_gin;
DROP INDEX IF EXISTS idx_events_metrics_metadata_gin;
DROP INDEX IF EXISTS idx_events_metrics_payload_gin;
DROP INDEX IF EXISTS idx_events_metrics_ai_response_gin;

-- events_traces (006_events_traces.sql)
DROP INDEX IF EXISTS idx_events_traces_attributes_gin;
DROP INDEX IF EXISTS idx_events_traces_metadata_gin;
DROP INDEX IF EXISTS idx_events_traces_payload_gin;
DROP INDEX IF EXISTS idx_events_traces_ai_response_gin;

-- events_messages (007_events_messages.sql)
DROP INDEX IF EXISTS idx_events_messages_attributes_gin;
DROP INDEX IF EXISTS idx_events_messages_metadata_gin;
DROP INDEX IF EXISTS idx_events_messages_payload_gin;
DROP INDEX IF EXISTS idx_events_messages_ai_response_gin;

-- events_profiles (008_events_profiles.sql)
DROP INDEX IF EXISTS idx_events_profiles_attributes_gin;
DROP INDEX IF EXISTS idx_events_profiles_metadata_gin;
DROP INDEX IF EXISTS idx_events_profiles_payload_gin;
DROP INDEX IF EXISTS idx_events_profiles_ai_response_gin;

-- events_replays (009_events_replays.sql)
DROP INDEX IF EXISTS idx_events_replays_attributes_gin;
DROP INDEX IF EXISTS idx_events_replays_metadata_gin;
DROP INDEX IF EXISTS idx_events_replays_payload_gin;
DROP INDEX IF EXISTS idx_events_replays_ai_response_gin;

-- events_cron_checkins (010_events_cron_checkins.sql)
DROP INDEX IF EXISTS idx_events_cron_checkins_attributes_gin;
DROP INDEX IF EXISTS idx_events_cron_checkins_metadata_gin;
DROP INDEX IF EXISTS idx_events_cron_checkins_payload_gin;
DROP INDEX IF EXISTS idx_events_cron_checkins_ai_response_gin;

COMMIT;


-- ===== Source: database/migrations/logdb/03_observability_v2/999_typed_event_contract.sql =====
BEGIN;

-- Fast typed-event contract trigger function.
-- Keeps direct-SQL safety while avoiding JSONB rewrites on the normal writer
-- path, where occurred_at, metadata.environment, and payload are supplied.
CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  -- 1. Sync timestamps without changing writer-provided values.
  NEW.occurred_at := COALESCE(NEW.occurred_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);

  -- 2. Lock metadata environment, but skip jsonb_set() when already correct.
  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) <> 'object' THEN
    NEW.metadata := jsonb_build_object('environment', NEW.environment);
  ELSIF NEW.metadata->>'environment' IS DISTINCT FROM NEW.environment THEN
    NEW.metadata := jsonb_set(NEW.metadata, '{environment}', to_jsonb(NEW.environment), true);
  END IF;

  -- 3. Auto-generate public_id if not present or empty
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    IF TG_TABLE_NAME LIKE 'events_requests%' THEN
      NEW.public_id := 'REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_errors%' THEN
      NEW.public_id := 'ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_traces%' THEN
      NEW.public_id := 'TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_spans%' THEN
      NEW.public_id := 'SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_logs%' THEN
      NEW.public_id := 'LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_metrics%' THEN
      NEW.public_id := 'MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_messages%' THEN
      NEW.public_id := 'MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_replays%' THEN
      NEW.public_id := 'RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_profiles%' THEN
      NEW.public_id := 'PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_cron_checkins%' THEN
      NEW.public_id := 'CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0');
    END IF;
  END IF;

  -- 4. Fallback payload for direct SQL inserts and older callers.
  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW) - 'payload' - 'attributes' - 'metadata' - 'ai_response';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the contract trigger to all canonical typed-event tables.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests',
    'events_errors',
    'events_logs',
    'events_metrics',
    'events_spans',
    'events_traces',
    'events_messages',
    'events_profiles',
    'events_replays',
    'events_cron_checkins'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_sync_typed_event_contract BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION logdb_sync_typed_event_contract()',
        t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/04_analytics/001_analytics_runtime.up.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS analytics_hourly_rollup (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(20,6) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, metric_name)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS analytics_hourly_rollup_default PARTITION OF analytics_hourly_rollup DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_hourly_dims_gin ON analytics_hourly_rollup USING GIN (dimensions);
CREATE INDEX IF NOT EXISTS idx_analytics_hourly_brin ON analytics_hourly_rollup USING BRIN (bucket);

CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(20,6) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, metric_name)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS analytics_daily_rollup_default PARTITION OF analytics_daily_rollup DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_daily_dims_gin ON analytics_daily_rollup USING GIN (dimensions);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_brin ON analytics_daily_rollup USING BRIN (bucket);

CREATE TABLE IF NOT EXISTS analytics_geo_hourly_rollup (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  country_code CHAR(2) NOT NULL,
  region TEXT,
  city TEXT,
  requests BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  p95_latency_ms NUMERIC(12,3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, country_code, region, city)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS analytics_geo_hourly_rollup_default PARTITION OF analytics_geo_hourly_rollup DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_geo_tenant_env_time ON analytics_geo_hourly_rollup(organization_id,project_id,environment,bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_geo_country_time ON analytics_geo_hourly_rollup(country_code, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_geo_brin ON analytics_geo_hourly_rollup USING BRIN (bucket);

CREATE TABLE IF NOT EXISTS analytics_error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unresolved',
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  occurrence_count BIGINT NOT NULL DEFAULT 0,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_last_seen ON analytics_error_groups(organization_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_attrs_gin ON analytics_error_groups USING GIN (attributes);
DROP TRIGGER IF EXISTS trg_analytics_error_groups_updated_at ON analytics_error_groups;
CREATE TRIGGER trg_analytics_error_groups_updated_at BEFORE UPDATE ON analytics_error_groups FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS analytics_performance_summary (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  service TEXT NOT NULL,
  endpoint TEXT,
  request_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  p50_latency_ms NUMERIC(12,3),
  p95_latency_ms NUMERIC(12,3),
  p99_latency_ms NUMERIC(12,3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, service, endpoint)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS analytics_performance_summary_default PARTITION OF analytics_performance_summary DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_perf_service_time ON analytics_performance_summary(service, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_perf_brin ON analytics_performance_summary USING BRIN (bucket);

CREATE TABLE IF NOT EXISTS analytics_user_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms BIGINT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);
CREATE TABLE IF NOT EXISTS analytics_user_sessions_default PARTITION OF analytics_user_sessions DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_time ON analytics_user_sessions(organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user ON analytics_user_sessions(organization_id, user_id, started_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_attrs_gin ON analytics_user_sessions USING GIN (attributes);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'analytics_endpoint_minute','analytics_endpoint_hourly','analytics_endpoint_daily',
    'analytics_service_minute','analytics_service_hourly','analytics_service_daily',
    'analytics_trace_latency','analytics_error_occurrences','analytics_error_regressions'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        organization_id UUID NOT NULL,
        project_id UUID,
        environment TEXT NOT NULL,
        bucket TIMESTAMPTZ NOT NULL,
        entity_key TEXT NOT NULL,
        total_count BIGINT NOT NULL DEFAULT 0,
        error_count BIGINT NOT NULL DEFAULT 0,
        latency_ms_p95 NUMERIC(12,3),
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (organization_id, project_id, environment, bucket, entity_key)
      ) PARTITION BY RANGE (bucket)
    $sql$, table_name);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (entity_key, bucket DESC)', 'idx_' || table_name || '_entity_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (attributes)', 'idx_' || table_name || '_attrs_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (bucket)', 'idx_' || table_name || '_bucket_brin', table_name);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS analytics_trace_service_edges (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  source_service TEXT NOT NULL,
  target_service TEXT NOT NULL,
  call_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  p95_latency_ms NUMERIC(12,3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, source_service, target_service)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS analytics_trace_service_edges_default PARTITION OF analytics_trace_service_edges DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_trace_edges_source ON analytics_trace_service_edges(source_service, bucket DESC);

COMMIT;


-- ===== Source: database/migrations/logdb/04_analytics/002_typed_analytics_runtime.up.sql =====
BEGIN;

-- Columns consumed by inline error grouping and the event-analytics API. Event
-- facts remain in the dedicated Log DB; no control-plane foreign keys are used.
ALTER TABLE analytics_error_groups
  ALTER COLUMN title SET DEFAULT 'Unknown error',
  ADD COLUMN IF NOT EXISTS error_name TEXT,
  ADD COLUMN IF NOT EXISTS message_template TEXT,
  ADD COLUMN IF NOT EXISTS total_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS today_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS week_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS month_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS services TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS environments TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS releases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_to UUID,
  ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID;

ALTER TABLE analytics_error_groups
  DROP CONSTRAINT IF EXISTS analytics_error_groups_priority_ck,
  ADD CONSTRAINT analytics_error_groups_priority_ck CHECK (priority BETWEEN 1 AND 5);

ALTER TABLE analytics_user_sessions
  ADD COLUMN IF NOT EXISTS is_crashed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE analytics_performance_summary
  ADD COLUMN IF NOT EXISTS bucket_date DATE,
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS method TEXT,
  ADD COLUMN IF NOT EXISTS error_rate NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS apdex_score NUMERIC(8,6);


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='analytics_alert_operator') THEN
    CREATE TYPE analytics_alert_operator AS ENUM ('gt','gte','lt','lte','eq','neq');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  layout JSONB NOT NULL DEFAULT '{}',
  widgets JSONB NOT NULL DEFAULT '[]',
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  shared_token VARCHAR(64),
  created_by UUID NOT NULL,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_logdb_dashboards_org ON analytics_dashboards(organization_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_logdb_dashboards_updated_at ON analytics_dashboards;
CREATE TRIGGER trg_logdb_dashboards_updated_at BEFORE UPDATE ON analytics_dashboards FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS analytics_saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  query_type VARCHAR(50) NOT NULL,
  query_config JSONB NOT NULL,
  visualization_type VARCHAR(50),
  visualization_config JSONB NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_logdb_saved_queries_org ON analytics_saved_queries(organization_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_logdb_saved_queries_updated_at ON analytics_saved_queries;
CREATE TRIGGER trg_logdb_saved_queries_updated_at BEFORE UPDATE ON analytics_saved_queries FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS analytics_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  metric VARCHAR(100) NOT NULL,
  operator analytics_alert_operator NOT NULL,
  threshold NUMERIC NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  notification_channels JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_logdb_analytics_alerts_org ON analytics_alerts(organization_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_logdb_analytics_alerts_updated_at ON analytics_alerts;
CREATE TRIGGER trg_logdb_analytics_alerts_updated_at BEFORE UPDATE ON analytics_alerts FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

COMMIT;


-- ===== Source: database/migrations/logdb/04_analytics/003_analytics_engine_rollups.up.sql =====
BEGIN;

-- ============================================================================
-- Analytics Engine â€” rollup + control tables
--
-- Design: docs/analytics/07-rollup-tables.md
-- Ownership: docs/analytics/07-rollup-tables.md Â§4 (exactly one writing worker
--            per table; dashboard APIs read these tables and never events_*).
--
-- Naming follows planning/anlatycisprompt.md Phase 10: <domain>_metrics_<window>.
-- This namespace deliberately does not collide with the never-written
-- analytics_* tables from 04_analytics/001, which are frozen below.
--
-- Two physical shapes:
--   Shape A  (organization_id, project_id, environment, bucket)
--   Shape B  (organization_id, project_id, environment, bucket, entity_key)
--
-- Sentinels keep the primary key total:
--   project_id  = '00000000-0000-0000-0000-000000000000' â†’ org-wide aggregate
--   environment = '__all__'                              â†’ all environments
-- Neither value can be produced by ingestion (UUID zero is never issued and
-- '__all__' fails the environment regex enforced on events_*).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_engine_create_rollup(
  p_table   TEXT,
  p_shape   TEXT,          -- 'A' | 'B'
  p_partkey TEXT DEFAULT 'bucket'
) RETURNS VOID AS $fn$
DECLARE
  entity_cols TEXT := '';
  pk_cols     TEXT := 'organization_id, project_id, environment, bucket';
BEGIN
  IF p_shape = 'B' THEN
    entity_cols := 'entity_key TEXT NOT NULL, entity_label TEXT,';
    pk_cols := pk_cols || ', entity_key';
  END IF;

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I (
      organization_id UUID        NOT NULL,
      project_id      UUID        NOT NULL,
      environment     TEXT        NOT NULL,
      bucket          TIMESTAMPTZ NOT NULL,
      %s
      sample_count    BIGINT      NOT NULL DEFAULT 0,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (%s)
    ) PARTITION BY RANGE (%I)
  $sql$, p_table, entity_cols, pk_cols, p_partkey);

  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I DEFAULT',
                 p_table || '_default', p_table);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, project_id, environment, bucket DESC)',
    'idx_' || p_table || '_tenant_time', p_table);

  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (bucket)',
                 'idx_' || p_table || '_bucket_brin', p_table);

  IF p_shape = 'B' THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, project_id, environment, entity_key, bucket DESC)',
      'idx_' || p_table || '_entity_time', p_table);
  END IF;
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_create_rollup(TEXT, TEXT, TEXT) IS
  'Creates one analytics-engine rollup table (Shape A or B) with its default partition and standard index set. Idempotent.';

-- Latency / duration block. Percentiles are exact inside a 1m bucket; coarser
-- windows recompute them from the merged latency_hist (24 log-scale buckets).
CREATE OR REPLACE FUNCTION analytics_engine_add_latency_columns(
  p_table  TEXT,
  p_prefix TEXT DEFAULT 'latency'
) RETURNS VOID AS $fn$
BEGIN
  EXECUTE format($sql$
    ALTER TABLE %I
      ADD COLUMN IF NOT EXISTS %I NUMERIC(20,3) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I BIGINT[]
  $sql$, p_table,
     p_prefix || '_sum_ms', p_prefix || '_max_ms',
     p_prefix || '_p50_ms', p_prefix || '_p75_ms', p_prefix || '_p90_ms',
     p_prefix || '_p95_ms', p_prefix || '_p99_ms', p_prefix || '_hist');
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_add_latency_columns(TEXT, TEXT) IS
  'Adds the mergeable latency block (sum/max/p50..p99/histogram) to a rollup table. Histogram edges are documented in docs/analytics/07-rollup-tables.md Â§1.';

-- Distinct-count block: exact within a 1m bucket, HLL sketch for merges.
CREATE OR REPLACE FUNCTION analytics_engine_add_unique_columns(
  p_table   TEXT,
  p_subject TEXT DEFAULT 'users'
) RETURNS VOID AS $fn$
BEGIN
  EXECUTE format($sql$
    ALTER TABLE %I
      ADD COLUMN IF NOT EXISTS %I BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS %I BYTEA
  $sql$, p_table,
     'unique_' || p_subject || '_exact', 'unique_' || p_subject || '_hll');
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_add_unique_columns(TEXT, TEXT) IS
  'Adds an exact + HyperLogLog distinct-count pair to a rollup table. Sketches are produced and merged only by the analytics engine.';

-- ---------------------------------------------------------------------------
-- Table creation from the declarative domain/window map
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  spec        TEXT;
  parts       TEXT[];
  domain      TEXT;
  shape       TEXT;
  windows     TEXT[];
  w           TEXT;
BEGIN
  -- 'domain|shape|window,window,...'
  FOREACH spec IN ARRAY ARRAY[
    'request_metrics|A|1m,5m,1h,1d',
    'endpoint_metrics|B|1m,5m,1h,1d',
    'service_metrics|B|1m,5m,1h,1d',
    'error_metrics|A|1m,5m,1h,1d',
    'error_group_metrics|B|1m,1h,1d',
    'error_dimension_metrics|B|1h',
    'log_metrics|A|1m,5m,1h,1d',
    'logger_metrics|B|1h',
    'metric_series|B|1m,1h,1d',
    'runtime_metrics|B|1m,1h',
    'gc_metrics|B|1m,1h',
    'span_metrics|B|1m,1h',
    'db_metrics|B|1h',
    'dependency_metrics|B|1h',
    'trace_metrics|A|1m,5m,1h',
    'trace_edge_metrics|B|1h',
    'cron_metrics|B|1m,1h',
    'profile_metrics|B|1h',
    'profile_function_metrics|B|1h',
    'replay_metrics|A|1h',
    'session_metrics|A|1h',
    'user_metrics|A|1d',
    'geo_metrics|B|1h',
    'device_metrics|B|1h',
    'sdk_metrics|B|1h',
    'release_metrics|B|1h',
    'slo_metrics|B|5m,1h',
    'security_metrics|B|1h',
    'usage_metrics|B|1d',
    'cost_metrics|A|1d',
    'ingest_health_metrics|B|5m',
    'alert_metrics|B|1h',
    'ai_metrics|B|1h',
    'project_health|A|5m'
  ] LOOP
    parts   := string_to_array(spec, '|');
    domain  := parts[1];
    shape   := parts[2];
    windows := string_to_array(parts[3], ',');

    FOREACH w IN ARRAY windows LOOP
      PERFORM analytics_engine_create_rollup(domain || '_' || w, shape);
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Domain columns
-- ---------------------------------------------------------------------------

-- Requests -------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['request_metrics_1m','request_metrics_5m','request_metrics_1h','request_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS success_count          BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS redirect_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS client_error_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS auth_failure_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS rate_limited_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS slow_count             BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bot_count              BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_satisfied_count  BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_tolerating_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_in               BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_out              BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS service_count          INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS route_count            INTEGER NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
    PERFORM analytics_engine_add_unique_columns(t, 'sessions');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS unique_tenants_exact BIGINT NOT NULL DEFAULT 0', t);
  END LOOP;
END $$;

-- Endpoints ------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['endpoint_metrics_1m','endpoint_metrics_5m','endpoint_metrics_1h','endpoint_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS method             TEXT,
        ADD COLUMN IF NOT EXISTS route              TEXT,
        ADD COLUMN IF NOT EXISTS service            TEXT,
        ADD COLUMN IF NOT EXISTS total_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS client_error_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS slow_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_out          BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS lifecycle          TEXT
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

-- Services -------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_metrics_1m','service_metrics_5m','service_metrics_1h','service_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS client_error_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_satisfied_count  BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_tolerating_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS span_count             BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_group_count      INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS availability_pct       NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS health_score           NUMERIC(6,2),
        ADD COLUMN IF NOT EXISTS release_current        TEXT
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

-- Errors ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['error_metrics_1m','error_metrics_5m','error_metrics_1h','error_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fatal_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS warning_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS info_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS debug_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS unique_fingerprints INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS new_group_count    INTEGER NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['error_group_metrics_1m','error_group_metrics_1h','error_group_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS error_name         TEXT,
        ADD COLUMN IF NOT EXISTS message_template   TEXT,
        ADD COLUMN IF NOT EXISTS mechanism          TEXT,
        ADD COLUMN IF NOT EXISTS severity_max       TEXT,
        ADD COLUMN IF NOT EXISTS occurrence_count   BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS service_count      INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS release_first_seen TEXT,
        ADD COLUMN IF NOT EXISTS first_seen_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_seen_at       TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS baseline_count     NUMERIC(20,6),
        ADD COLUMN IF NOT EXISTS regression_score   NUMERIC(10,4),
        ADD COLUMN IF NOT EXISTS is_new_in_window   BOOLEAN NOT NULL DEFAULT FALSE
    $sql$, t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

ALTER TABLE error_dimension_metrics_1h
  ADD COLUMN IF NOT EXISTS dimension        TEXT,
  ADD COLUMN IF NOT EXISTS dimension_value  TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_count BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_unique_columns('error_dimension_metrics_1h', 'users');

-- Logs -----------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['log_metrics_1m','log_metrics_5m','log_metrics_1h','log_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS warn_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS info_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS debug_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS unique_loggers  INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_estimate  BIGINT NOT NULL DEFAULT 0
    $sql$, t);
  END LOOP;
END $$;

ALTER TABLE logger_metrics_1h
  ADD COLUMN IF NOT EXISTS service     TEXT,
  ADD COLUMN IF NOT EXISTS total_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warn_count  BIGINT NOT NULL DEFAULT 0;

-- Custom metrics -------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['metric_series_1m','metric_series_1h','metric_series_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS metric_type      TEXT,
        ADD COLUMN IF NOT EXISTS unit             TEXT,
        ADD COLUMN IF NOT EXISTS service          TEXT,
        ADD COLUMN IF NOT EXISTS point_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS value_sum        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_min        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_max        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_last       DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_last_at    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS value_p50        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_p95        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_p99        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS tag_cardinality  INTEGER NOT NULL DEFAULT 0
    $sql$, t);
  END LOOP;
END $$;

-- Runtime + GC ---------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['runtime_metrics_1m','runtime_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS heap_used_mb_avg            NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS heap_used_mb_max            NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS heap_total_mb_avg           NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS external_mb_avg             NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS rss_mb_avg                  NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS rss_mb_max                  NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS active_handles_avg          NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS active_handles_max          NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_p50_ms        NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_p95_ms        NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_p99_ms        NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_hist          BIGINT[],
        ADD COLUMN IF NOT EXISTS eventloop_utilization_pct   NUMERIC(7,3)
    $sql$, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['gc_metrics_1m','gc_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS service            TEXT,
        ADD COLUMN IF NOT EXISTS gc_type            TEXT,
        ADD COLUMN IF NOT EXISTS pause_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS long_pause_count   BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS heap_before_mb_avg NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS heap_after_mb_avg  NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS reclaimed_mb_sum   NUMERIC(20,3) NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t, 'pause');
  END LOOP;
END $$;

-- Spans / DB / dependencies --------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['span_metrics_1m','span_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS service     TEXT,
        ADD COLUMN IF NOT EXISTS span_name   TEXT,
        ADD COLUMN IF NOT EXISTS kind        TEXT,
        ADD COLUMN IF NOT EXISTS total_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count BIGINT NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_latency_columns(t, 'self_time');
  END LOOP;
END $$;

ALTER TABLE db_metrics_1h
  ADD COLUMN IF NOT EXISTS db_system         TEXT,
  ADD COLUMN IF NOT EXISTS db_name           TEXT,
  ADD COLUMN IF NOT EXISTS db_operation      TEXT,
  ADD COLUMN IF NOT EXISTS db_collection     TEXT,
  ADD COLUMN IF NOT EXISTS statement_pattern TEXT,
  ADD COLUMN IF NOT EXISTS service           TEXT,
  ADD COLUMN IF NOT EXISTS call_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count       BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('db_metrics_1h');

ALTER TABLE dependency_metrics_1h
  ADD COLUMN IF NOT EXISTS dependency_kind  TEXT,
  ADD COLUMN IF NOT EXISTS dependency_host  TEXT,
  ADD COLUMN IF NOT EXISTS service          TEXT,
  ADD COLUMN IF NOT EXISTS call_count       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_5xx_count BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('dependency_metrics_1h');

-- Traces ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['trace_metrics_1m','trace_metrics_5m','trace_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS trace_count           BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS partial_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_trace_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS span_count_sum        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS span_count_max        INTEGER,
        ADD COLUMN IF NOT EXISTS critical_path_p95_ms  NUMERIC(14,3)
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t, 'duration');
  END LOOP;
END $$;

ALTER TABLE trace_edge_metrics_1h
  ADD COLUMN IF NOT EXISTS source_service TEXT,
  ADD COLUMN IF NOT EXISTS target_service TEXT,
  ADD COLUMN IF NOT EXISTS call_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count    BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('trace_edge_metrics_1h');

-- Crons ----------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cron_metrics_1m','cron_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS monitor_slug       TEXT,
        ADD COLUMN IF NOT EXISTS checkin_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ok_count           BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS in_progress_count  BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS missed_count       BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_status        TEXT,
        ADD COLUMN IF NOT EXISTS last_checkin_at    TIMESTAMPTZ
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t, 'duration');
  END LOOP;
END $$;

-- Profiles -------------------------------------------------------------------
ALTER TABLE profile_metrics_1h
  ADD COLUMN IF NOT EXISTS service          TEXT,
  ADD COLUMN IF NOT EXISTS profile_type     TEXT,
  ADD COLUMN IF NOT EXISTS profile_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sample_count_sum BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS node_count_sum   BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('profile_metrics_1h', 'duration');

ALTER TABLE profile_function_metrics_1h
  ADD COLUMN IF NOT EXISTS service        TEXT,
  ADD COLUMN IF NOT EXISTS function_name  TEXT,
  ADD COLUMN IF NOT EXISTS script_url     TEXT,
  ADD COLUMN IF NOT EXISTS line_number    INTEGER,
  ADD COLUMN IF NOT EXISTS hit_count_sum  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_count  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS self_share_pct NUMERIC(7,3);

-- Replays / sessions / users -------------------------------------------------
ALTER TABLE replay_metrics_1h
  ADD COLUMN IF NOT EXISTS segment_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dom_event_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crashed_session_count  BIGINT NOT NULL DEFAULT 0;

ALTER TABLE session_metrics_1h
  ADD COLUMN IF NOT EXISTS session_count         BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crashed_session_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_user_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returning_user_count  BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('session_metrics_1h', 'duration');
SELECT analytics_engine_add_unique_columns('session_metrics_1h', 'users');

ALTER TABLE user_metrics_1d
  ADD COLUMN IF NOT EXISTS dau                   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_users             BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returning_users       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sessions_per_user_avg NUMERIC(12,4);
SELECT analytics_engine_add_unique_columns('user_metrics_1d', 'users');

-- Geo / devices / SDK / releases --------------------------------------------
ALTER TABLE geo_metrics_1h
  ADD COLUMN IF NOT EXISTS country_code  CHAR(2),
  ADD COLUMN IF NOT EXISTS country_name  TEXT,
  ADD COLUMN IF NOT EXISTS region        TEXT,
  ADD COLUMN IF NOT EXISTS request_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asn_count     INTEGER NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('geo_metrics_1h');
SELECT analytics_engine_add_unique_columns('geo_metrics_1h', 'users');

ALTER TABLE device_metrics_1h
  ADD COLUMN IF NOT EXISTS dimension       TEXT,
  ADD COLUMN IF NOT EXISTS dimension_value TEXT,
  ADD COLUMN IF NOT EXISTS request_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count     BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('device_metrics_1h');
SELECT analytics_engine_add_unique_columns('device_metrics_1h', 'users');

ALTER TABLE sdk_metrics_1h
  ADD COLUMN IF NOT EXISTS sdk_name      TEXT,
  ADD COLUMN IF NOT EXISTS sdk_version   TEXT,
  ADD COLUMN IF NOT EXISTS event_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS project_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ;

ALTER TABLE release_metrics_1h
  ADD COLUMN IF NOT EXISTS release              TEXT,
  ADD COLUMN IF NOT EXISTS request_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_group_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_error_group_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crash_free_rate      NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS adoption_share_pct   NUMERIC(7,4);
SELECT analytics_engine_add_latency_columns('release_metrics_1h');
SELECT analytics_engine_add_unique_columns('release_metrics_1h', 'users');

-- SLO ------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['slo_metrics_5m','slo_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS slo_name                   TEXT,
        ADD COLUMN IF NOT EXISTS slo_kind                   TEXT,
        ADD COLUMN IF NOT EXISTS slo_target_pct             NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS good_count                 BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_count                BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS availability_pct           NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS error_budget_consumed_pct  NUMERIC(9,4),
        ADD COLUMN IF NOT EXISTS burn_rate_1h               NUMERIC(12,4),
        ADD COLUMN IF NOT EXISTS burn_rate_6h               NUMERIC(12,4),
        ADD COLUMN IF NOT EXISTS burn_rate_24h              NUMERIC(12,4)
    $sql$, t);
  END LOOP;
END $$;

-- Security -------------------------------------------------------------------
ALTER TABLE security_metrics_1h
  ADD COLUMN IF NOT EXISTS dimension              TEXT,
  ADD COLUMN IF NOT EXISTS dimension_value        TEXT,
  ADD COLUMN IF NOT EXISTS auth_failure_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forbidden_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_limited_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sensitive_access_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_anomaly_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distinct_country_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_score             NUMERIC(6,2);

-- Usage / cost / ingestion ---------------------------------------------------
ALTER TABLE usage_metrics_1d
  ADD COLUMN IF NOT EXISTS signal          TEXT,
  ADD COLUMN IF NOT EXISTS event_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billable_count  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_count  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bytes_estimate  BIGINT NOT NULL DEFAULT 0;

ALTER TABLE cost_metrics_1d
  ADD COLUMN IF NOT EXISTS billable_events         BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_micros        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_micros   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_million_micros BIGINT NOT NULL DEFAULT 0;

ALTER TABLE ingest_health_metrics_5m
  ADD COLUMN IF NOT EXISTS signal            TEXT,
  ADD COLUMN IF NOT EXISTS accepted_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dropped_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dlq_count         BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejection_reasons JSONB NOT NULL DEFAULT '{}'::jsonb;
SELECT analytics_engine_add_latency_columns('ingest_health_metrics_5m', 'ingest_lag');

-- Alerts / AI ----------------------------------------------------------------
ALTER TABLE alert_metrics_1h
  ADD COLUMN IF NOT EXISTS rule_id                  UUID,
  ADD COLUMN IF NOT EXISTS rule_name                TEXT,
  ADD COLUMN IF NOT EXISTS triggered_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_count           BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notification_count       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_success_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_failure_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mtta_seconds_avg         NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS mttr_seconds_avg         NUMERIC(14,3);

ALTER TABLE ai_metrics_1h
  ADD COLUMN IF NOT EXISTS model             TEXT,
  ADD COLUMN IF NOT EXISTS request_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_hit_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_consumed  NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_micros       BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('ai_metrics_1h');

-- Project health -------------------------------------------------------------
ALTER TABLE project_health_5m
  ADD COLUMN IF NOT EXISTS request_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_rate_pct   NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS latency_p95_ms   NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS availability_pct NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS open_alert_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_score     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS status           TEXT;

-- ---------------------------------------------------------------------------
-- Current-state tables (not rollups: one row per entity, no bucket)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cron_monitor_state (
  organization_id           UUID NOT NULL,
  project_id                UUID NOT NULL,
  environment               TEXT NOT NULL,
  monitor_slug              TEXT NOT NULL,
  last_status               TEXT,
  last_checkin_at           TIMESTAMPTZ,
  last_duration_ms          NUMERIC(14,3),
  expected_interval_seconds INTEGER,
  consecutive_failures      INTEGER NOT NULL DEFAULT 0,
  checkin_count_total       BIGINT NOT NULL DEFAULT 0,
  is_missing                BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, monitor_slug)
);
CREATE INDEX IF NOT EXISTS idx_cron_monitor_state_missing
  ON cron_monitor_state(organization_id, project_id) WHERE is_missing;

CREATE TABLE IF NOT EXISTS release_comparison (
  organization_id        UUID NOT NULL,
  project_id             UUID NOT NULL,
  environment            TEXT NOT NULL,
  release                TEXT NOT NULL,
  baseline_release       TEXT,
  request_count          BIGINT NOT NULL DEFAULT 0,
  baseline_request_count BIGINT NOT NULL DEFAULT 0,
  error_rate_pct         NUMERIC(7,4),
  baseline_error_rate_pct NUMERIC(7,4),
  error_rate_delta_pct   NUMERIC(10,4),
  latency_p95_ms         NUMERIC(14,3),
  baseline_latency_p95_ms NUMERIC(14,3),
  p95_delta_ms           NUMERIC(14,3),
  throughput_delta_pct   NUMERIC(10,4),
  new_error_groups       INTEGER NOT NULL DEFAULT 0,
  verdict                TEXT NOT NULL DEFAULT 'stable',
  first_seen_at          TIMESTAMPTZ,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, release),
  CONSTRAINT release_comparison_verdict_ck
    CHECK (verdict IN ('improved', 'stable', 'degraded', 'insufficient_data'))
);
CREATE INDEX IF NOT EXISTS idx_release_comparison_recent
  ON release_comparison(organization_id, project_id, computed_at DESC);

-- SLO definitions are authored in the control plane; the engine caches them so
-- analytics workers never query the control-plane database.
CREATE TABLE IF NOT EXISTS slo_definition_cache (
  slo_id           UUID PRIMARY KEY,
  organization_id  UUID NOT NULL,
  project_id       UUID NOT NULL,
  environment      TEXT NOT NULL,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  target_pct       NUMERIC(7,4) NOT NULL,
  window_days      INTEGER NOT NULL DEFAULT 30,
  service          TEXT,
  latency_threshold_ms NUMERIC(14,3),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT slo_definition_cache_kind_ck CHECK (kind IN ('availability', 'latency'))
);
CREATE INDEX IF NOT EXISTS idx_slo_definition_cache_scope
  ON slo_definition_cache(organization_id, project_id, environment) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Anomaly detections
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS anomaly_detections (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id      UUID NOT NULL,
  environment     TEXT NOT NULL,
  metric_key      TEXT NOT NULL,
  entity_key      TEXT,
  bucket          TIMESTAMPTZ NOT NULL,
  window_size     TEXT NOT NULL,
  observed_value  NUMERIC(20,6) NOT NULL,
  baseline_value  NUMERIC(20,6) NOT NULL,
  baseline_stddev NUMERIC(20,6),
  deviation_sigma NUMERIC(12,4) NOT NULL,
  direction       TEXT NOT NULL,
  severity        TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, detected_at),
  CONSTRAINT anomaly_detections_direction_ck CHECK (direction IN ('spike', 'drop')),
  CONSTRAINT anomaly_detections_severity_ck CHECK (severity IN ('info', 'warning', 'critical'))
) PARTITION BY RANGE (detected_at);
CREATE TABLE IF NOT EXISTS anomaly_detections_default PARTITION OF anomaly_detections DEFAULT;
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_scope_time
  ON anomaly_detections(organization_id, project_id, environment, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_metric
  ON anomaly_detections(organization_id, metric_key, detected_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_detections_dedupe
  ON anomaly_detections(organization_id, project_id, environment, metric_key,
                        COALESCE(entity_key, ''), bucket, window_size, detected_at);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_brin
  ON anomaly_detections USING BRIN (detected_at);

-- ---------------------------------------------------------------------------
-- Engine control tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics_watermarks (
  worker_id            TEXT NOT NULL,
  organization_id      UUID NOT NULL,
  window_size          TEXT NOT NULL,
  watermark_at         TIMESTAMPTZ NOT NULL,
  last_bucket_at       TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rows_processed       BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (worker_id, organization_id, window_size)
);
CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_worker_lag
  ON analytics_watermarks(worker_id, watermark_at);
CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_failing
  ON analytics_watermarks(worker_id, consecutive_failures) WHERE consecutive_failures > 0;
DROP TRIGGER IF EXISTS trg_analytics_watermarks_updated_at ON analytics_watermarks;
CREATE TRIGGER trg_analytics_watermarks_updated_at
  BEFORE UPDATE ON analytics_watermarks
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS analytics_worker_runs (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id       TEXT NOT NULL,
  organization_id UUID,
  window_size     TEXT NOT NULL,
  window_start    TIMESTAMPTZ,
  window_end      TIMESTAMPTZ,
  rows_read       BIGINT NOT NULL DEFAULT 0,
  rows_written    BIGINT NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT NOT NULL,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  PRIMARY KEY (id, started_at),
  CONSTRAINT analytics_worker_runs_outcome_ck
    CHECK (outcome IN ('success', 'partial', 'failed', 'skipped'))
) PARTITION BY RANGE (started_at);
CREATE TABLE IF NOT EXISTS analytics_worker_runs_default PARTITION OF analytics_worker_runs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_worker_time
  ON analytics_worker_runs(worker_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_failures
  ON analytics_worker_runs(worker_id, started_at DESC) WHERE outcome <> 'success';
CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_brin
  ON analytics_worker_runs USING BRIN (started_at);

-- ---------------------------------------------------------------------------
-- Documentation + freeze markers
-- ---------------------------------------------------------------------------

COMMENT ON TABLE request_metrics_1m IS
  'Analytics engine rollup. Owner: analytics.requests. Read by /analytics/v2/*. Never written by ingestion.';
COMMENT ON TABLE analytics_watermarks IS
  'Analytics engine progress ledger. watermark_at tracks the highest events_*.ingested_at consumed per (worker, org, window).';
COMMENT ON TABLE analytics_worker_runs IS
  'Analytics engine run ledger (14 day retention). Feeds the worker health endpoint and /analytics/v2/system/health.';
COMMENT ON TABLE cron_monitor_state IS
  'Current cron monitor state. Owner: analytics.crons.';
COMMENT ON TABLE release_comparison IS
  'Current release-vs-baseline verdict. Owner: analytics.releases.';
COMMENT ON TABLE slo_definition_cache IS
  'Control-plane SLO definitions mirrored into the Log DB so analytics workers never read the control-plane database.';
COMMENT ON TABLE anomaly_detections IS
  'Statistical anomaly facts derived from *_metrics_1h rollups. Owner: analytics.anomalies.';

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'analytics_hourly_rollup','analytics_daily_rollup','analytics_performance_summary',
    'analytics_endpoint_minute','analytics_endpoint_hourly','analytics_endpoint_daily',
    'analytics_service_minute','analytics_service_hourly','analytics_service_daily',
    'analytics_trace_latency','analytics_error_occurrences','analytics_error_regressions',
    'analytics_geo_hourly_rollup','analytics_alerts'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t) THEN
      EXECUTE format(
        'COMMENT ON TABLE %I IS %L', t,
        'FROZEN by 04_analytics/003_analytics_engine_rollups: superseded by the <domain>_metrics_<window> rollups. No reads, no writes. Drop requires explicit approval (docs/analytics/14-implementation-roadmap.md Wave 7).'
      );
    END IF;
  END LOOP;
END $$;

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  ('analytics_engine_ownership',
   'Tables named <domain>_metrics_<window> plus cron_monitor_state, release_comparison, slo_definition_cache, anomaly_detections, analytics_watermarks and analytics_worker_runs are written exclusively by the analytics engine workers (src/modules/analytics-engine). Dashboard APIs read these tables and must not aggregate events_* directly.'),
  ('analytics_engine_sentinels',
   'Rollups store org-wide aggregates with project_id = 00000000-0000-0000-0000-000000000000 and cross-environment aggregates with environment = __all__. Neither value can be produced by ingestion.')
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;


-- ===== Source: database/migrations/logdb/04_analytics/004_analytics_engine_partitions.up.sql =====
BEGIN;

-- ============================================================================
-- Analytics Engine â€” partition maintenance + telemetry read indexes
--
-- 1. analytics_engine_ensure_partitions(days_ahead) creates real range
--    partitions for every analytics-engine table. This replaces the dependency
--    on create_event_partitions(), which src/modules/event-analytics/queue.ts
--    calls but which no migration in this tree defines (see
--    docs/analytics/03-logdb-audit.md Â§5).
--
-- 2. analytics_engine_drop_partitions_before(cutoff) supports retention by
--    dropping whole partitions instead of DELETE, restricted to an allowlist so
--    the retention worker can never touch events_* or another module's tables.
--
-- 3. Watermark indexes on events_* â€” analytics workers track progress on
--    ingested_at (not occurred_at) so late-arriving events are never skipped.
--    These are the only changes this work makes to the canonical event tables:
--    additive indexes, no columns, no triggers, no constraints.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Partition granularity registry
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_engine_partition_tables()
RETURNS TABLE (table_name TEXT, part_column TEXT, granularity TEXT) AS $fn$
BEGIN
  RETURN QUERY
  SELECT c.relname::TEXT,
         CASE
           WHEN c.relname = 'anomaly_detections'    THEN 'detected_at'
           WHEN c.relname = 'analytics_worker_runs' THEN 'started_at'
           ELSE 'bucket'
         END::TEXT,
         CASE
           WHEN c.relname LIKE '%\_1m' OR c.relname LIKE '%\_5m' THEN 'day'
           WHEN c.relname IN ('anomaly_detections', 'analytics_worker_runs')  THEN 'day'
           ELSE 'month'
         END::TEXT
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'p'
     AND n.nspname = current_schema()
     AND (
       c.relname ~ '_metrics_(1m|5m|1h|1d)$'
       OR c.relname ~ '^metric_series_(1m|1h|1d)$'
       OR c.relname = 'project_health_5m'
       OR c.relname = 'anomaly_detections'
       OR c.relname = 'analytics_worker_runs'
     );
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_partition_tables() IS
  'Allowlist of analytics-engine partitioned tables with their partition column and granularity. The retention and partition workers operate only on this set.';

-- ---------------------------------------------------------------------------
-- Partition creation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_engine_ensure_partitions(
  days_ahead INTEGER DEFAULT 7
) RETURNS INTEGER AS $fn$
DECLARE
  rec        RECORD;
  created    INTEGER := 0;
  d          DATE;
  m          DATE;
  part_name  TEXT;
  range_from TIMESTAMPTZ;
  range_to   TIMESTAMPTZ;
BEGIN
  IF days_ahead IS NULL OR days_ahead < 1 THEN
    days_ahead := 1;
  END IF;

  FOR rec IN SELECT * FROM analytics_engine_partition_tables() LOOP
    IF rec.granularity = 'day' THEN
      -- One day back (late events / recompute) through days_ahead forward.
      d := (NOW() AT TIME ZONE 'UTC')::DATE - 1;
      WHILE d <= (NOW() AT TIME ZONE 'UTC')::DATE + days_ahead LOOP
        part_name  := format('%s_p%s', rec.table_name, to_char(d, 'YYYYMMDD'));
        range_from := d::TIMESTAMPTZ;
        range_to   := (d + 1)::TIMESTAMPTZ;

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            part_name, rec.table_name, range_from, range_to);
          created := created + 1;
        END IF;
        d := d + 1;
      END LOOP;
    ELSE
      -- Previous, current, and enough forward months to cover days_ahead.
      m := date_trunc('month', (NOW() AT TIME ZONE 'UTC')::DATE - INTERVAL '1 month')::DATE;
      WHILE m <= date_trunc('month', (NOW() AT TIME ZONE 'UTC')::DATE + days_ahead + 31)::DATE LOOP
        part_name  := format('%s_p%s', rec.table_name, to_char(m, 'YYYYMM'));
        range_from := m::TIMESTAMPTZ;
        range_to   := (m + INTERVAL '1 month')::TIMESTAMPTZ;

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            part_name, rec.table_name, range_from, range_to);
          created := created + 1;
        END IF;
        m := (m + INTERVAL '1 month')::DATE;
      END LOOP;
    END IF;
  END LOOP;

  RETURN created;
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_ensure_partitions(INTEGER) IS
  'Creates missing range partitions for analytics-engine tables (daily for 1m/5m tiers and ledgers, monthly for 1h/1d tiers). Idempotent; returns the number of partitions created.';

-- ---------------------------------------------------------------------------
-- Retention: drop whole partitions strictly older than a cutoff
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_engine_drop_partitions_before(
  p_table  TEXT,
  p_cutoff TIMESTAMPTZ
) RETURNS INTEGER AS $fn$
DECLARE
  child     RECORD;
  dropped   INTEGER := 0;
  upper_txt TEXT;
  upper_ts  TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM analytics_engine_partition_tables() t WHERE t.table_name = p_table) THEN
    RAISE EXCEPTION 'analytics_engine_drop_partitions_before refused: % is not an analytics-engine partitioned table', p_table;
  END IF;

  FOR child IN
    SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_class parent
      JOIN pg_inherits i ON i.inhparent = parent.oid
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE parent.relname = p_table
  LOOP
    -- Never drop the default partition: it holds rows outside declared ranges.
    CONTINUE WHEN child.bound IS NULL OR child.bound = 'DEFAULT';

    upper_txt := substring(child.bound FROM $re$TO \('([^']+)'\)$re$);
    CONTINUE WHEN upper_txt IS NULL;

    BEGIN
      upper_ts := upper_txt::TIMESTAMPTZ;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;

    IF upper_ts <= p_cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', child.name);
      dropped := dropped + 1;
    END IF;
  END LOOP;

  RETURN dropped;
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_drop_partitions_before(TEXT, TIMESTAMPTZ) IS
  'Drops analytics-engine partitions whose upper bound is at or before the cutoff. Raises if the table is not in the analytics-engine allowlist, and never drops the DEFAULT partition.';

-- ---------------------------------------------------------------------------
-- Watermark indexes on the canonical event tables (additive only)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests','events_errors','events_logs','events_metrics','events_spans',
    'events_traces','events_messages','events_profiles','events_replays','events_cron_checkins'
  ] LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, project_id, environment, ingested_at)',
      'idx_' || t || '_tenant_env_ingested', t);
  END LOOP;
END $$;

-- Dimension indexes required by the geo, release, session, sdk, and span workers.
CREATE INDEX IF NOT EXISTS idx_events_requests_geo_time
  ON events_requests(organization_id, project_id, geo_country_code, occurred_at DESC)
  WHERE geo_country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_release_time
  ON events_requests(organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_release_time
  ON events_errors(organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_session_time
  ON events_requests(organization_id, project_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_db_time
  ON events_spans(organization_id, project_id, db_system, occurred_at DESC)
  WHERE db_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_host_time
  ON events_spans(organization_id, project_id, http_host, occurred_at DESC)
  WHERE http_host IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_sdk_time
  ON events_requests(organization_id, project_id, sdk_name, sdk_version, occurred_at DESC)
  WHERE sdk_name IS NOT NULL;

-- ---------------------------------------------------------------------------
-- First partition set so the engine can write immediately after migration
-- ---------------------------------------------------------------------------

SELECT analytics_engine_ensure_partitions(7);

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  ('analytics_engine_partitioning',
   'analytics_engine_ensure_partitions(days_ahead) creates daily partitions for 1m/5m rollups and the anomaly/run ledgers, and monthly partitions for 1h/1d rollups. analytics_engine_drop_partitions_before(table, cutoff) performs retention by dropping partitions and refuses any table outside the analytics-engine allowlist.')
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;


-- ===== Source: database/migrations/logdb/04_analytics/005_ai_metrics_1m.up.sql =====
BEGIN;

SELECT analytics_engine_create_rollup('ai_metrics_1m', 'B');

ALTER TABLE ai_metrics_1m
  ADD COLUMN IF NOT EXISTS model             TEXT,
  ADD COLUMN IF NOT EXISTS request_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_hit_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_consumed  NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_micros       BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('ai_metrics_1m');

COMMIT;


-- ===== Source: database/migrations/logdb/04_analytics/006_analytics_user_sessions_query_contract.up.sql =====
BEGIN;

-- Analytics-session query/public-id contract.
-- This must live under 04_analytics because analytics_user_sessions is created
-- by 04_analytics/001_analytics_runtime.up.sql. The observability public-id
-- migration runs earlier and must not assume analytics tables already exist.

CREATE SEQUENCE IF NOT EXISTS seq_pubid_sessions START WITH 1 INCREMENT BY 1;

ALTER TABLE analytics_user_sessions
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('SES-' || lpad(nextval('seq_pubid_sessions')::text, 9, '0'));

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_project_time
  ON analytics_user_sessions (organization_id, project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_project_session_time
  ON analytics_user_sessions (organization_id, project_id, session_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_pubid
  ON analytics_user_sessions (organization_id, public_id);

COMMIT;


-- ===== Source: database/migrations/logdb/05_connectors_runtime/001_connector_runtime.up.sql =====
BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'connector_deliveries',
    'connector_delivery_attempts',
    'connector_health_checks',
    'connector_test_runs',
    'connector_audit_logs'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        connector_id UUID,
        route_id UUID,
        status logdb_delivery_status,
        event_type TEXT,
        request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        response_payload JSONB,
        status_code INTEGER,
        error_message TEXT,
        latency_ms INTEGER,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, occurred_at)
      ) PARTITION BY RANGE (occurred_at)
    $sql$, table_name);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, connector_id, occurred_at DESC)', 'idx_' || table_name || '_connector_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (status, occurred_at DESC)', 'idx_' || table_name || '_status_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (request_payload)', 'idx_' || table_name || '_request_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (occurred_at)', 'idx_' || table_name || '_occurred_brin', table_name);
  END LOOP;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/05_connectors_runtime/002_connector_runtime_v2.up.sql =====
-- =============================================================================
-- Log DB : L6 â€” Typed connector runtime (v2)
-- Architecture : docs/alerting-redesign/02-data-model.md Â§10
--                docs/alerting-redesign/adr/0006-database-ownership.md
--                docs/alerting-redesign/adr/0008-connector-isolation.md
-- Increment    : 1 (schema ownership stabilization)
--
-- Additive only. The generic 5-table loop in 001_connector_runtime.up.sql is left
-- untouched so old code keeps running during rolling deployment.
--
-- Fixes audit findings A4, A5, A6, C1, C2, C3, C6.
--   A4 : connector_deliveries_v2 carries the rich shape the code already expects
--        and ONE status vocabulary (no delivered/sent split)
--   A5 : connector_delivery_attempts_v2 regains (delivery_id, delivery_created_at)
--   A6 : health checks / test runs / audit logs become purpose-built tables
--   C6 : connector_dead_letters is a real, queryable, replayable table instead of
--        an audit-log row with action='delivery.dead_lettered'
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_delivery_status_v2') THEN
    CREATE TYPE connector_delivery_status_v2 AS ENUM (
      'pending','queued','sent','retrying','failed','suppressed','cancelled'
    );
  END IF;
END $$;

-- â”€â”€ 1. connector_deliveries_v2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS connector_deliveries_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  connector_id          UUID NOT NULL,
  route_id              UUID,
  notification_job_id   UUID,
  alert_event_id        UUID,
  channel_kind          notification_channel_kind,
  notification_type     VARCHAR(100) NOT NULL DEFAULT 'alert',
  severity              logdb_severity NOT NULL DEFAULT 'info',

  status                connector_delivery_status_v2 NOT NULL DEFAULT 'pending',
  correlation_id        UUID NOT NULL,
  idempotency_key       VARCHAR(255),

  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_size_bytes    INTEGER,
  response_status_code  INTEGER,
  response_body         TEXT,
  external_message_id   VARCHAR(255),
  error_category        VARCHAR(64),
  error_message         TEXT,
  error_details         JSONB,

  attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts          INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  retry_count           INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at         TIMESTAMPTZ,
  latency_ms            INTEGER,

  sent_at               TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_deliveries_v2_default
  PARTITION OF connector_deliveries_v2 DEFAULT;

-- Idempotent dispatch (02-data-model.md Â§10). No WHERE clause is needed: NULLs are
-- distinct in a unique index by default, so backfilled rows without an idempotency
-- key never collide with each other. This also avoids a partial UNIQUE index on a
-- partitioned table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_deliveries_v2_idem
  ON connector_deliveries_v2 (connector_id, idempotency_key, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_deliveries_v2_correlation
  ON connector_deliveries_v2 (connector_id, correlation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_retry
  ON connector_deliveries_v2 (status, next_retry_at)
  WHERE status IN ('pending','retrying');
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_org
  ON connector_deliveries_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_connector
  ON connector_deliveries_v2 (connector_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_job
  ON connector_deliveries_v2 (notification_job_id, created_at DESC)
  WHERE notification_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_brin
  ON connector_deliveries_v2 USING BRIN (created_at);

COMMENT ON COLUMN connector_deliveries_v2.notification_job_id IS
  'Joins transport truth back to the alert (fixes the queued-forever gap where alert '
  'delivery attempts and connector deliveries had no join key).';

-- â”€â”€ 2. connector_delivery_attempts_v2 (fixes A5: missing delivery_id) â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS connector_delivery_attempts_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  delivery_id           UUID NOT NULL,
  delivery_created_at   TIMESTAMPTZ NOT NULL,
  attempt_number        INTEGER NOT NULL CHECK (attempt_number >= 1),
  status                connector_delivery_status_v2 NOT NULL,
  response_status_code  INTEGER,
  error_category        VARCHAR(64),
  error_message         TEXT,
  response              JSONB,
  duration_ms           INTEGER,
  attempted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, attempted_at)
) PARTITION BY RANGE (attempted_at);

CREATE TABLE IF NOT EXISTS connector_delivery_attempts_v2_default
  PARTITION OF connector_delivery_attempts_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_delivery_attempts_v2_idem
  ON connector_delivery_attempts_v2 (delivery_id, attempt_number, attempted_at);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_v2_delivery
  ON connector_delivery_attempts_v2 (delivery_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_v2_connector
  ON connector_delivery_attempts_v2 (connector_id, status, attempted_at DESC);

-- â”€â”€ 3. connector_health_checks_v2 (purpose-built, fixes A6) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS connector_health_checks_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  connector_id      UUID NOT NULL,
  health_state      VARCHAR(24) NOT NULL,
  response_time_ms  INTEGER,
  error_message     TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, checked_at),
  CONSTRAINT ck_connector_health_checks_v2_state CHECK (
    health_state IN ('healthy','degraded','unhealthy','unknown')
  )
) PARTITION BY RANGE (checked_at);

CREATE TABLE IF NOT EXISTS connector_health_checks_v2_default
  PARTITION OF connector_health_checks_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_health_checks_v2_connector
  ON connector_health_checks_v2 (connector_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_health_checks_v2_unhealthy
  ON connector_health_checks_v2 (organization_id, checked_at DESC)
  WHERE health_state <> 'healthy';

-- â”€â”€ 4. connector_test_runs_v2 (purpose-built, fixes A6) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS connector_test_runs_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  connector_id      UUID NOT NULL,
  triggered_by      UUID,
  status            VARCHAR(24) NOT NULL,
  response          JSONB,
  error_message     TEXT,
  duration_ms       INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_connector_test_runs_v2_status CHECK (
    status IN ('success','failure','error','skipped')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_test_runs_v2_default
  PARTITION OF connector_test_runs_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_test_runs_v2_connector
  ON connector_test_runs_v2 (connector_id, created_at DESC);

-- â”€â”€ 5. connector_audit_logs_v2 (purpose-built, fixes A6) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS connector_audit_logs_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  connector_id      UUID,
  action            VARCHAR(64) NOT NULL,
  actor_type        VARCHAR(24) NOT NULL DEFAULT 'system',
  actor_user_id     UUID,
  previous_state    JSONB,
  new_state         JSONB,
  changes_summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address        INET,
  user_agent        TEXT,
  request_id        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_connector_audit_logs_v2_actor CHECK (
    actor_type IN ('user','system','worker','api')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_audit_logs_v2_default
  PARTITION OF connector_audit_logs_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_connector
  ON connector_audit_logs_v2 (connector_id, created_at DESC)
  WHERE connector_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_org
  ON connector_audit_logs_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_action
  ON connector_audit_logs_v2 (action, created_at DESC);

-- â”€â”€ 6. connector_dead_letters (fixes C6: real DLQ with replay) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS connector_dead_letters (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID,
  delivery_id           UUID,
  notification_job_id   UUID,
  channel_kind          notification_channel_kind,
  failure_category      VARCHAR(64) NOT NULL,
  failure_reason        TEXT NOT NULL,
  error_stack           TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                VARCHAR(24) NOT NULL DEFAULT 'pending_retry',
  replayed_at           TIMESTAMPTZ,
  replayed_by           UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_connector_dead_letters_status CHECK (
    status IN ('pending_retry','replayed','exhausted','discarded')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_dead_letters_default
  PARTITION OF connector_dead_letters DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_status
  ON connector_dead_letters (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_org
  ON connector_dead_letters (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_delivery
  ON connector_dead_letters (delivery_id, created_at DESC)
  WHERE delivery_id IS NOT NULL;

COMMENT ON TABLE connector_dead_letters IS
  'Queryable, replayable connector dead-letter store. Replaces the previous practice '
  'of recording dead letters as connector_audit_logs rows with '
  'action=delivery.dead_lettered, which had no replay path.';

COMMIT;


-- ===== Source: database/migrations/logdb/06_alert_runtime/001_alert_runtime.up.sql =====
BEGIN;

-- Superseded by 002_alert_runtime_v2.up.sql.
--
-- Current alert runtime code writes these Log DB tables:
--   - alert_events_v2
--   - alert_event_state
--   - alert_rule_eval_state
--   - alert_notification_jobs
--   - alert_notification_ledger
--   - alert_delivery_attempts_v2
--   - alert_dead_letter_events_v2
--   - telemetry_outbox (07_outbox)
--
-- Keep this migration as a no-op so fresh Log DB installs do not create the old
-- generic runtime tables/columns below. The old DDL is intentionally commented
-- out for traceability rather than deleted.
--
-- DO $$
-- DECLARE
--   table_name TEXT;
-- BEGIN
--   FOREACH table_name IN ARRAY ARRAY[
--     'alert_rule_executions',
--     'alert_events',
--     'alert_event_batches',
--     'alert_event_history',
--     'alert_acknowledgments',
--     'alert_dead_letter_events',
--     'alert_delivery_attempts',
--     'alert_metrics',
--     'alert_throttle_windows'
--   ] LOOP
--     EXECUTE format($sql$
--       CREATE TABLE IF NOT EXISTS %I (
--         id UUID NOT NULL DEFAULT gen_random_uuid(),
--         organization_id UUID NOT NULL,
--         project_id UUID,
--         environment TEXT,
--         rule_id UUID,
--         event_id UUID,
--         batch_id UUID,
--         severity logdb_severity,
--         status TEXT,
--         action TEXT,
--         actor_user_id UUID,
--         metric_name TEXT,
--         metric_value NUMERIC(20,6),
--         payload JSONB NOT NULL DEFAULT '{}'::jsonb,
--         error_message TEXT,
--         occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--         PRIMARY KEY (id, occurred_at),
--         CHECK (
--           environment IS NULL OR (
--             char_length(environment) BETWEEN 1 AND 64
--             AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
--           )
--         )
--       ) PARTITION BY RANGE (occurred_at)
--     $sql$, table_name);
--     EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I DEFAULT', table_name || '_default', table_name);
--     EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, rule_id, occurred_at DESC)', 'idx_' || table_name || '_rule_time', table_name);
--     EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (project_id, environment, occurred_at DESC)', 'idx_' || table_name || '_environment_time', table_name);
--     EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (status, occurred_at DESC) WHERE status IS NOT NULL', 'idx_' || table_name || '_status_time', table_name);
--     EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (payload)', 'idx_' || table_name || '_payload_gin', table_name);
--     EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (occurred_at)', 'idx_' || table_name || '_occurred_brin', table_name);
--   END LOOP;
-- END $$;
--
-- COMMENT ON TABLE alert_rule_executions IS 'Alert worker execution log. rule_id is an identifier only, never a foreign key to primary alert rules.';
-- COMMENT ON TABLE alert_delivery_attempts IS 'Alert notification delivery attempts. Range partitions support retention and retry dashboard queries.';

COMMIT;


-- ===== Source: database/migrations/logdb/06_alert_runtime/002_alert_runtime_v2.up.sql =====
-- =============================================================================
-- Log DB : L3 â€” Typed, append-oriented alert runtime (v2)
-- Architecture : docs/alerting-redesign/02-data-model.md Â§3
--                docs/alerting-redesign/07-migration-plan.md Â§2 (_v2 + view swap)
--                docs/alerting-redesign/adr/0006-database-ownership.md
-- Increment    : 1 (schema ownership stabilization)
--
-- Replaces the generic 9-table loop in 001_alert_runtime.up.sql. That table set is
-- NOT touched here: this migration is purely additive so old and new code can run
-- side by side during rolling deployment. The rename/view swap is L9 (release N+2)
-- and the legacy drop is L10 (release N+3).
--
-- Fixes audit findings A1, A2, A3, C1, C2, C3.
--   A1/A2 : typed alert_events_v2 / alert_delivery_attempts_v2 replace the generic set
--   A3    : alert_throttle_windows is REPLACED by append-only alert_notification_ledger
--   C1    : append-only tables carry no updated_at; the one mutable projection
--           (alert_event_state) gets the logdb_set_updated_at trigger
--   C2    : every partitioned table gets a DEFAULT partition now; time-bounded
--           partitions are created by the partition manager (L7)
--   C3    : every table carries an explicit idempotency unique index
-- =============================================================================

BEGIN;

-- â”€â”€ 1. alert_events_v2 â€” append-only alert fact â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS alert_events_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  project_id        UUID,
  environment       VARCHAR(64),
  service           VARCHAR(255),
  endpoint          VARCHAR(500),
  rule_id           UUID,
  binding_id        UUID,
  rule_revision     INTEGER,
  kind              alert_event_kind NOT NULL,
  severity          logdb_severity NOT NULL,
  priority          SMALLINT NOT NULL DEFAULT 0,
  fingerprint       VARCHAR(255) NOT NULL,
  dedup_key         VARCHAR(255) NOT NULL,
  correlation_key   VARCHAR(255),
  group_key         VARCHAR(255),
  source            VARCHAR(100) NOT NULL,
  engine            VARCHAR(16) NOT NULL,
  idempotency_key   VARCHAR(255) NOT NULL,
  observed_value    NUMERIC(20,6),
  threshold_value   NUMERIC(20,6),
  evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  labels            JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_alert_events_v2_environment CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  ),
  CONSTRAINT ck_alert_events_v2_engine CHECK (
    engine IN ('fast','window','reconcile','api','legacy')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_events_v2_default PARTITION OF alert_events_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_events_v2_idem
  ON alert_events_v2 (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_fingerprint
  ON alert_events_v2 (organization_id, fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_scope
  ON alert_events_v2 (organization_id, project_id, environment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_rule
  ON alert_events_v2 (organization_id, rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_kind
  ON alert_events_v2 (organization_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_occurred_brin
  ON alert_events_v2 USING BRIN (occurred_at);

COMMENT ON TABLE alert_events_v2 IS
  'Append-only alert fact. rule_id/binding_id are identifiers only, never foreign keys '
  '(cross-database boundary). policy_snapshot stores the EffectiveAlertPolicy actually '
  'executed so history stays explainable after configuration changes.';

-- â”€â”€ 2. alert_event_state â€” the single mutable projection (ADR-0006) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS alert_event_state (
  alert_key                 VARCHAR(255) PRIMARY KEY,
  organization_id           UUID NOT NULL,
  project_id                UUID,
  latest_event_id           UUID NOT NULL,
  state                     alert_state NOT NULL,
  severity                  logdb_severity NOT NULL,
  duplicate_count           INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  first_seen_at             TIMESTAMPTZ NOT NULL,
  last_seen_at              TIMESTAMPTZ NOT NULL,
  last_notified_at          TIMESTAMPTZ,
  acknowledged_by           UUID,
  acknowledged_at           TIMESTAMPTZ,
  acknowledgment_expires_at TIMESTAMPTZ,
  resolved_at               TIMESTAMPTZ,
  resolution_reason         VARCHAR(100),
  auto_resolve_at           TIMESTAMPTZ,
  escalation_policy_id      UUID,
  escalation_step_number    INTEGER NOT NULL DEFAULT 0 CHECK (escalation_step_number >= 0),
  escalation_repeat_count   INTEGER NOT NULL DEFAULT 0 CHECK (escalation_repeat_count >= 0),
  next_escalation_at        TIMESTAMPTZ,
  incident_id               UUID,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_state_active
  ON alert_event_state (organization_id, state, last_seen_at DESC)
  WHERE state IN ('pending','firing','acknowledged');
CREATE INDEX IF NOT EXISTS idx_alert_event_state_escalation
  ON alert_event_state (next_escalation_at)
  WHERE state = 'firing' AND next_escalation_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_autoresolve
  ON alert_event_state (auto_resolve_at)
  WHERE state = 'firing' AND auto_resolve_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_ack_expiry
  ON alert_event_state (acknowledgment_expires_at)
  WHERE state = 'acknowledged' AND acknowledgment_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_incident
  ON alert_event_state (incident_id)
  WHERE incident_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alert_event_state_updated_at ON alert_event_state;
CREATE TRIGGER trg_alert_event_state_updated_at
  BEFORE UPDATE ON alert_event_state
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

COMMENT ON TABLE alert_event_state IS
  'The ONE documented mutable runtime projection (ADR-0006). Holds current alert '
  'lifecycle state; fully rebuildable from alert_events_v2 + alert_event_history_v2.';

-- â”€â”€ 3. alert_event_history_v2 â€” append-only lifecycle audit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS alert_event_history_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  alert_key         VARCHAR(255) NOT NULL,
  alert_event_id    UUID,
  action            VARCHAR(64) NOT NULL,
  actor_type        VARCHAR(24) NOT NULL DEFAULT 'system',
  actor_user_id     UUID,
  previous_state    alert_state,
  new_state         alert_state,
  changes_summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_alert_event_history_v2_actor CHECK (
    actor_type IN ('user','system','worker','api')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_event_history_v2_default
  PARTITION OF alert_event_history_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_alert
  ON alert_event_history_v2 (alert_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_org
  ON alert_event_history_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_event
  ON alert_event_history_v2 (alert_event_id, created_at DESC)
  WHERE alert_event_id IS NOT NULL;

-- â”€â”€ 4. alert_rule_eval_state â€” evaluator breach/cooldown state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Moves consecutive-breach + watermark state OFF the alert_rules config table
-- (04-evaluation-engines.md Â§3) so a 5s tier does not write a config row.
CREATE TABLE IF NOT EXISTS alert_rule_eval_state (
  scope_hash            VARCHAR(64) PRIMARY KEY,
  organization_id       UUID NOT NULL,
  rule_id               UUID NOT NULL,
  binding_id            UUID,
  project_id            UUID,
  environment           VARCHAR(64),
  service               VARCHAR(255),
  endpoint              VARCHAR(500),
  consecutive_breaches  INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_breaches >= 0),
  is_breaching          BOOLEAN NOT NULL DEFAULT FALSE,
  last_evaluated_at     TIMESTAMPTZ,
  last_fired_at         TIMESTAMPTZ,
  last_recovered_at     TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_eval_state_rule
  ON alert_rule_eval_state (rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_rule_eval_state_due
  ON alert_rule_eval_state (organization_id, last_evaluated_at);

DROP TRIGGER IF EXISTS trg_alert_rule_eval_state_updated_at ON alert_rule_eval_state;
CREATE TRIGGER trg_alert_rule_eval_state_updated_at
  BEFORE UPDATE ON alert_rule_eval_state
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

-- â”€â”€ 5. alert_notification_jobs â€” the contract handed to transport â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS alert_notification_jobs (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,
  project_id          UUID,
  alert_event_id      UUID NOT NULL,
  alert_key           VARCHAR(255) NOT NULL,
  channel_kind        notification_channel_kind NOT NULL,
  connector_id        UUID,
  route_id            UUID,
  recipient_user_id   UUID,
  recipient_ref       VARCHAR(320),
  template_id         UUID,
  severity            logdb_severity NOT NULL,
  priority            SMALLINT NOT NULL DEFAULT 0,
  escalation_step     SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_step >= 0),
  attempt_epoch       SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_epoch >= 0),
  payload             JSONB NOT NULL,
  idempotency_key     VARCHAR(255) NOT NULL,
  status              notification_job_status NOT NULL DEFAULT 'pending',
  billable            BOOLEAN NOT NULL DEFAULT TRUE,
  notify_after        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_notification_jobs_default
  PARTITION OF alert_notification_jobs DEFAULT;

-- Zero duplicate notifications (success criterion).
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_notification_jobs_idem
  ON alert_notification_jobs (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_alert
  ON alert_notification_jobs (alert_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_pending
  ON alert_notification_jobs (status, created_at)
  WHERE status IN ('pending','queued');
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_channel
  ON alert_notification_jobs (organization_id, channel_kind, created_at DESC);

COMMENT ON COLUMN alert_notification_jobs.idempotency_key IS
  'sha256(alert_key : channel_kind : recipient_ref : escalation_step : attempt_epoch)';

-- â”€â”€ 6. alert_notification_ledger â€” replaces alert_throttle_windows (A3) â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS alert_notification_ledger (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,
  rule_id             UUID,
  rule_action_id      UUID,
  binding_id          UUID,
  alert_key           VARCHAR(255) NOT NULL,
  channel_kind        notification_channel_kind NOT NULL,
  recipient_user_id   UUID,
  notification_job_id UUID,
  notified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, notified_at)
) PARTITION BY RANGE (notified_at);

CREATE TABLE IF NOT EXISTS alert_notification_ledger_default
  PARTITION OF alert_notification_ledger DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_action_window
  ON alert_notification_ledger (rule_action_id, notified_at DESC)
  WHERE rule_action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_alert_window
  ON alert_notification_ledger (alert_key, notified_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_brin
  ON alert_notification_ledger USING BRIN (notified_at);

COMMENT ON TABLE alert_notification_ledger IS
  'Append-only notification ledger. Throttle decisions are derived by time-window '
  'aggregation (count / max(notified_at)) instead of upserting a mutable window row. '
  'Replaces alert_throttle_windows, which existed with two incompatible schemas.';

-- â”€â”€ 7. alert_delivery_attempts_v2 â€” typed attempt fact (A2, B3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS alert_delivery_attempts_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  alert_event_id        UUID NOT NULL,
  notification_job_id   UUID NOT NULL,
  channel_kind          notification_channel_kind NOT NULL,
  connector_id          UUID,
  route_id              UUID,
  recipient_user_id     UUID,
  attempt_number        SMALLINT NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  status                notification_job_status NOT NULL,
  response_status_code  INTEGER,
  external_message_id   VARCHAR(255),
  error_category        VARCHAR(64),
  error_message         TEXT,
  latency_ms            INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_delivery_attempts_v2_default
  PARTITION OF alert_delivery_attempts_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_delivery_attempts_v2_idem
  ON alert_delivery_attempts_v2 (notification_job_id, attempt_number, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_v2_event
  ON alert_delivery_attempts_v2 (alert_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_v2_connector
  ON alert_delivery_attempts_v2 (connector_id, status, created_at DESC)
  WHERE connector_id IS NOT NULL;

-- â”€â”€ 8. alert_acknowledgments_v2 â€” append-only ack fact â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS alert_acknowledgments_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  alert_key         VARCHAR(255) NOT NULL,
  alert_event_id    UUID,
  acknowledged_by   UUID NOT NULL,
  expires_at        TIMESTAMPTZ,
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_acknowledgments_v2_default
  PARTITION OF alert_acknowledgments_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_acknowledgments_v2_alert
  ON alert_acknowledgments_v2 (alert_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_acknowledgments_v2_org
  ON alert_acknowledgments_v2 (organization_id, created_at DESC);

COMMENT ON TABLE alert_acknowledgments_v2 IS
  'Append-only. The CURRENT acknowledgment lives on alert_event_state; this table is '
  'the immutable audit trail, so no partial-unique is_active index is required.';

-- â”€â”€ 9. alert_metrics_v2 â€” derived runtime metric fact â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS alert_metrics_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  project_id        UUID,
  rule_id           UUID,
  metric_name       VARCHAR(100) NOT NULL,
  metric_value      NUMERIC(20,6) NOT NULL,
  granularity       VARCHAR(16) NOT NULL DEFAULT 'hour',
  bucket            TIMESTAMPTZ NOT NULL,
  labels            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_alert_metrics_v2_granularity CHECK (
    granularity IN ('minute','hour','day','week','month')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_metrics_v2_default
  PARTITION OF alert_metrics_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_metrics_v2_bucket
  ON alert_metrics_v2 (organization_id, metric_name, granularity, bucket, rule_id, created_at)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_alert_metrics_v2_query
  ON alert_metrics_v2 (organization_id, metric_name, bucket DESC);

-- â”€â”€ 10. alert_dead_letter_events_v2 â€” typed DLQ fact â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS alert_dead_letter_events_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  source_queue      VARCHAR(64) NOT NULL,
  pgboss_job_id     UUID,
  alert_event_id    UUID,
  notification_job_id UUID,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message     TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_retries       INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  status            VARCHAR(24) NOT NULL DEFAULT 'pending_retry',
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_alert_dead_letter_events_v2_status CHECK (
    status IN ('pending_retry','retried','exhausted','discarded')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_dead_letter_events_v2_default
  PARTITION OF alert_dead_letter_events_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_events_v2_status
  ON alert_dead_letter_events_v2 (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_events_v2_org
  ON alert_dead_letter_events_v2 (organization_id, created_at DESC);

COMMIT;


-- ===== Source: database/migrations/logdb/06_alert_runtime/003_alert_runtime_idempotency.up.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS alert_runtime_idempotency_keys (
  namespace       VARCHAR(64) NOT NULL,
  organization_id UUID NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (namespace, organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_runtime_idempotency_created
  ON alert_runtime_idempotency_keys (created_at);

INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
SELECT DISTINCT 'alert_event', organization_id, idempotency_key
  FROM alert_events_v2
 WHERE idempotency_key IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
SELECT DISTINCT 'notification_job', organization_id, idempotency_key
  FROM alert_notification_jobs
 WHERE idempotency_key IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
SELECT DISTINCT 'delivery_attempt', organization_id,
       notification_job_id::text || ':' || attempt_number::text
  FROM alert_delivery_attempts_v2
ON CONFLICT DO NOTHING;

COMMENT ON TABLE alert_runtime_idempotency_keys IS
  'Non-partitioned idempotency authority for alert runtime facts. Partition timestamps are never part of identity.';

COMMIT;


-- ===== Source: database/migrations/logdb/06_alert_runtime/004_alert_usage_facts.up.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS alert_usage_facts (
  id               UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL,
  project_id       UUID,
  usage_kind       alert_usage_kind NOT NULL,
  idempotency_key  VARCHAR(255) NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_usage_facts_default
  PARTITION OF alert_usage_facts DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_usage_facts_idem
  ON alert_usage_facts (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_usage_facts_org_kind
  ON alert_usage_facts (organization_id, usage_kind, created_at DESC);

COMMIT;


-- ===== Source: database/migrations/logdb/06_alert_runtime/005_incidents_preferences.up.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS alert_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  fingerprint VARCHAR(255) NOT NULL,
  title VARCHAR(500) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','closed')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_state ON alert_incidents (organization_id, state, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  channel_kind notification_channel_kind NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  vacation_until TIMESTAMPTZ,
  temporary_mute_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id, channel_kind)
);
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_active ON user_notification_preferences (organization_id, user_id, enabled);

CREATE TABLE IF NOT EXISTS alert_correlation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  correlation_key VARCHAR(255) NOT NULL,
  incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, correlation_key)
);

COMMIT;


-- ===== Source: database/migrations/logdb/06_alert_runtime/006_alert_runtime_consolidation.up.sql =====
BEGIN;

ALTER TABLE alert_notification_jobs
  ADD COLUMN IF NOT EXISTS channel_id UUID,
  ADD COLUMN IF NOT EXISTS rule_id UUID,
  ADD COLUMN IF NOT EXISTS binding_id UUID,
  ADD COLUMN IF NOT EXISTS notification_type VARCHAR(64) NOT NULL DEFAULT 'alert',
  ADD COLUMN IF NOT EXISTS routing_decision_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_project_channel
  ON alert_notification_jobs (organization_id, project_id, channel_id, created_at DESC)
  WHERE project_id IS NOT NULL AND channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_rule
  ON alert_notification_jobs (organization_id, rule_id, binding_id, created_at DESC)
  WHERE rule_id IS NOT NULL;

COMMIT;


-- ===== Source: database/migrations/logdb/06_alert_runtime/007_alert_runtime_idempotency_enforcement.up.sql =====
BEGIN;

-- The partitioned fact indexes include created_at, so they cannot guarantee
-- cross-partition uniqueness. The non-partitioned idempotency authority is
-- the durable uniqueness boundary for event, notification, and attempt writes.

CREATE OR REPLACE FUNCTION reserve_alert_runtime_idempotency(
  p_namespace VARCHAR,
  p_organization_id UUID,
  p_idempotency_key VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
  VALUES (p_namespace, p_organization_id, p_idempotency_key)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

COMMENT ON FUNCTION reserve_alert_runtime_idempotency(VARCHAR, UUID, VARCHAR) IS
  'Reserves a runtime identity independent of partition timestamps; false means duplicate.';

COMMIT;


-- ===== Source: database/migrations/logdb/06_alert_runtime/008_notification_delivery_contract.up.sql =====
BEGIN;

ALTER TABLE alert_notification_jobs
  ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(32),
  ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS provider VARCHAR(32);

ALTER TABLE alert_notification_jobs
  DROP CONSTRAINT IF EXISTS ck_alert_notification_jobs_delivery_contract,
  ADD CONSTRAINT ck_alert_notification_jobs_delivery_contract CHECK (
    delivery_mode IS NULL
    OR delivery_mode IN ('NORMAL_CONNECTOR', 'EMAIL_ONLY_RESTRICTED')
  ),
  DROP CONSTRAINT IF EXISTS ck_alert_notification_jobs_restricted_contract,
  ADD CONSTRAINT ck_alert_notification_jobs_restricted_contract CHECK (
    delivery_mode IS NULL
    OR delivery_mode <> 'EMAIL_ONLY_RESTRICTED'
    OR (
      recipient_type = 'PROJECT_OWNER'
      AND provider = 'MANAGED_EMAIL'
      AND channel_kind = 'email'
      AND connector_id IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_delivery_mode
  ON alert_notification_jobs (organization_id, delivery_mode, status, created_at DESC)
  WHERE delivery_mode IS NOT NULL;

COMMIT;


-- ===== Source: database/migrations/logdb/06_alert_runtime/009_drop_dead_alert_incidents.up.sql =====
-- ============================================================================
-- 009_drop_dead_alert_incidents (Log DB)
--
-- PURPOSE
--   Remove the dead `alert_incidents` table (and its FK child
--   `alert_correlation_groups`) from the LOG DB. Incidents are now owned by the
--   PRIMARY database (`09_alerting/001_create_alert_incidents.sql`).
--
-- WHY THIS MATTERS (it is not just tidiness)
--   1. NAME AMBIGUITY IS A LIVE HAZARD. `IncidentsRepository` issues unqualified
--      `alert_incidents` SQL and is constructed with the PRIMARY pool. If any
--      future caller passes the Log DB pool instead, the queries would silently
--      resolve against THIS table - which has no project_id, no status enum, and
--      no partial unique index - producing column errors at best and wrong
--      tenant-scoped results at worst. Deleting the table makes that
--      misconfiguration fail loudly and immediately.
--   2. The Log DB copy is structurally WRONG for incidents:
--        - no `project_id`, so incidents cannot be project-scoped or filtered;
--        - `UNIQUE (organization_id, fingerprint)` is FULL, not partial, so once
--          an incident resolves a second one can NEVER open for that fingerprint.
--          Recurrence is impossible by construction.
--   3. Log DB runtime tables are range-partitioned for retention pruning
--      (00_shared/001_foundation.up.sql). Incident lifecycle must OUTLIVE
--      telemetry retention, so this is the wrong database for it.
--
-- SAFETY
--   Verified before writing this migration: ZERO TypeScript references to
--   `alert_incidents` resolve to the Log DB (all are IncidentsRepository on the
--   primary pool), and ZERO references of any kind to
--   `alert_correlation_groups`. Both are dead schema.
--
--   This migration nonetheless REFUSES TO DESTROY DATA SILENTLY: if either table
--   contains rows it raises and rolls back, so an operator must consciously
--   decide what to do. See the override note below.
--
-- ORDER
--   alert_correlation_groups is dropped first - it holds the FK to
--   alert_incidents.
-- ============================================================================

BEGIN;

-- â”€â”€ Guard: refuse to drop non-empty tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- If this raises, the tables are NOT dead in your environment. Investigate
-- before proceeding. To override deliberately (accepting data loss), comment out
-- this DO block and re-run.
DO $$
DECLARE
  incident_rows   bigint := 0;
  correlation_rows bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'alert_incidents') THEN
    EXECUTE 'SELECT COUNT(*) FROM alert_incidents' INTO incident_rows;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'alert_correlation_groups') THEN
    EXECUTE 'SELECT COUNT(*) FROM alert_correlation_groups' INTO correlation_rows;
  END IF;

  IF incident_rows > 0 OR correlation_rows > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop non-empty Log DB tables: alert_incidents=% row(s), alert_correlation_groups=% row(s). These were expected to be dead schema. Export or migrate the data to the primary-database alert_incidents table first, then re-run with the guard removed.',
      incident_rows, correlation_rows;
  END IF;

  RAISE NOTICE 'Log DB alert_incidents / alert_correlation_groups confirmed empty - safe to drop.';
END $$;

-- â”€â”€ Drop, FK child first â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
DROP TABLE IF EXISTS alert_correlation_groups;
DROP TABLE IF EXISTS alert_incidents;

-- Record the decision so the reason survives in the database itself
-- (same mechanism as 00_shared/001_foundation.up.sql).
INSERT INTO logdb_schema_notes (subject, decision)
VALUES (
  'alert_incident_ownership',
  'Incidents are owned by the PRIMARY database (alert_incidents + alert_incident_events). The Log DB copy was dropped in 009: it lacked project_id, used a FULL unique constraint that made recurrence impossible, and sat in a range-partitioned/retention-pruned schema unsuitable for durable lifecycle state. The Log DB retains only telemetry, alert event facts, runtime state, notification jobs, and delivery attempts.'
)
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;


-- ===== Source: database/migrations/logdb/07_ai_runtime/001_ai_runtime.up.sql =====
BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ai_requests',
    'ai_responses',
    'ai_jobs',
    'ai_cache',
    'ai_event_insights',
    'ai_evaluations',
    'ai_reports',
    'ai_usage_receipts',
    'ai_tool_calls',
    'ai_feedback'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        environment TEXT,
        user_id UUID,
        model TEXT,
        provider TEXT,
        status logdb_ai_status,
        prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
        completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
        total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
        cost_usd NUMERIC(18,8),
        cache_key TEXT,
        input JSONB NOT NULL DEFAULT '{}'::jsonb,
        output JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_message TEXT,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, occurred_at),
        CHECK (
          environment IS NULL OR (
            char_length(environment) BETWEEN 1 AND 64
            AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
          )
        )
      ) PARTITION BY RANGE (occurred_at)
    $sql$, table_name);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, occurred_at DESC)', 'idx_' || table_name || '_org_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (project_id, environment, occurred_at DESC)', 'idx_' || table_name || '_environment_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (model, occurred_at DESC) WHERE model IS NOT NULL', 'idx_' || table_name || '_model_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL', 'idx_' || table_name || '_cache_key', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (metadata)', 'idx_' || table_name || '_metadata_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (occurred_at)', 'idx_' || table_name || '_occurred_brin', table_name);
  END LOOP;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/07_outbox/001_telemetry_outbox.up.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS telemetry_outbox (
  id               BIGSERIAL,
  organization_id  UUID NOT NULL,
  project_id       UUID,
  environment      VARCHAR(64),
  signal_kind      VARCHAR(32) NOT NULL,
  event_id         TEXT NOT NULL,
  severity         logdb_severity,
  fast_path        BOOLEAN NOT NULL DEFAULT FALSE,
  attributes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at       TIMESTAMPTZ,
  claimed_by       VARCHAR(128),
  published_at     TIMESTAMPTZ,
  attempts         SMALLINT NOT NULL DEFAULT 0,
  last_error       TEXT,
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_telemetry_outbox_signal_kind CHECK (
    signal_kind IN ('error','cron_checkin','log','request','metric','message','span','trace','profile','replay')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS telemetry_outbox_default
  PARTITION OF telemetry_outbox DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_outbox_idem
  ON telemetry_outbox (organization_id, signal_kind, event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_unpublished
  ON telemetry_outbox (fast_path DESC, created_at)
  WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_claimed
  ON telemetry_outbox (claimed_at)
  WHERE published_at IS NULL AND claimed_at IS NOT NULL;

COMMENT ON TABLE telemetry_outbox IS
  'Transactional alerting outbox for telemetry persisted into events_*. Fast-path rows drive alert.evaluate.fast; aggregate rows act as hints for window tiers.';

COMMIT;


-- ===== Source: database/migrations/logdb/07_outbox/002_telemetry_outbox_idempotency.up.sql =====
BEGIN;

INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
SELECT DISTINCT 'telemetry_outbox', organization_id, signal_kind || ':' || event_id
  FROM telemetry_outbox
ON CONFLICT DO NOTHING;

COMMENT ON TABLE alert_runtime_idempotency_keys IS
  'Non-partitioned idempotency authority for alert and telemetry runtime facts.';

COMMIT;


-- ===== Source: database/migrations/logdb/07_outbox/003_error_group_regression_outbox.up.sql =====
BEGIN;

ALTER TABLE telemetry_outbox
  DROP CONSTRAINT IF EXISTS ck_telemetry_outbox_signal_kind,
  ADD CONSTRAINT ck_telemetry_outbox_signal_kind CHECK (
    signal_kind IN (
      'error','cron_checkin','log','request','metric','message','span','trace',
      'profile','replay','error_group_regressed'
    )
  );

COMMENT ON TABLE telemetry_outbox IS
  'Committed telemetry and semantic error-group signals for at-least-once alert publication.';

COMMIT;


-- ===== Source: database/migrations/logdb/07_outbox/004_alert_domain_outbox_signal_kind.up.sql =====
BEGIN;

-- =============================================================================
-- Widen telemetry_outbox to carry alert lifecycle domain events, reusing the
-- existing table instead of creating a new one.
--
-- WHY REUSE THIS TABLE RATHER THAN A DEDICATED ONE:
--   The Log DB is currently at its Neon project storage quota (512 MB). A
--   dedicated `alert_domain_outbox` table was the original design (see
--   docs/automationv2/27-alerting-automation-event-contract.md) but CREATE
--   TABLE fails live with "could not extend file because project size limit
--   has been exceeded" â€” verified by isolating the exact failing statement.
--   ALTER TABLE ... ADD CONSTRAINT on an EXISTING table is catalog-only and
--   allocates no new storage, so it succeeds under the same constraint.
--
-- WHY THIS IS SAFE (does not collide with telemetry_outbox's existing use):
--   - `fast_path` for these rows is always FALSE. TelemetryOutboxRelay's claim
--     query filters `WHERE fast_path = TRUE`, so it can never see or race with
--     alert domain event rows.
--   - AlertDomainOutboxRelay (new class) claims rows filtered by
--     `signal_kind = 'alert_domain_event'` exclusively â€” disjoint from every
--     other signal_kind, so it never competes with the telemetry relay either.
--   - `event_id` carries the dedupe key (`alert:{eventType}:{idempotency_key}`),
--     which fits the existing `uq_telemetry_outbox_idem
--     (organization_id, signal_kind, event_id, created_at)` unique index
--     without any index change.
--
-- This is a disclosed compromise, not the preferred end state. If/when the Log
-- DB has storage headroom (plan upgrade, or pruning of existing large tables â€”
-- a data-retention decision out of scope here), migrating this to a dedicated
-- table is a mechanical follow-up: same relay logic, same claim semantics,
-- against a dedicated relation instead of a shared one filtered by signal_kind.
-- =============================================================================

ALTER TABLE telemetry_outbox
  DROP CONSTRAINT IF EXISTS ck_telemetry_outbox_signal_kind,
  ADD CONSTRAINT ck_telemetry_outbox_signal_kind CHECK (
    signal_kind IN (
      'error','cron_checkin','log','request','metric','message','span','trace',
      'profile','replay','error_group_regressed','alert_domain_event'
    )
  );

COMMENT ON TABLE telemetry_outbox IS
  'Committed telemetry, semantic error-group signals, and alert lifecycle domain events (signal_kind=alert_domain_event, fast_path=FALSE) for at-least-once downstream publication.';

COMMIT;


-- ===== Source: database/migrations/logdb/09_search/001_search_indexes.up.sql =====
BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['log_search_index', 'trace_search_index', 'error_search_index'] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        environment TEXT NOT NULL,
        source_event_id UUID,
        source_table TEXT NOT NULL,
        search_text TEXT NOT NULL,
        facets JSONB NOT NULL DEFAULT '{}'::jsonb,
        embedding REAL[],
        occurred_at TIMESTAMPTZ NOT NULL,
        indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, occurred_at),
        CONSTRAINT %I CHECK (
          char_length(environment) BETWEEN 1 AND 64
          AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
        )
      ) PARTITION BY RANGE (occurred_at)
    $sql$, table_name, table_name || '_environment_string_ck');
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (to_tsvector(''english'', search_text))', 'idx_' || table_name || '_text_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (facets)', 'idx_' || table_name || '_facets_gin', table_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id,project_id,environment,occurred_at DESC)',
      'idx_' || table_name || '_tenant_env_time', table_name
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (occurred_at)', 'idx_' || table_name || '_occurred_brin', table_name);
  END LOOP;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/10_lookup/001_lookup_dimensions.up.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS organization_lookup (
  organization_id UUID PRIMARY KEY,
  name TEXT,
  slug TEXT,
  plan_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_lookup (
  project_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT,
  slug TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_lookup_org ON project_lookup(organization_id);
CREATE TABLE IF NOT EXISTS environment_lookup (
  environment_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  name TEXT,
  slug TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_environment_lookup_project ON environment_lookup(project_id);
CREATE TABLE IF NOT EXISTS release_lookup (
  release_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  release TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, release)
);
CREATE TABLE IF NOT EXISTS api_key_lookup (
  api_key_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment_id UUID,
  key_prefix TEXT,
  name TEXT,
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_key_lookup_project_env ON api_key_lookup(project_id, environment_id);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'telemetry_dimensions_service',
    'telemetry_dimensions_endpoint',
    'telemetry_dimensions_release',
    'telemetry_dimensions_browser',
    'telemetry_dimensions_host',
    'telemetry_dimensions_os',
    'telemetry_dimensions_runtime',
    'telemetry_dimensions_region'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        dimension_key TEXT NOT NULL,
        display_name TEXT,
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, project_id, dimension_key)
      )
    $sql$, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, last_seen_at DESC)', 'idx_' || table_name || '_last_seen', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (attributes)', 'idx_' || table_name || '_attrs_gin', table_name);
  END LOOP;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/10_lookup/002_environment_sdk_config_lookup.up.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS environment_sdk_config_lookup (
  environment_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  config_hash TEXT,
  compiled_snapshot JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_environment_sdk_config_lookup_project
  ON environment_sdk_config_lookup(project_id, environment_id);

CREATE INDEX IF NOT EXISTS idx_environment_sdk_config_lookup_org
  ON environment_sdk_config_lookup(organization_id, synced_at DESC);

COMMIT;


-- ===== Source: database/migrations/logdb/10_lookup/003_environment_string_contract.up.sql =====
BEGIN;

-- Breaking telemetry environment contract.
-- SDK telemetry and derived facts use only the normalized SDK-supplied
-- environment string. Credential environment UUIDs/slugs are never converted
-- into a telemetry dimension, and missing values are never fabricated.

DO $$
DECLARE
  t TEXT;
  idx TEXT;
  invalid_rows BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests','events_errors','events_logs','events_metrics','events_spans',
    'events_traces','events_messages','events_profiles','events_replays','events_cron_checkins'
  ] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', t);
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT ''{}''::jsonb',
      t
    );

    -- Preserve a valid existing SDK string, normalizing only envelope whitespace.
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(environment)
       WHERE environment IS NOT NULL
         AND environment<>btrim(environment)
         AND char_length(btrim(environment)) BETWEEN 1 AND 64
         AND btrim(environment) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);

    -- Historical typed rows may carry the original SDK envelope in metadata.
    -- This is the only fallback source considered trustworthy.
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(metadata->>'environment')
       WHERE (
               environment IS NULL
               OR char_length(environment) NOT BETWEEN 1 AND 64
               OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
             )
         AND char_length(btrim(COALESCE(metadata->>'environment',''))) BETWEEN 1 AND 64
         AND btrim(COALESCE(metadata->>'environment','')) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);

    EXECUTE format($sql$
      SELECT count(*)
        FROM %I
       WHERE environment IS NULL
          OR char_length(environment) NOT BETWEEN 1 AND 64
          OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t) INTO invalid_rows;
    IF invalid_rows > 0 THEN
      RAISE EXCEPTION
        'Cannot migrate %: % row(s) lack a trustworthy SDK environment string',
        t, invalid_rows
        USING HINT = 'Backfill metadata.environment from the original SDK envelope, then rerun the migration.';
    END IF;

    EXECUTE format(
      'UPDATE %I SET metadata=jsonb_build_object(''environment'',environment)',
      t
    );
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS environment_id', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN environment SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_environment_string_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (char_length(environment) BETWEEN 1 AND 64 AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$'')',
      t, t || '_environment_string_ck'
    );
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_metadata_environment_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (metadata @> jsonb_build_object(''environment'',environment))',
      t, t || '_metadata_environment_ck'
    );
    idx := 'idx_' || t || '_tenant_env_time';
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id,project_id,environment,occurred_at DESC)',
      idx, t
    );
  END LOOP;
END $$;

-- These operational tables normally remain in the control-plane database. If
-- an older Log DB contains them, migrate only an environment retained in the
-- original job envelope; never translate environment_id through a lookup.
DO $$
DECLARE
  t TEXT;
  has_payload BOOLEAN;
  has_environment_id BOOLEAN;
  invalid_rows BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ingestion_jobs','ingestion_dead_letter_jobs','usage_counter_staging','ingestion_failures'
  ] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', t);
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(environment)
       WHERE environment IS NOT NULL
         AND environment<>btrim(environment)
         AND char_length(btrim(environment)) BETWEEN 1 AND 64
         AND btrim(environment) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name=t AND column_name='payload'
    ) INTO has_payload;
    IF has_payload THEN
      EXECUTE format($sql$
        UPDATE %I
           SET environment=btrim(payload->'metadata'->>'environment')
         WHERE (
                 environment IS NULL
                 OR char_length(environment) NOT BETWEEN 1 AND 64
                 OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
               )
           AND char_length(btrim(COALESCE(payload->'metadata'->>'environment',''))) BETWEEN 1 AND 64
           AND btrim(COALESCE(payload->'metadata'->>'environment','')) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      $sql$, t);
      EXECUTE format($sql$
        UPDATE %I
           SET environment=btrim(payload->>'environment')
         WHERE (
                 environment IS NULL
                 OR char_length(environment) NOT BETWEEN 1 AND 64
                 OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
               )
           AND char_length(btrim(COALESCE(payload->>'environment',''))) BETWEEN 1 AND 64
           AND btrim(COALESCE(payload->>'environment','')) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      $sql$, t);
    END IF;

    EXECUTE format($sql$
      SELECT count(*)
        FROM %I
       WHERE environment IS NULL
          OR char_length(environment) NOT BETWEEN 1 AND 64
          OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t) INTO invalid_rows;
    IF invalid_rows > 0 THEN
      RAISE EXCEPTION
        'Cannot migrate %: % operational row(s) lack an SDK envelope environment',
        t, invalid_rows
        USING HINT = 'Backfill the original job envelope environment or remove non-replayable legacy rows before retrying.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name=t AND column_name='environment_id'
    ) INTO has_environment_id;
    IF has_environment_id AND t='usage_counter_staging' THEN
      EXECUTE 'ALTER TABLE usage_counter_staging DROP CONSTRAINT IF EXISTS usage_counter_staging_pkey';
    END IF;
    IF has_environment_id THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN environment_id', t);
    END IF;
    IF has_environment_id AND t='usage_counter_staging' THEN
      EXECUTE 'ALTER TABLE usage_counter_staging ADD PRIMARY KEY (organization_id,project_id,environment,api_key_id,bucket,event_type)';
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN environment SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_environment_string_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (char_length(environment) BETWEEN 1 AND 64 AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$'')',
      t, t || '_environment_string_ck'
    );
  END LOOP;
END $$;

-- Analytics rows must already carry their SDK environment dimension. They are
-- never relabeled through an environment lookup table; an unsafe historical database stops
-- here so operators can rebuild derived facts from trustworthy typed events.
DO $$
DECLARE
  t TEXT;
  has_environment_id BOOLEAN;
  invalid_rows BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'analytics_hourly_rollup','analytics_daily_rollup','analytics_geo_hourly_rollup',
    'analytics_performance_summary',
    'analytics_user_sessions','analytics_endpoint_minute','analytics_endpoint_hourly',
    'analytics_endpoint_daily','analytics_service_minute','analytics_service_hourly',
    'analytics_service_daily','analytics_trace_latency','analytics_error_occurrences',
    'analytics_error_regressions','analytics_trace_service_edges'
  ] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', t);
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(environment)
       WHERE environment IS NOT NULL
         AND environment<>btrim(environment)
         AND char_length(btrim(environment)) BETWEEN 1 AND 64
         AND btrim(environment) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);
    EXECUTE format($sql$
      SELECT count(*)
        FROM %I
       WHERE environment IS NULL
          OR char_length(environment) NOT BETWEEN 1 AND 64
          OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t) INTO invalid_rows;
    IF invalid_rows > 0 THEN
      RAISE EXCEPTION
        'Cannot migrate %: % analytics row(s) lack a trustworthy SDK environment string',
        t, invalid_rows
        USING HINT = 'Rebuild derived analytics from typed events that retain metadata.environment, then rerun the migration.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name=t AND column_name='environment_id'
    ) INTO has_environment_id;
    IF has_environment_id AND t <> 'analytics_user_sessions' THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_pkey');
    END IF;
    IF has_environment_id THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN environment_id', t);
    END IF;

    IF has_environment_id AND t IN ('analytics_hourly_rollup','analytics_daily_rollup') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD PRIMARY KEY (organization_id,project_id,environment,bucket,metric_name)',
        t
      );
    ELSIF has_environment_id AND t='analytics_geo_hourly_rollup' THEN
      EXECUTE 'ALTER TABLE analytics_geo_hourly_rollup ADD PRIMARY KEY (organization_id,project_id,environment,bucket,country_code,region,city)';
    ELSIF has_environment_id AND t='analytics_performance_summary' THEN
      EXECUTE 'ALTER TABLE analytics_performance_summary ADD PRIMARY KEY (organization_id,project_id,environment,bucket,service,endpoint)';
    ELSIF has_environment_id AND t='analytics_trace_service_edges' THEN
      EXECUTE 'ALTER TABLE analytics_trace_service_edges ADD PRIMARY KEY (organization_id,project_id,environment,bucket,source_service,target_service)';
    ELSIF has_environment_id AND t <> 'analytics_user_sessions' THEN
      EXECUTE format(
        'ALTER TABLE %I ADD PRIMARY KEY (organization_id,project_id,environment,bucket,entity_key)',
        t
      );
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN environment SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_environment_string_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (char_length(environment) BETWEEN 1 AND 64 AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$'')',
      t, t || '_environment_string_ck'
    );
  END LOOP;
END $$;

-- Derived alert and AI runtime facts may be organization-wide. A non-null
-- historical environment UUID, however, must have a trustworthy persisted SDK
-- environment string before the UUID column can be removed.
DO $$
DECLARE
  target_table TEXT;
  source_column TEXT;
  has_environment_id BOOLEAN;
  has_invalid BOOLEAN;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'alert_rule_executions',
    'alert_events',
    'alert_event_batches',
    'alert_event_history',
    'alert_acknowledgments',
    'alert_dead_letter_events',
    'alert_delivery_attempts',
    'alert_metrics',
    'alert_throttle_windows',
    'ai_requests',
    'ai_responses',
    'ai_jobs',
    'ai_cache',
    'ai_event_insights',
    'ai_evaluations',
    'ai_reports',
    'ai_usage_receipts',
    'ai_tool_calls',
    'ai_feedback'
  ] LOOP
    IF to_regclass(target_table) IS NULL THEN
      CONTINUE;
    END IF;

    source_column := CASE WHEN target_table LIKE 'alert_%' THEN 'payload' ELSE 'metadata' END;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', target_table);

    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM %I
         WHERE %I ? ''environment''
           AND (
             jsonb_typeof(%I -> ''environment'') <> ''string''
             OR char_length(btrim(%I ->> ''environment'')) NOT BETWEEN 1 AND 64
             OR btrim(%I ->> ''environment'') !~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$''
           )
       )',
      target_table,
      source_column,
      source_column,
      source_column,
      source_column
    ) INTO has_invalid;

    IF has_invalid THEN
      RAISE EXCEPTION '% contains an invalid persisted %.environment value', target_table, source_column;
    END IF;

    EXECUTE format(
      'UPDATE %I
       SET environment = btrim(%I ->> ''environment'')
       WHERE environment IS NULL AND %I ? ''environment''',
      target_table,
      source_column,
      source_column
    );

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = target_table
        AND column_name = 'environment_id'
    ) INTO has_environment_id;

    IF has_environment_id THEN
      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1 FROM %I
           WHERE environment_id IS NOT NULL AND environment IS NULL
         )',
        target_table
      ) INTO has_invalid;

      IF has_invalid THEN
        RAISE EXCEPTION '% has environment-scoped rows without a trustworthy SDK environment string', target_table;
      END IF;

      EXECUTE format('ALTER TABLE %I DROP COLUMN environment_id', target_table);
    END IF;

    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM %I
         WHERE environment IS NOT NULL
           AND (
             char_length(environment) NOT BETWEEN 1 AND 64
             OR environment !~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$''
           )
       )',
      target_table
    ) INTO has_invalid;

    IF has_invalid THEN
      RAISE EXCEPTION '% contains an invalid environment value', target_table;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      target_table,
      'ck_' || target_table || '_environment'
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (
         environment IS NULL OR (
           char_length(environment) BETWEEN 1 AND 64
           AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$''
         )
       )',
      target_table,
      'ck_' || target_table || '_environment'
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (project_id,environment,occurred_at DESC)',
      'idx_' || target_table || '_environment_time',
      target_table
    );
  END LOOP;
END $$;

-- Search documents are derived telemetry and use the same SDK environment
-- dimension. Existing rows may recover it only from their persisted facets.
DO $$
DECLARE
  t TEXT;
  has_environment_id BOOLEAN;
  invalid_rows BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY['log_search_index','trace_search_index','error_search_index'] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', t);
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(environment)
       WHERE environment IS NOT NULL
         AND environment<>btrim(environment)
         AND char_length(btrim(environment)) BETWEEN 1 AND 64
         AND btrim(environment) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(facets->>'environment')
       WHERE (
               environment IS NULL
               OR char_length(environment) NOT BETWEEN 1 AND 64
               OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
             )
         AND char_length(btrim(COALESCE(facets->>'environment',''))) BETWEEN 1 AND 64
         AND btrim(COALESCE(facets->>'environment','')) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);
    EXECUTE format($sql$
      SELECT count(*)
        FROM %I
       WHERE environment IS NULL
          OR char_length(environment) NOT BETWEEN 1 AND 64
          OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t) INTO invalid_rows;
    IF invalid_rows > 0 THEN
      RAISE EXCEPTION
        'Cannot migrate %: % search row(s) lack a trustworthy SDK environment string',
        t, invalid_rows
        USING HINT = 'Rebuild the search index from canonical typed events, then rerun the migration.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name=t AND column_name='environment_id'
    ) INTO has_environment_id;
    IF has_environment_id THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN environment_id', t);
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN environment SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_environment_string_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (char_length(environment) BETWEEN 1 AND 64 AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$'')',
      t, t || '_environment_string_ck'
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id,project_id,environment,occurred_at DESC)',
      'idx_' || t || '_tenant_env_time', t
    );
  END LOOP;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/10_lookup/004_relax_typed_event_metadata_environment_contract.up.sql =====
BEGIN;

-- The typed-event trigger keeps metadata.environment equal to the server-
-- resolved environment while preserving SDK metadata keys. The original
-- 10_lookup/003 constraint accidentally required metadata to contain only the
-- environment key, which rejected valid SDK-enriched log rows.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests',
    'events_errors',
    'events_logs',
    'events_metrics',
    'events_spans',
    'events_traces',
    'events_messages',
    'events_profiles',
    'events_replays',
    'events_cron_checkins'
  ] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_metadata_environment_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (metadata @> jsonb_build_object(''environment'',environment))',
      t, t || '_metadata_environment_ck'
    );
  END LOOP;
END $$;

COMMIT;


-- ===== Source: database/migrations/logdb/11_geo/001_geo_reference.up.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS geo_countries (
  country_code CHAR(2) PRIMARY KEY,
  country_name TEXT NOT NULL,
  continent_code CHAR(2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS geo_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cidr CIDR NOT NULL,
  country_code CHAR(2),
  region TEXT,
  city TEXT,
  asn INTEGER,
  isp TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cidr)
);
CREATE INDEX IF NOT EXISTS idx_geo_networks_cidr ON geo_networks(cidr);
CREATE INDEX IF NOT EXISTS idx_geo_networks_country ON geo_networks(country_code);

CREATE TABLE IF NOT EXISTS geo_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2),
  region TEXT,
  city TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  timezone TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, region, city)
);
CREATE INDEX IF NOT EXISTS idx_geo_locations_country_region ON geo_locations(country_code, region);

COMMIT;


-- ===== Source: database/migrations/logdb/12_retention/001_retention.up.sql =====
BEGIN;

CREATE TABLE IF NOT EXISTS retention_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  table_name TEXT NOT NULL,
  partition_name TEXT,
  cutoff_at TIMESTAMPTZ NOT NULL,
  state logdb_job_state NOT NULL DEFAULT 'pending',
  rows_deleted BIGINT NOT NULL DEFAULT 0,
  bytes_reclaimed BIGINT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE IF NOT EXISTS retention_jobs_default PARTITION OF retention_jobs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_retention_jobs_claim ON retention_jobs(state, cutoff_at, created_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_retention_jobs_table_time ON retention_jobs(table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_jobs_brin ON retention_jobs USING BRIN (created_at);
DROP TRIGGER IF EXISTS trg_retention_jobs_updated_at ON retention_jobs;
CREATE TRIGGER trg_retention_jobs_updated_at BEFORE UPDATE ON retention_jobs FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS retention_statistics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  table_name TEXT NOT NULL,
  bucket DATE NOT NULL,
  rows_pruned BIGINT NOT NULL DEFAULT 0,
  bytes_pruned BIGINT NOT NULL DEFAULT 0,
  oldest_remaining_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS retention_statistics_default PARTITION OF retention_statistics DEFAULT;
CREATE INDEX IF NOT EXISTS idx_retention_statistics_table_bucket ON retention_statistics(table_name, bucket DESC);

COMMIT;


-- ===== Source: database/migrations/logdb/13_legacy/001_legacy_compat.up.sql =====
BEGIN;

-- Intentionally inert. The canonical events_* tables are the only telemetry
-- persistence model. Recreating the former spans/traces/errors/requests tables
-- here would restore a second event schema and the removed environment UUID
-- contract after 10_lookup/003_environment_string_contract.up.sql.

COMMIT;


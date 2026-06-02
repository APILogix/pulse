-- ============================================================================
-- 014_errors_requests_storage.sql
-- ----------------------------------------------------------------------------
-- Adds partitioned, tenant-isolated storage for the `error` and `request`
-- event types so the new ingestion worker can persist them durably.
--
-- The legacy events/error_events/request_events tables (schema4log.sql) were
-- never applied to this database — so errors and requests had nowhere to land.
-- These tables complete telemetry coverage for all 10 SDK event types and
-- mirror the partitioning/indexing strategy of migration 013.
--
-- error_groups is a small, non-partitioned aggregation table used by the
-- analytics dashboards (fingerprint rollups). A trigger keeps it current.
--
-- Idempotent. Safe to run repeatedly.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) ERRORS (type 'error')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS errors (
    id            UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id    UUID        NOT NULL,
    org_id        UUID,

    message       TEXT        NOT NULL,
    error_type    VARCHAR(256) NOT NULL DEFAULT 'UnknownError',
    fingerprint   VARCHAR(128) NOT NULL,
    severity      VARCHAR(16),
    stack         JSONB,
    context       JSONB,
    breadcrumbs   JSONB,

    request_id    VARCHAR(64),
    trace_id      VARCHAR(64),
    span_id       VARCHAR(64),
    session_id    VARCHAR(64),

    resolved_at   TIMESTAMPTZ,
    resolved_by   UUID,

    timestamp     TIMESTAMPTZ NOT NULL,
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS errors_default PARTITION OF errors DEFAULT;
CREATE INDEX IF NOT EXISTS idx_errors_project_time
  ON errors (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_fingerprint
  ON errors (project_id, fingerprint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_unresolved
  ON errors (project_id, timestamp DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_errors_trace
  ON errors (project_id, trace_id) WHERE trace_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2) REQUESTS (type 'request')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS requests (
    id            UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id    UUID        NOT NULL,
    org_id        UUID,

    request_id    VARCHAR(64),
    url           TEXT,
    method        VARCHAR(10),
    status_code   INTEGER,
    latency_ms    DOUBLE PRECISION,
    body_size     INTEGER,
    response_size INTEGER,

    user_id       TEXT,
    tenant_id     VARCHAR(128),
    session_id    VARCHAR(64),
    client_ip     INET,
    user_agent    TEXT,
    referer       TEXT,
    route         TEXT,

    trace_id      VARCHAR(64),
    span_id       VARCHAR(64),

    -- Privacy-gated bags (only present when SDK privacy config allows).
    headers       JSONB,
    query         JSONB,

    timestamp     TIMESTAMPTZ NOT NULL,
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS requests_default PARTITION OF requests DEFAULT;
CREATE INDEX IF NOT EXISTS idx_requests_project_time
  ON requests (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status
  ON requests (project_id, status_code, timestamp DESC) WHERE status_code >= 400;
CREATE INDEX IF NOT EXISTS idx_requests_latency
  ON requests (project_id, latency_ms, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_route
  ON requests (project_id, route, timestamp DESC) WHERE route IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_trace
  ON requests (project_id, trace_id) WHERE trace_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) ERROR_GROUPS — fingerprint aggregation (hot, non-partitioned)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS error_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL,
    fingerprint     VARCHAR(128) NOT NULL,
    first_seen      TIMESTAMPTZ NOT NULL,
    last_seen       TIMESTAMPTZ NOT NULL,
    occurrences     BIGINT NOT NULL DEFAULT 1,
    last_message    TEXT,
    error_type      VARCHAR(256),
    is_resolved     BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ,
    priority        INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_error_groups_active
  ON error_groups (project_id, last_seen DESC) WHERE is_resolved = FALSE;

COMMENT ON TABLE errors IS 'Error events (SDK type=error), partitioned monthly.';
COMMENT ON TABLE requests IS 'Request events (SDK type=request), partitioned monthly.';
COMMENT ON TABLE error_groups IS 'Fingerprint aggregation for error analytics.';

COMMIT;

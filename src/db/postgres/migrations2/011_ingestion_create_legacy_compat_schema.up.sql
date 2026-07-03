-- ============================================================================
-- 011_ingestion_create_legacy_compat_schema.up.sql
-- ----------------------------------------------------------------------------
-- Compatibility copy of the legacy ingestion storage tables that still have
-- code references in the current worker tier.
--
-- Why this exists:
--   * `migrations2/004` is the authoritative live telemetry schema
--     (`events_*`, `analytics_*`).
--   * Some infrastructure code still references the older table names from
--     `migrations/013-014` (`spans`, `traces`, `metrics`, `logs`, `profiles`,
--     `cron_checkins`, `replays`, `messages`, `sdk_sessions`, `errors`,
--     `requests`, `error_groups`, `ingestion_failures`).
--   * The migration runner now points to `migrations2`, so these legacy names
--     must also exist there until the remaining stale code is removed.
--
-- This migration intentionally preserves the legacy table names without
-- changing the authoritative runtime write path.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS spans (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    trace_id VARCHAR(64) NOT NULL,
    span_id VARCHAR(64) NOT NULL,
    parent_span_id VARCHAR(64),
    name TEXT NOT NULL,
    kind VARCHAR(16),
    status VARCHAR(16),
    status_message TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_ms DOUBLE PRECISION,
    exclusive_duration_ms DOUBLE PRECISION,
    attributes JSONB,
    events JSONB,
    links JSONB,
    request_id VARCHAR(64),
    session_id VARCHAR(64),
    user_id TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS spans_default PARTITION OF spans DEFAULT;
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans (project_id, trace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans (project_id, parent_span_id) WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_project_time ON spans (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_attrs_gin ON spans USING GIN (attributes);

CREATE TABLE IF NOT EXISTS traces (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    trace_id VARCHAR(64) NOT NULL,
    root_span JSONB NOT NULL,
    span_count INTEGER NOT NULL DEFAULT 0,
    total_duration_ms DOUBLE PRECISION,
    is_partial BOOLEAN NOT NULL DEFAULT FALSE,
    root_name TEXT,
    has_error BOOLEAN NOT NULL DEFAULT FALSE,
    request_id VARCHAR(64),
    session_id VARCHAR(64),
    user_id TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS traces_default PARTITION OF traces DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_unique ON traces (project_id, trace_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_traces_project_time ON traces (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traces_errors ON traces (project_id, timestamp DESC) WHERE has_error = TRUE;

CREATE TABLE IF NOT EXISTS metrics (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    metric_name VARCHAR(255) NOT NULL,
    metric_type VARCHAR(16) NOT NULL,
    value DOUBLE PRECISION,
    unit VARCHAR(32),
    count BIGINT,
    sum DOUBLE PRECISION,
    min DOUBLE PRECISION,
    max DOUBLE PRECISION,
    avg DOUBLE PRECISION,
    buckets JSONB,
    tags JSONB,
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS metrics_default PARTITION OF metrics DEFAULT;
CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON metrics (project_id, metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_tags_gin ON metrics USING GIN (tags);

CREATE TABLE IF NOT EXISTS logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    level VARCHAR(16) NOT NULL,
    message TEXT NOT NULL,
    args JSONB,
    request_id VARCHAR(64),
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS logs_default PARTITION OF logs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_logs_project_time ON logs (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (project_id, level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs (project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS profiles (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    profile_type VARCHAR(16) NOT NULL,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    duration_ms DOUBLE PRECISION,
    profile JSONB,
    request_id VARCHAR(64),
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS profiles_default PARTITION OF profiles DEFAULT;
CREATE INDEX IF NOT EXISTS idx_profiles_project_time ON profiles (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_trace ON profiles (project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cron_checkins (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    monitor_slug VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL,
    duration_ms DOUBLE PRECISION,
    environment VARCHAR(64),
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS cron_checkins_default PARTITION OF cron_checkins DEFAULT;
CREATE INDEX IF NOT EXISTS idx_cron_monitor_time ON cron_checkins (project_id, monitor_slug, timestamp DESC);

CREATE TABLE IF NOT EXISTS replays (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    session_id VARCHAR(64) NOT NULL,
    segment_id INTEGER NOT NULL,
    events JSONB NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS replays_default PARTITION OF replays DEFAULT;
CREATE INDEX IF NOT EXISTS idx_replays_session ON replays (project_id, session_id, segment_id);

CREATE TABLE IF NOT EXISTS messages (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    message TEXT NOT NULL,
    severity VARCHAR(16) NOT NULL,
    context JSONB,
    breadcrumbs JSONB,
    request_id VARCHAR(64),
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS messages_default PARTITION OF messages DEFAULT;
CREATE INDEX IF NOT EXISTS idx_messages_project_time ON messages (project_id, severity, timestamp DESC);

CREATE TABLE IF NOT EXISTS sdk_sessions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    session_id VARCHAR(64) NOT NULL,
    started_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    event_count BIGINT NOT NULL DEFAULT 0,
    error_count BIGINT NOT NULL DEFAULT 0,
    crashed BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(16),
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS sdk_sessions_default PARTITION OF sdk_sessions DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdk_sessions_unique ON sdk_sessions (project_id, session_id, timestamp);

CREATE TABLE IF NOT EXISTS ingestion_failures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID,
    org_id UUID,
    event_type VARCHAR(32),
    reason VARCHAR(64) NOT NULL,
    detail TEXT,
    raw_excerpt JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_project ON ingestion_failures (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_reason ON ingestion_failures (reason, created_at DESC);

CREATE TABLE IF NOT EXISTS errors (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    message TEXT NOT NULL,
    error_type VARCHAR(256) NOT NULL DEFAULT 'UnknownError',
    fingerprint VARCHAR(128) NOT NULL,
    severity VARCHAR(16),
    stack JSONB,
    context JSONB,
    breadcrumbs JSONB,
    request_id VARCHAR(64),
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    session_id VARCHAR(64),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS errors_default PARTITION OF errors DEFAULT;
CREATE INDEX IF NOT EXISTS idx_errors_project_time ON errors (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_fingerprint ON errors (project_id, fingerprint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_unresolved ON errors (project_id, timestamp DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_errors_trace ON errors (project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS requests (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    org_id UUID,
    request_id VARCHAR(64),
    url TEXT,
    method VARCHAR(10),
    status_code INTEGER,
    latency_ms DOUBLE PRECISION,
    body_size INTEGER,
    response_size INTEGER,
    user_id TEXT,
    tenant_id VARCHAR(128),
    session_id VARCHAR(64),
    client_ip INET,
    user_agent TEXT,
    referer TEXT,
    route TEXT,
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    headers JSONB,
    query JSONB,
    timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS requests_default PARTITION OF requests DEFAULT;
CREATE INDEX IF NOT EXISTS idx_requests_project_time ON requests (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (project_id, status_code, timestamp DESC) WHERE status_code >= 400;
CREATE INDEX IF NOT EXISTS idx_requests_latency ON requests (project_id, latency_ms, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_route ON requests (project_id, route, timestamp DESC) WHERE route IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_trace ON requests (project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS error_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    fingerprint VARCHAR(128) NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL,
    occurrences BIGINT NOT NULL DEFAULT 1,
    last_message TEXT,
    error_type VARCHAR(256),
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_error_groups_active ON error_groups (project_id, last_seen DESC) WHERE is_resolved = FALSE;

COMMIT;


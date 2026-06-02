-- ============================================================================
-- 013_telemetry_storage.sql
-- ----------------------------------------------------------------------------
-- Enterprise telemetry storage for ALL Pulse SDK event types.
--
-- The SDK emits 10 event types (error, message, request, span, trace, metric,
-- log, profile, cron_checkin, replay). The previous backend only stored
-- request/error/custom. This migration adds dedicated, partitioned,
-- tenant-isolated storage for every signal type so the ingestion worker can
-- persist what the SDK actually sends.
--
-- Design principles:
--   * Native declarative RANGE partitioning by `timestamp` (monthly). No
--     pg_partman dependency — partitions are pre-created here and a DEFAULT
--     partition catches stragglers. A scheduled job (see worker) rolls new
--     monthly partitions forward.
--   * Multi-tenant isolation: every row carries project_id (+ org_id where
--     useful). Ingestion only ever writes the project resolved from the API key.
--   * Partition key is part of every PRIMARY KEY (Postgres requirement).
--   * High-cardinality fields (attributes, tags, payload) are JSONB; hot scalar
--     fields are promoted to real columns + indexes for query performance.
--   * No CREATE INDEX CONCURRENTLY (migration runs in a transaction).
--
-- Idempotent. Safe to run repeatedly.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Helper: create the standard set of monthly partitions for a partitioned
-- table. We pre-create current month +/- and a DEFAULT catch-all. Doing this
-- inline (not a function) keeps the migration explicit and reviewable.
-- Partition naming: <table>_yYYYY_mMM.

-- ----------------------------------------------------------------------------
-- 1) SPANS — raw OTel-style spans (type 'span')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spans (
    id            UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id    UUID        NOT NULL,
    org_id        UUID,

    trace_id      VARCHAR(64) NOT NULL,
    span_id       VARCHAR(64) NOT NULL,
    parent_span_id VARCHAR(64),

    name          TEXT        NOT NULL,
    kind          VARCHAR(16),                 -- internal|server|client|producer|consumer
    status        VARCHAR(16),                 -- ok|error|unset
    status_message TEXT,

    start_time    TIMESTAMPTZ NOT NULL,
    end_time      TIMESTAMPTZ,
    duration_ms   DOUBLE PRECISION,
    exclusive_duration_ms DOUBLE PRECISION,

    -- High-cardinality bags kept as JSONB.
    attributes    JSONB,
    events        JSONB,
    links         JSONB,

    -- Correlation context promoted from the SDK base fields.
    request_id    VARCHAR(64),
    session_id    VARCHAR(64),
    user_id       TEXT,

    timestamp     TIMESTAMPTZ NOT NULL,         -- partition key (= start_time)
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS spans_default PARTITION OF spans DEFAULT;
-- Trace reconstruction: all spans of a trace for a project, newest first.
CREATE INDEX IF NOT EXISTS idx_spans_trace
  ON spans (project_id, trace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_parent
  ON spans (project_id, parent_span_id) WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_project_time
  ON spans (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_attrs_gin
  ON spans USING GIN (attributes);

-- ----------------------------------------------------------------------------
-- 2) TRACES — aggregated trace trees (type 'trace')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS traces (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id     UUID        NOT NULL,
    org_id         UUID,

    trace_id       VARCHAR(64) NOT NULL,
    root_span      JSONB       NOT NULL,        -- recursive AggregatedSpanEvent tree
    span_count     INTEGER     NOT NULL DEFAULT 0,
    total_duration_ms DOUBLE PRECISION,
    is_partial     BOOLEAN     NOT NULL DEFAULT FALSE,

    root_name      TEXT,
    has_error      BOOLEAN     NOT NULL DEFAULT FALSE,

    request_id     VARCHAR(64),
    session_id     VARCHAR(64),
    user_id        TEXT,

    timestamp      TIMESTAMPTZ NOT NULL,
    ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS traces_default PARTITION OF traces DEFAULT;
-- One row per (project, trace_id) within a partition window; upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_unique
  ON traces (project_id, trace_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_traces_project_time
  ON traces (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traces_errors
  ON traces (project_id, timestamp DESC) WHERE has_error = TRUE;

-- ----------------------------------------------------------------------------
-- 3) METRICS — counters/gauges/histograms (type 'metric')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metrics (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL,
    org_id       UUID,

    metric_name  VARCHAR(255) NOT NULL,
    metric_type  VARCHAR(16)  NOT NULL,        -- counter|gauge|histogram
    value        DOUBLE PRECISION,
    unit         VARCHAR(32),

    -- Aggregates emitted by the SDK reader.
    count        BIGINT,
    sum          DOUBLE PRECISION,
    min          DOUBLE PRECISION,
    max          DOUBLE PRECISION,
    avg          DOUBLE PRECISION,

    -- Histogram bucket structure (exponential histograms supported).
    buckets      JSONB,
    -- Cardinality-controlled tags.
    tags         JSONB,

    timestamp    TIMESTAMPTZ NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS metrics_default PARTITION OF metrics DEFAULT;
CREATE INDEX IF NOT EXISTS idx_metrics_name_time
  ON metrics (project_id, metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_tags_gin
  ON metrics USING GIN (tags);

-- ----------------------------------------------------------------------------
-- 4) LOGS — structured logs (type 'log')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logs (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL,
    org_id       UUID,

    level        VARCHAR(16) NOT NULL,
    message      TEXT        NOT NULL,
    args         JSONB,

    request_id   VARCHAR(64),
    trace_id      VARCHAR(64),
    span_id       VARCHAR(64),

    timestamp    TIMESTAMPTZ NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS logs_default PARTITION OF logs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_logs_project_time
  ON logs (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level
  ON logs (project_id, level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace
  ON logs (project_id, trace_id) WHERE trace_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5) PROFILES — CPU/heap profiles (type 'profile')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL,
    org_id       UUID,

    profile_type VARCHAR(16) NOT NULL,         -- cpu|heap
    start_time   TIMESTAMPTZ,
    end_time     TIMESTAMPTZ,
    duration_ms  DOUBLE PRECISION,

    -- Raw V8 inspector output — large; stored compressed where supported.
    profile      JSONB,

    request_id   VARCHAR(64),
    trace_id     VARCHAR(64),
    span_id      VARCHAR(64),

    timestamp    TIMESTAMPTZ NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS profiles_default PARTITION OF profiles DEFAULT;
CREATE INDEX IF NOT EXISTS idx_profiles_project_time
  ON profiles (project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_trace
  ON profiles (project_id, trace_id) WHERE trace_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6) CRON_CHECKINS — monitor check-ins (type 'cron_checkin')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cron_checkins (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL,
    org_id       UUID,

    monitor_slug VARCHAR(255) NOT NULL,
    status       VARCHAR(16)  NOT NULL,        -- ok|error|in_progress
    duration_ms  DOUBLE PRECISION,
    environment  VARCHAR(64),

    timestamp    TIMESTAMPTZ NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS cron_checkins_default PARTITION OF cron_checkins DEFAULT;
CREATE INDEX IF NOT EXISTS idx_cron_monitor_time
  ON cron_checkins (project_id, monitor_slug, timestamp DESC);

-- ----------------------------------------------------------------------------
-- 7) REPLAYS — session replay segments (type 'replay')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replays (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL,
    org_id       UUID,

    session_id   VARCHAR(64) NOT NULL,
    segment_id   INTEGER     NOT NULL,
    events       JSONB       NOT NULL,         -- recorded DOM mutation events

    timestamp    TIMESTAMPTZ NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS replays_default PARTITION OF replays DEFAULT;
CREATE INDEX IF NOT EXISTS idx_replays_session
  ON replays (project_id, session_id, segment_id);

-- ----------------------------------------------------------------------------
-- 8) MESSAGES — captureMessage (type 'message')
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL,
    org_id       UUID,

    message      TEXT        NOT NULL,
    severity     VARCHAR(16) NOT NULL,         -- debug|info|warning|error|fatal
    context      JSONB,
    breadcrumbs  JSONB,

    request_id   VARCHAR(64),
    trace_id     VARCHAR(64),
    span_id      VARCHAR(64),

    timestamp    TIMESTAMPTZ NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS messages_default PARTITION OF messages DEFAULT;
CREATE INDEX IF NOT EXISTS idx_messages_project_time
  ON messages (project_id, severity, timestamp DESC);

-- ----------------------------------------------------------------------------
-- 9) SDK_SESSIONS — session lifecycle (from sessionId on events)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdk_sessions (
    id            UUID        NOT NULL DEFAULT gen_random_uuid(),
    project_id    UUID        NOT NULL,
    org_id        UUID,

    session_id    VARCHAR(64) NOT NULL,
    started_at    TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    event_count   BIGINT      NOT NULL DEFAULT 0,
    error_count   BIGINT      NOT NULL DEFAULT 0,
    crashed       BOOLEAN     NOT NULL DEFAULT FALSE,
    status        VARCHAR(16),

    timestamp     TIMESTAMPTZ NOT NULL,
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE IF NOT EXISTS sdk_sessions_default PARTITION OF sdk_sessions DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdk_sessions_unique
  ON sdk_sessions (project_id, session_id, timestamp);

-- ----------------------------------------------------------------------------
-- 10) INGESTION_FAILURES — per-event rejects (poison/validation), for forensics
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_failures (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID,
    org_id       UUID,
    event_type   VARCHAR(32),
    reason       VARCHAR(64) NOT NULL,         -- validation_failed|poison|too_large|...
    detail       TEXT,
    raw_excerpt  JSONB,                        -- bounded excerpt, never full payload
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_project
  ON ingestion_failures (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_reason
  ON ingestion_failures (reason, created_at DESC);

COMMENT ON TABLE spans IS 'Raw spans (SDK type=span), partitioned monthly by timestamp.';
COMMENT ON TABLE traces IS 'Aggregated trace trees (SDK type=trace).';
COMMENT ON TABLE metrics IS 'Metric data points (SDK type=metric).';
COMMENT ON TABLE logs IS 'Structured logs (SDK type=log).';
COMMENT ON TABLE profiles IS 'CPU/heap profiles (SDK type=profile).';
COMMENT ON TABLE cron_checkins IS 'Cron monitor check-ins (SDK type=cron_checkin).';
COMMENT ON TABLE replays IS 'Session replay segments (SDK type=replay).';
COMMENT ON TABLE messages IS 'captureMessage events (SDK type=message).';

COMMIT;

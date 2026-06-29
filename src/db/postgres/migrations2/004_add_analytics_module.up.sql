-- ============================================================================
-- 004_add_analytics_module.up.sql
-- ----------------------------------------------------------------------------
-- Analytics module for Pulse SDK event data: 10 time-partitioned event tables,
-- rollup/aggregate tables, and config tables (dashboards, saved queries,
-- analytics alerts).
--
-- Idempotent + safe-to-run-on-fresh-DB. Depends only on pgcrypto.
--
-- Conventions match 002/003:
--   * Enums guarded via DO/IF NOT EXISTS.
--   * Partitioned event tables use composite PK (id, created_at) — a partition
--     key MUST be part of every unique/primary key in PostgreSQL.
--   * Each event table gets a DEFAULT partition so inserts never fail before
--     the daily-partition maintenance job has run; create_event_partitions()
--     pre-creates a week of daily partitions.
--   * BRIN indexes use the correct `USING BRIN (col)` syntax (the spec's
--     "CREATE BRIN INDEX" is not valid SQL).
--   * Time-windowed partial indexes from the spec are NOT used: an index
--     predicate must be IMMUTABLE, and `NOW() - INTERVAL ...` is not, so those
--     statements would fail. Plain composite indexes are used instead.
--   * RLS is INTENTIONALLY DISABLED (commented at bottom) — this codebase does
--     tenant isolation in the service layer and never sets app.current_org_id.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_severity') THEN
    CREATE TYPE event_severity AS ENUM ('debug', 'info', 'warning', 'error', 'fatal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'span_status') THEN
    CREATE TYPE span_status AS ENUM ('ok', 'error', 'unset');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'span_kind') THEN
    CREATE TYPE span_kind AS ENUM ('internal', 'server', 'client', 'producer', 'consumer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_metric_type') THEN
    CREATE TYPE analytics_metric_type AS ENUM ('counter', 'gauge', 'histogram');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'log_level') THEN
    CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cron_status') THEN
    CREATE TYPE cron_status AS ENUM ('ok', 'error', 'in_progress');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_group_status') THEN
    CREATE TYPE error_group_status AS ENUM ('unresolved', 'resolved', 'ignored', 'muted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rollup_granularity') THEN
    CREATE TYPE rollup_granularity AS ENUM ('hour', 'day', 'week', 'month');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_alert_operator') THEN
    CREATE TYPE analytics_alert_operator AS ENUM ('gt', 'lt', 'eq', 'gte', 'lte');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- EVENT TABLES (partitioned by created_at, daily)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events_errors (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    message TEXT NOT NULL,
    error_name VARCHAR(256) NOT NULL,
    severity event_severity NOT NULL DEFAULT 'error',
    stack_hash VARCHAR(64),
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    request_id VARCHAR(64),
    session_id VARCHAR(64),
    source VARCHAR(100) NOT NULL DEFAULT 'capture',
    mechanism VARCHAR(50),
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    server_name VARCHAR(100),
    stack_frames JSONB,
    source_context JSONB,
    user_id VARCHAR(255),
    user_email VARCHAR(255),
    user_ip INET,
    breadcrumbs JSONB,
    tags JSONB DEFAULT '{}',
    extra JSONB DEFAULT '{}',
    contexts JSONB DEFAULT '{}',
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_errors_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS events_messages (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    message TEXT NOT NULL,
    severity event_severity NOT NULL DEFAULT 'info',
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    request_id VARCHAR(64),
    session_id VARCHAR(64),
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    user_id VARCHAR(255),
    user_ip INET,
    tags JSONB DEFAULT '{}',
    contexts JSONB DEFAULT '{}',
    breadcrumbs JSONB,
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_messages_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS events_requests (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    url TEXT NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    route VARCHAR(500),
    framework VARCHAR(50),
    headers JSONB,
    query_params JSONB,
    body JSONB,
    body_size INTEGER,
    response_size INTEGER,
    user_id VARCHAR(255),
    tenant_id VARCHAR(255),
    session_id VARCHAR(64),
    client_ip INET,
    user_agent TEXT,
    referer TEXT,
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    is_slow BOOLEAN GENERATED ALWAYS AS (latency_ms > 1000) STORED,
    is_error BOOLEAN GENERATED ALWAYS AS (status_code >= 500) STORED,
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_requests_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS events_spans (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    span_id VARCHAR(64) NOT NULL,
    trace_id VARCHAR(64) NOT NULL,
    parent_span_id VARCHAR(64),
    name VARCHAR(500) NOT NULL,
    kind span_kind,
    status span_status NOT NULL DEFAULT 'unset',
    status_message TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_ms INTEGER,
    exclusive_duration_ms INTEGER,
    attributes JSONB DEFAULT '{}',
    events JSONB,
    links JSONB,
    db_system VARCHAR(50),
    db_name VARCHAR(100),
    db_operation VARCHAR(50),
    db_collection VARCHAR(100),
    db_statement TEXT,
    http_method VARCHAR(10),
    http_url TEXT,
    http_status_code INTEGER,
    http_host VARCHAR(255),
    http_route VARCHAR(500),
    messaging_system VARCHAR(50),
    messaging_destination VARCHAR(255),
    messaging_operation VARCHAR(50),
    request_id VARCHAR(64),
    session_id VARCHAR(64),
    user_id VARCHAR(255),
    tenant_id VARCHAR(255),
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_spans_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS events_traces (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    trace_id VARCHAR(64) NOT NULL,
    root_span_name VARCHAR(500),
    root_span_id VARCHAR(64),
    span_count INTEGER NOT NULL DEFAULT 0,
    total_duration_ms INTEGER,
    is_partial BOOLEAN DEFAULT false,
    spans_tree JSONB,
    request_id VARCHAR(64),
    session_id VARCHAR(64),
    user_id VARCHAR(255),
    tenant_id VARCHAR(255),
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_traces_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS events_metrics (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_type analytics_metric_type NOT NULL,
    value NUMERIC NOT NULL,
    unit VARCHAR(50),
    tags JSONB DEFAULT '{}',
    count INTEGER,
    sum NUMERIC,
    min NUMERIC,
    max NUMERIC,
    avg NUMERIC,
    rate NUMERIC,
    buckets JSONB,
    p50 NUMERIC,
    p75 NUMERIC,
    p90 NUMERIC,
    p95 NUMERIC,
    p99 NUMERIC,
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    request_id VARCHAR(64),
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_metrics_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS events_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    level log_level NOT NULL,
    message TEXT NOT NULL,
    args JSONB,
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    request_id VARCHAR(64),
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    user_id VARCHAR(255),
    user_ip INET,
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_logs_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS events_profiles (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    profile_type VARCHAR(20) NOT NULL DEFAULT 'cpu',
    trace_id VARCHAR(64),
    span_id VARCHAR(64),
    request_id VARCHAR(64),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_ms INTEGER,
    profile_data JSONB,
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_profiles_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS events_cron_checkins (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    monitor_slug VARCHAR(255) NOT NULL,
    status cron_status NOT NULL,
    duration_ms INTEGER,
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_cron_checkins_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS events_replays (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    event_id VARCHAR(64) NOT NULL,
    session_id VARCHAR(64) NOT NULL,
    segment_id INTEGER NOT NULL,
    events JSONB,
    service VARCHAR(100),
    environment VARCHAR(50),
    release VARCHAR(100),
    sdk_name VARCHAR(50),
    sdk_version VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT events_replays_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- DEFAULT partitions so inserts succeed before/after daily partitions exist.
CREATE TABLE IF NOT EXISTS events_errors_default        PARTITION OF events_errors        DEFAULT;
CREATE TABLE IF NOT EXISTS events_messages_default       PARTITION OF events_messages       DEFAULT;
CREATE TABLE IF NOT EXISTS events_requests_default       PARTITION OF events_requests       DEFAULT;
CREATE TABLE IF NOT EXISTS events_spans_default          PARTITION OF events_spans          DEFAULT;
CREATE TABLE IF NOT EXISTS events_traces_default         PARTITION OF events_traces         DEFAULT;
CREATE TABLE IF NOT EXISTS events_metrics_default        PARTITION OF events_metrics        DEFAULT;
CREATE TABLE IF NOT EXISTS events_logs_default           PARTITION OF events_logs           DEFAULT;
CREATE TABLE IF NOT EXISTS events_profiles_default       PARTITION OF events_profiles       DEFAULT;
CREATE TABLE IF NOT EXISTS events_cron_checkins_default  PARTITION OF events_cron_checkins  DEFAULT;
CREATE TABLE IF NOT EXISTS events_replays_default        PARTITION OF events_replays        DEFAULT;


-- ----------------------------------------------------------------------------
-- ROLLUP / AGGREGATE TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_hourly_rollup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    bucket_hour TIMESTAMPTZ NOT NULL,
    error_count INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    request_count INTEGER DEFAULT 0,
    span_count INTEGER DEFAULT 0,
    trace_count INTEGER DEFAULT 0,
    metric_count INTEGER DEFAULT 0,
    log_count INTEGER DEFAULT 0,
    profile_count INTEGER DEFAULT 0,
    cron_checkin_count INTEGER DEFAULT 0,
    replay_count INTEGER DEFAULT 0,
    error_fatal_count INTEGER DEFAULT 0,
    error_error_count INTEGER DEFAULT 0,
    error_warning_count INTEGER DEFAULT 0,
    error_info_count INTEGER DEFAULT 0,
    error_debug_count INTEGER DEFAULT 0,
    request_2xx_count INTEGER DEFAULT 0,
    request_3xx_count INTEGER DEFAULT 0,
    request_4xx_count INTEGER DEFAULT 0,
    request_5xx_count INTEGER DEFAULT 0,
    request_avg_latency_ms INTEGER,
    request_p95_latency_ms INTEGER,
    request_p99_latency_ms INTEGER,
    unique_user_count INTEGER DEFAULT 0,
    active_services TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_hourly_rollup_unique UNIQUE (organization_id, project_id, bucket_hour)
);

CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    bucket_date DATE NOT NULL,
    error_count INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    request_count INTEGER DEFAULT 0,
    span_count INTEGER DEFAULT 0,
    trace_count INTEGER DEFAULT 0,
    metric_count INTEGER DEFAULT 0,
    log_count INTEGER DEFAULT 0,
    profile_count INTEGER DEFAULT 0,
    cron_checkin_count INTEGER DEFAULT 0,
    replay_count INTEGER DEFAULT 0,
    error_fatal_count INTEGER DEFAULT 0,
    error_error_count INTEGER DEFAULT 0,
    error_warning_count INTEGER DEFAULT 0,
    error_info_count INTEGER DEFAULT 0,
    error_debug_count INTEGER DEFAULT 0,
    request_2xx_count INTEGER DEFAULT 0,
    request_3xx_count INTEGER DEFAULT 0,
    request_4xx_count INTEGER DEFAULT 0,
    request_5xx_count INTEGER DEFAULT 0,
    request_avg_latency_ms INTEGER,
    request_p95_latency_ms INTEGER,
    request_p99_latency_ms INTEGER,
    unique_user_count INTEGER DEFAULT 0,
    active_services TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_daily_rollup_unique UNIQUE (organization_id, project_id, bucket_date)
);

CREATE TABLE IF NOT EXISTS analytics_error_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    fingerprint VARCHAR(64) NOT NULL,
    error_name VARCHAR(256) NOT NULL,
    message_template TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    total_count INTEGER DEFAULT 0,
    today_count INTEGER DEFAULT 0,
    week_count INTEGER DEFAULT 0,
    month_count INTEGER DEFAULT 0,
    status error_group_status DEFAULT 'unresolved',
    assigned_to UUID,
    services TEXT[],
    environments TEXT[],
    releases TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_error_groups_unique UNIQUE (organization_id, project_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS analytics_performance_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    bucket_date DATE NOT NULL,
    route VARCHAR(500) NOT NULL,
    method VARCHAR(10),
    p50_latency_ms INTEGER,
    p75_latency_ms INTEGER,
    p90_latency_ms INTEGER,
    p95_latency_ms INTEGER,
    p99_latency_ms INTEGER,
    request_count INTEGER DEFAULT 0,
    rpm NUMERIC,
    error_count INTEGER DEFAULT 0,
    error_rate NUMERIC,
    apdex_score NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_perf_summary_unique UNIQUE (organization_id, project_id, bucket_date, route, method)
);

CREATE TABLE IF NOT EXISTS analytics_user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    session_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(255),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    event_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    pages TEXT[],
    is_crashed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_user_sessions_unique UNIQUE (organization_id, project_id, session_id)
);

-- ----------------------------------------------------------------------------
-- CONFIG TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    layout JSONB DEFAULT '{}',
    widgets JSONB DEFAULT '[]',
    is_shared BOOLEAN DEFAULT false,
    shared_token VARCHAR(64),
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS analytics_saved_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    query_type VARCHAR(50) NOT NULL,
    query_config JSONB NOT NULL,
    visualization_type VARCHAR(50),
    visualization_config JSONB DEFAULT '{}',
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS analytics_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID,
    name VARCHAR(255) NOT NULL,
    metric VARCHAR(100) NOT NULL,
    operator analytics_alert_operator NOT NULL,
    threshold NUMERIC NOT NULL,
    window_minutes INTEGER NOT NULL DEFAULT 5,
    notification_channels JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- (BRIN on created_at for cheap large scans; composite btrees for hot lookups.
--  Time-windowed partial predicates from the spec are omitted: NOW() is not
--  IMMUTABLE and is illegal in an index predicate.)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_errors_org_time ON events_errors(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_fingerprint ON events_errors(organization_id, fingerprint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_trace ON events_errors(trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_errors_severity ON events_errors(organization_id, severity, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_service ON events_errors(organization_id, service, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_user ON events_errors(organization_id, user_id, timestamp DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_errors_brin_time ON events_errors USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_messages_org_time ON events_messages(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_brin_time ON events_messages USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_requests_org_time ON events_requests(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_route ON events_requests(organization_id, route, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status ON events_requests(organization_id, status_code, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_slow ON events_requests(organization_id, timestamp DESC) WHERE is_slow = true;
CREATE INDEX IF NOT EXISTS idx_requests_user ON events_requests(organization_id, user_id, timestamp DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_trace ON events_requests(trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_brin_time ON events_requests USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_spans_org_time ON events_spans(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON events_spans(organization_id, trace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_name ON events_spans(organization_id, name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spans_db ON events_spans(organization_id, db_system, timestamp DESC) WHERE db_system IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_http ON events_spans(organization_id, http_route, timestamp DESC) WHERE http_route IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_parent ON events_spans(parent_span_id) WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_brin_time ON events_spans USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_traces_org_time ON events_traces(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON events_traces(organization_id, trace_id);
CREATE INDEX IF NOT EXISTS idx_traces_brin_time ON events_traces USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_metrics_org_name_time ON events_metrics(organization_id, metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_tags ON events_metrics USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_metrics_brin_time ON events_metrics USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_logs_org_level_time ON events_logs(organization_id, level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_message ON events_logs USING GIN (to_tsvector('english', message));
CREATE INDEX IF NOT EXISTS idx_logs_brin_time ON events_logs USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_profiles_org_time ON events_profiles(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_brin_time ON events_profiles USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_crons_org_slug ON events_cron_checkins(organization_id, monitor_slug, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_crons_brin_time ON events_cron_checkins USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_replays_org_session ON events_replays(organization_id, session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_replays_brin_time ON events_replays USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_hourly_rollup_org_hour ON analytics_hourly_rollup(organization_id, project_id, bucket_hour DESC);
CREATE INDEX IF NOT EXISTS idx_daily_rollup_org_date ON analytics_daily_rollup(organization_id, project_id, bucket_date DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_org_fingerprint ON analytics_error_groups(organization_id, project_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_groups_org_status ON analytics_error_groups(organization_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_summary_org_route ON analytics_performance_summary(organization_id, project_id, bucket_date DESC, route);
CREATE INDEX IF NOT EXISTS idx_user_sessions_org ON analytics_user_sessions(organization_id, project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dashboards_org ON analytics_dashboards(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saved_queries_org ON analytics_saved_queries(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org ON analytics_alerts(organization_id) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- PARTITION MAINTENANCE + ROLLUP FUNCTIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_event_partitions(p_days_ahead INTEGER DEFAULT 7)
RETURNS void AS $$
DECLARE
  tables TEXT[] := ARRAY[
    'events_errors','events_messages','events_requests','events_spans','events_traces',
    'events_metrics','events_logs','events_profiles','events_cron_checkins','events_replays'
  ];
  t TEXT;
  partition_date DATE;
  partition_name TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR partition_date IN
      SELECT generate_series(CURRENT_DATE, CURRENT_DATE + (p_days_ahead || ' days')::interval, INTERVAL '1 day')::DATE
    LOOP
      partition_name := t || '_' || TO_CHAR(partition_date, 'YYYY_MM_DD');
      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          partition_name, t, partition_date, partition_date + INTERVAL '1 day'
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Pre-create a week of daily partitions immediately.
SELECT create_event_partitions(7);

CREATE OR REPLACE FUNCTION refresh_hourly_rollup(
  p_org_id UUID, p_start_hour TIMESTAMPTZ, p_end_hour TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  -- Errors contribution (counts + severity breakdown).
  INSERT INTO analytics_hourly_rollup (
    organization_id, project_id, bucket_hour,
    error_count, error_fatal_count, error_error_count, error_warning_count,
    error_info_count, error_debug_count
  )
  SELECT
    organization_id, project_id, DATE_TRUNC('hour', timestamp) AS bucket_hour,
    COUNT(*),
    COUNT(*) FILTER (WHERE severity = 'fatal'),
    COUNT(*) FILTER (WHERE severity = 'error'),
    COUNT(*) FILTER (WHERE severity = 'warning'),
    COUNT(*) FILTER (WHERE severity = 'info'),
    COUNT(*) FILTER (WHERE severity = 'debug')
  FROM events_errors
  WHERE organization_id = p_org_id AND timestamp >= p_start_hour AND timestamp < p_end_hour
  GROUP BY organization_id, project_id, DATE_TRUNC('hour', timestamp)
  ON CONFLICT (organization_id, project_id, bucket_hour) DO UPDATE SET
    error_count = EXCLUDED.error_count,
    error_fatal_count = EXCLUDED.error_fatal_count,
    error_error_count = EXCLUDED.error_error_count,
    error_warning_count = EXCLUDED.error_warning_count,
    error_info_count = EXCLUDED.error_info_count,
    error_debug_count = EXCLUDED.error_debug_count,
    updated_at = NOW();

  -- Requests contribution (counts, status buckets, latency percentiles).
  INSERT INTO analytics_hourly_rollup (
    organization_id, project_id, bucket_hour,
    request_count, request_2xx_count, request_3xx_count, request_4xx_count, request_5xx_count,
    request_avg_latency_ms, request_p95_latency_ms, request_p99_latency_ms, unique_user_count
  )
  SELECT
    organization_id, project_id, DATE_TRUNC('hour', timestamp) AS bucket_hour,
    COUNT(*),
    COUNT(*) FILTER (WHERE status_code BETWEEN 200 AND 299),
    COUNT(*) FILTER (WHERE status_code BETWEEN 300 AND 399),
    COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499),
    COUNT(*) FILTER (WHERE status_code >= 500),
    AVG(latency_ms)::INTEGER,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::INTEGER,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::INTEGER,
    COUNT(DISTINCT user_id)
  FROM events_requests
  WHERE organization_id = p_org_id AND timestamp >= p_start_hour AND timestamp < p_end_hour
  GROUP BY organization_id, project_id, DATE_TRUNC('hour', timestamp)
  ON CONFLICT (organization_id, project_id, bucket_hour) DO UPDATE SET
    request_count = EXCLUDED.request_count,
    request_2xx_count = EXCLUDED.request_2xx_count,
    request_3xx_count = EXCLUDED.request_3xx_count,
    request_4xx_count = EXCLUDED.request_4xx_count,
    request_5xx_count = EXCLUDED.request_5xx_count,
    request_avg_latency_ms = EXCLUDED.request_avg_latency_ms,
    request_p95_latency_ms = EXCLUDED.request_p95_latency_ms,
    request_p99_latency_ms = EXCLUDED.request_p99_latency_ms,
    unique_user_count = EXCLUDED.unique_user_count,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- TRIGGERS
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_hourly_rollup_updated_at ON analytics_hourly_rollup;
CREATE TRIGGER trg_hourly_rollup_updated_at BEFORE UPDATE ON analytics_hourly_rollup FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_daily_rollup_updated_at ON analytics_daily_rollup;
CREATE TRIGGER trg_daily_rollup_updated_at BEFORE UPDATE ON analytics_daily_rollup FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_error_groups_updated_at ON analytics_error_groups;
CREATE TRIGGER trg_error_groups_updated_at BEFORE UPDATE ON analytics_error_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_perf_summary_updated_at ON analytics_performance_summary;
CREATE TRIGGER trg_perf_summary_updated_at BEFORE UPDATE ON analytics_performance_summary FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_dashboards_updated_at ON analytics_dashboards;
CREATE TRIGGER trg_dashboards_updated_at BEFORE UPDATE ON analytics_dashboards FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_saved_queries_updated_at ON analytics_saved_queries;
CREATE TRIGGER trg_saved_queries_updated_at BEFORE UPDATE ON analytics_saved_queries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_analytics_alerts_updated_at ON analytics_alerts;
CREATE TRIGGER trg_analytics_alerts_updated_at BEFORE UPDATE ON analytics_alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (INTENTIONALLY DISABLED — service-layer isolation)
-- ----------------------------------------------------------------------------
-- This codebase never sets app.current_org_id; enabling the spec's policies
-- would return zero rows for every query. Every analytics query is scoped by
-- organization_id in the repository layer instead. To adopt DB-enforced RLS,
-- set the GUC per request and uncomment ENABLE ROW LEVEL SECURITY + policies.

COMMIT;

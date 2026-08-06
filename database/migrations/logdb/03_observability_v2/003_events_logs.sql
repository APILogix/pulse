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

CREATE INDEX IF NOT EXISTS idx_events_logs_context_gin
ON events_logs
USING GIN (context);

CREATE INDEX IF NOT EXISTS idx_events_logs_tags_gin
ON events_logs
USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_events_logs_attributes_gin
ON events_logs
USING GIN (attributes);

CREATE INDEX IF NOT EXISTS idx_events_logs_metadata_gin
ON events_logs
USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_events_logs_payload_gin
ON events_logs
USING GIN (payload);

CREATE INDEX IF NOT EXISTS idx_events_logs_ai_response_gin
ON events_logs
USING GIN (ai_response);

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
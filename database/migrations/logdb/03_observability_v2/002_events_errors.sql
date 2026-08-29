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
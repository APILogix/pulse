CREATE TABLE error_groups (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL,
    project_id UUID NOT NULL,

    fingerprint VARCHAR(128) NOT NULL,

    title TEXT NOT NULL,
    culprit TEXT,
    error_name TEXT,

    status TEXT NOT NULL DEFAULT 'open'
        CHECK (
            status IN (
                'open',
                'resolved',
                'ignored',
                'regressed'
            )
        ),

    highest_severity TEXT,
    latest_severity TEXT,

    occurrence_count BIGINT NOT NULL DEFAULT 1,

    affected_users_count BIGINT NOT NULL DEFAULT 0,
    affected_sessions_count BIGINT NOT NULL DEFAULT 0,

    first_event_id UUID NOT NULL,
    latest_event_id UUID NOT NULL,

    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,

    first_release TEXT,
    latest_release TEXT,

    first_sdk_version TEXT,
    latest_sdk_version TEXT,

    first_application_version TEXT,
    latest_application_version TEXT,

    environment TEXT,

    assigned_to UUID,
    assigned_at TIMESTAMPTZ,

    resolved_by UUID,
    resolved_at TIMESTAMPTZ,

    ignored_until TIMESTAMPTZ,

    is_muted BOOLEAN NOT NULL DEFAULT FALSE,
    muted_until TIMESTAMPTZ,

    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,

    is_regression BOOLEAN NOT NULL DEFAULT FALSE,
    regression_count INTEGER NOT NULL DEFAULT 0,
    last_regressed_at TIMESTAMPTZ,

    last_occurrence_status_code SMALLINT,

    last_trace_id TEXT,
    last_request_id UUID,

    ai_summary TEXT,
    ai_root_cause JSONB,
    ai_fix JSONB,
    ai_confidence NUMERIC(5,2),

    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_error_groups_project_fingerprint
        UNIQUE(project_id, fingerprint)
);

CREATE UNIQUE INDEX idx_error_groups_project_fingerprint
ON error_groups(project_id, fingerprint);

CREATE INDEX idx_error_groups_status
ON error_groups(project_id, status, last_seen_at DESC);

CREATE INDEX idx_error_groups_occurrence
ON error_groups(project_id, occurrence_count DESC);

CREATE INDEX idx_error_groups_severity
ON error_groups(project_id, latest_severity);

CREATE INDEX idx_error_groups_assignment
ON error_groups(project_id, assigned_to)
WHERE assigned_to IS NOT NULL;

CREATE INDEX idx_error_groups_environment
ON error_groups(project_id, environment);

CREATE INDEX idx_error_groups_release
ON error_groups(project_id, latest_release);

CREATE INDEX idx_error_groups_updated
ON error_groups(updated_at DESC);

CREATE INDEX idx_error_groups_tags
ON error_groups
USING GIN(tags);

CREATE INDEX idx_error_groups_attributes
ON error_groups
USING GIN(attributes);

CREATE INDEX idx_error_groups_ai_root
ON error_groups
USING GIN(ai_root_cause);
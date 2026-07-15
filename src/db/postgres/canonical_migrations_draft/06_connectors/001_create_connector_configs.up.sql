-- =============================================================================
-- Module      : Connectors
-- Description : connector_configs table
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS connector_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,

    provider VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,

    status VARCHAR(30) NOT NULL DEFAULT 'pending_setup'
        CHECK (status IN (
            'pending_setup','active','inactive',
            'disabled','expired','revoked',
            'degraded','error','rate_limited'
        )),

    is_default BOOLEAN NOT NULL DEFAULT FALSE,

    public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    supports_rich_formatting BOOLEAN NOT NULL DEFAULT FALSE,
    supports_threading BOOLEAN NOT NULL DEFAULT FALSE,
    supports_attachments BOOLEAN NOT NULL DEFAULT FALSE,

    rate_limit_requests INTEGER NOT NULL DEFAULT 60,
    rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60,

    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_backoff_base_ms INTEGER NOT NULL DEFAULT 1000,
    retry_backoff_multiplier NUMERIC(5,2) NOT NULL DEFAULT 2.0,

    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    failure_threshold INTEGER NOT NULL DEFAULT 5,

    last_health_check_at TIMESTAMPTZ,
    last_successful_delivery_at TIMESTAMPTZ,

    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_name_org
ON connector_configs (organization_id, lower(name))
WHERE deleted_at IS NULL;

COMMIT;

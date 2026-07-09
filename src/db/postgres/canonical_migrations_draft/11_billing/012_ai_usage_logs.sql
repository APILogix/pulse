-- =============================================================================
-- Module      : Billing
-- Migration   : 010_ai_usage_logs.sql
-- Description : AI usage ledger (partitioned)
-- PostgreSQL  : 16+
-- Depends On  : 008_organization_usage_current_period.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_usage_logs
(
    id UUID NOT NULL DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    project_id UUID
        REFERENCES projects(id)
        ON DELETE SET NULL,

    user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    feature_key VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,

    credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),

    prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
    completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
    total_tokens INTEGER GENERATED ALWAYS AS
        (prompt_tokens + completion_tokens) STORED,

    estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0
        CHECK (estimated_cost_usd >= 0),

    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),

    status VARCHAR(20) NOT NULL DEFAULT 'success'
        CHECK (status IN ('success','failed','timeout','cancelled')),

    request_id UUID,
    trace_id UUID,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE ai_usage_logs IS
'Immutable ledger of AI feature consumption used for billing, analytics and cost reporting.';

CREATE TABLE IF NOT EXISTS ai_usage_logs_2026_07
PARTITION OF ai_usage_logs
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS idx_ai_usage_2026_07_org_time
ON ai_usage_logs_2026_07 (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_2026_07_project_time
ON ai_usage_logs_2026_07 (project_id, occurred_at DESC)
WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_2026_07_user_time
ON ai_usage_logs_2026_07 (user_id, occurred_at DESC)
WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_2026_07_feature
ON ai_usage_logs_2026_07 (feature_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS brin_ai_usage_2026_07_time
ON ai_usage_logs_2026_07
USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS gin_ai_usage_2026_07_metadata
ON ai_usage_logs_2026_07
USING GIN (metadata);

COMMIT;

-- Notes:
-- * Create monthly partitions ahead of time.
-- * Consider pg_partman for automatic partition management.
-- * Never UPDATE usage rows; treat this table as append-only.

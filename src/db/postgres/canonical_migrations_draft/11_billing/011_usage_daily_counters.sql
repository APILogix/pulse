-- =============================================================================
-- Module      : Billing
-- Migration   : 009_usage_daily_counters.sql
-- Description : Historical daily usage counters (partitioned)
-- PostgreSQL  : 16+
-- Depends On  : 008_organization_usage_current_period.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS usage_daily_counters
(
    id UUID NOT NULL DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    project_id UUID
        REFERENCES projects(id)
        ON DELETE CASCADE,

    usage_date DATE NOT NULL,

    events_count           BIGINT NOT NULL DEFAULT 0,
    ai_credits_used        BIGINT NOT NULL DEFAULT 0,

    requests_count         BIGINT NOT NULL DEFAULT 0,
    errors_count           BIGINT NOT NULL DEFAULT 0,
    traces_count           BIGINT NOT NULL DEFAULT 0,
    spans_count            BIGINT NOT NULL DEFAULT 0,
    metrics_count          BIGINT NOT NULL DEFAULT 0,
    logs_count             BIGINT NOT NULL DEFAULT 0,
    profiles_count         BIGINT NOT NULL DEFAULT 0,
    replays_count          BIGINT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, usage_date),

    CONSTRAINT uq_usage_scope UNIQUE
    (
        organization_id,
        project_id,
        usage_date
    )
)
PARTITION BY RANGE (usage_date);

COMMENT ON TABLE usage_daily_counters IS
'Historical daily usage counters. Parent table for monthly partitions.';

-- Example partition (create future partitions via scheduled migration/job)

CREATE TABLE IF NOT EXISTS usage_daily_counters_2026_07
PARTITION OF usage_daily_counters
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- ============================================================================
-- Partition indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_udc_2026_07_org_date
ON usage_daily_counters_2026_07
(
    organization_id,
    usage_date DESC
);

CREATE INDEX IF NOT EXISTS idx_udc_2026_07_project_date
ON usage_daily_counters_2026_07
(
    project_id,
    usage_date DESC
)
WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brin_udc_2026_07_date
ON usage_daily_counters_2026_07
USING BRIN (usage_date);

DROP TRIGGER IF EXISTS trg_usage_daily_counters_updated_at
ON usage_daily_counters;

CREATE TRIGGER trg_usage_daily_counters_updated_at
BEFORE UPDATE
ON usage_daily_counters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ============================================================================
-- Notes
-- ============================================================================
-- 1. Create one partition per month.
-- 2. Automate future partition creation via a scheduler.
-- 3. Drop/archive old partitions according to billing retention policy.

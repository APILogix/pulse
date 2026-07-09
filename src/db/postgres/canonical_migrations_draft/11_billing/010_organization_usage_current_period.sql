-- =============================================================================
-- Module      : Billing
-- Migration   : 008_organization_usage_current_period.sql
-- Description : Fast-path usage counters for entitlement enforcement
-- PostgreSQL  : 16+
-- Depends On  : 006_organization_subscriptions.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS organization_usage_current_period
(
    organization_id UUID PRIMARY KEY
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    period_start TIMESTAMPTZ NOT NULL,
    period_end   TIMESTAMPTZ NOT NULL,

    -- High-frequency counters
    events_used              BIGINT NOT NULL DEFAULT 0,
    ai_credits_used          BIGINT NOT NULL DEFAULT 0,

    -- Current resource counts
    projects_used            INTEGER NOT NULL DEFAULT 0,
    members_used             INTEGER NOT NULL DEFAULT 0,
    api_keys_used            INTEGER NOT NULL DEFAULT 0,
    connectors_used          INTEGER NOT NULL DEFAULT 0,
    alert_rules_used         INTEGER NOT NULL DEFAULT 0,
    dashboards_used          INTEGER NOT NULL DEFAULT 0,

    -- Cached effective limits (copied from resolved entitlements)
    event_limit              BIGINT NOT NULL DEFAULT 0,
    ai_credit_limit          BIGINT NOT NULL DEFAULT 0,

    overage_events           BIGINT NOT NULL DEFAULT 0,
    overage_ai_credits       BIGINT NOT NULL DEFAULT 0,

    last_event_at            TIMESTAMPTZ,
    last_ai_request_at       TIMESTAMPTZ,

    metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_usage_period
        CHECK (period_end > period_start),

    CONSTRAINT chk_non_negative
        CHECK (
            events_used >= 0
            AND ai_credits_used >= 0
            AND projects_used >= 0
            AND members_used >= 0
            AND api_keys_used >= 0
            AND connectors_used >= 0
            AND alert_rules_used >= 0
            AND dashboards_used >= 0
            AND event_limit >= 0
            AND ai_credit_limit >= 0
        )
);

COMMENT ON TABLE organization_usage_current_period IS
'Single-row fast-path counters for each organization. Used during ingestion and quota checks to avoid aggregating historical usage.';

CREATE INDEX IF NOT EXISTS idx_org_usage_subscription
ON organization_usage_current_period(subscription_id);

CREATE INDEX IF NOT EXISTS idx_org_usage_period_end
ON organization_usage_current_period(period_end);

CREATE INDEX IF NOT EXISTS idx_org_usage_last_event
ON organization_usage_current_period(last_event_at DESC)
WHERE last_event_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_usage_last_ai
ON organization_usage_current_period(last_ai_request_at DESC)
WHERE last_ai_request_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_usage_metadata
ON organization_usage_current_period
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_org_usage_current_period_updated_at
ON organization_usage_current_period;

CREATE TRIGGER trg_org_usage_current_period_updated_at
BEFORE UPDATE
ON organization_usage_current_period
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

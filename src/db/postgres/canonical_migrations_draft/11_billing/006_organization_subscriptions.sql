-- =============================================================================
-- Module      : Billing
-- Migration   : 006_organization_subscriptions.sql
-- Description : Organization subscription lifecycle
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               002_plans.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS organization_subscriptions
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    plan_id UUID NOT NULL
        REFERENCES plans(id),

    status billing_subscription_status NOT NULL,

    provider billing_provider_type NOT NULL DEFAULT 'system',

    billing_interval billing_interval_type NOT NULL,

    provider_customer_id VARCHAR(150),
    provider_subscription_id VARCHAR(150),

    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end   TIMESTAMPTZ NOT NULL,

    trial_start TIMESTAMPTZ,
    trial_end   TIMESTAMPTZ,

    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    cancelled_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_subscription_period
        CHECK (current_period_end > current_period_start),

    CONSTRAINT chk_trial_period
        CHECK (
            trial_start IS NULL
            OR trial_end IS NULL
            OR trial_end > trial_start
        )
);

COMMENT ON TABLE organization_subscriptions IS
'Current and historical subscriptions owned by organizations.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_single_active_subscription
ON organization_subscriptions(organization_id)
WHERE status IN ('trialing','active','past_due')
AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_subscription
ON organization_subscriptions(provider, provider_subscription_id)
WHERE provider_subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org
ON organization_subscriptions(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_plan
ON organization_subscriptions(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_period_end
ON organization_subscriptions(current_period_end)
WHERE status IN ('trialing','active','past_due')
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_status
ON organization_subscriptions(status)
WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_organization_subscriptions_updated_at
ON organization_subscriptions;

CREATE TRIGGER trg_organization_subscriptions_updated_at
BEFORE UPDATE
ON organization_subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

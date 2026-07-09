-- =============================================================================
-- Module      : Billing
-- Migration   : 011_subscription_addons.sql
-- Description : Subscription add-ons and purchased capacity
-- PostgreSQL  : 16+
-- Depends On  : 006_organization_subscriptions.sql
--               004_billing_features.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS subscription_addons
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    subscription_id UUID NOT NULL
        REFERENCES organization_subscriptions(id)
        ON DELETE CASCADE,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE RESTRICT,

    quantity BIGINT NOT NULL CHECK (quantity > 0),

    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,

    provider billing_provider_type NOT NULL DEFAULT 'system',
    provider_reference VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','scheduled','expired','cancelled')),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_addon_window
        CHECK (expires_at IS NULL OR expires_at > starts_at)
);

COMMENT ON TABLE subscription_addons IS
'Purchased add-ons that increase effective feature limits without changing the base plan.';

CREATE INDEX IF NOT EXISTS idx_subscription_addons_subscription
ON subscription_addons(subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_org
ON subscription_addons(organization_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_feature
ON subscription_addons(feature_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_active
ON subscription_addons(status, expires_at)
WHERE status='active';

CREATE INDEX IF NOT EXISTS idx_subscription_addons_metadata
ON subscription_addons
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_subscription_addons_updated_at
ON subscription_addons;

CREATE TRIGGER trg_subscription_addons_updated_at
BEFORE UPDATE
ON subscription_addons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

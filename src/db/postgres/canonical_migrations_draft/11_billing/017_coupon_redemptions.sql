-- =============================================================================
-- Module      : Billing
-- Migration   : 017_coupon_redemptions.sql
-- Description : Coupon redemption history
-- PostgreSQL  : 16+
-- Depends On  : 016_coupons.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS coupon_redemptions
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    coupon_id UUID NOT NULL
        REFERENCES coupons(id)
        ON DELETE CASCADE,

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    invoice_id UUID
        REFERENCES invoices(id)
        ON DELETE SET NULL,

    redeemed_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    discount_amount BIGINT NOT NULL DEFAULT 0
        CHECK (discount_amount >= 0),

    currency CHAR(3) NOT NULL,

    redemption_source VARCHAR(30) NOT NULL DEFAULT 'manual'
        CHECK (
            redemption_source IN
            ('manual','checkout','admin','promotion','api')
        ),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_coupon_org UNIQUE(coupon_id, organization_id)
);

COMMENT ON TABLE coupon_redemptions IS
'Immutable history of coupon redemptions by organizations.';

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_org
ON coupon_redemptions(organization_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon
ON coupon_redemptions(coupon_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_subscription
ON coupon_redemptions(subscription_id)
WHERE subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_invoice
ON coupon_redemptions(invoice_id)
WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brin_coupon_redemptions_time
ON coupon_redemptions
USING BRIN(redeemed_at);

CREATE INDEX IF NOT EXISTS gin_coupon_redemptions_metadata
ON coupon_redemptions
USING GIN(metadata);

COMMIT;

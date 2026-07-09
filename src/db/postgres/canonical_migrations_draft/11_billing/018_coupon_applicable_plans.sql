-- =============================================================================
-- Module      : Billing
-- Migration   : 018_coupon_applicable_plans.sql
-- Description : Coupon applicability by billing plan
-- PostgreSQL  : 16+
-- Depends On  : 002_plans.sql
--               016_coupons.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS coupon_applicable_plans
(
    coupon_id UUID NOT NULL
        REFERENCES coupons(id)
        ON DELETE CASCADE,

    plan_id UUID NOT NULL
        REFERENCES plans(id)
        ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (coupon_id, plan_id)
);

COMMENT ON TABLE coupon_applicable_plans IS
'Defines which plan versions a coupon may be redeemed against.';

CREATE INDEX IF NOT EXISTS idx_cap_plan
ON coupon_applicable_plans(plan_id);

CREATE INDEX IF NOT EXISTS idx_cap_coupon
ON coupon_applicable_plans(coupon_id);

COMMIT;

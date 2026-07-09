-- =============================================================================
-- Module      : Billing
-- Migration   : 016_coupons.sql
-- Description : Coupon and promotion definitions
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS coupons
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(50) NOT NULL,

    name VARCHAR(150) NOT NULL,
    description TEXT,

    discount_type billing_coupon_discount_type NOT NULL,

    discount_value NUMERIC(12,2) NOT NULL
        CHECK (discount_value > 0),

    currency CHAR(3),

    max_redemptions INTEGER
        CHECK (max_redemptions IS NULL OR max_redemptions > 0),

    redemption_count INTEGER NOT NULL DEFAULT 0
        CHECK (redemption_count >= 0),

    max_redemptions_per_org INTEGER NOT NULL DEFAULT 1
        CHECK (max_redemptions_per_org > 0),

    first_time_customers_only BOOLEAN NOT NULL DEFAULT FALSE,
    trial_only BOOLEAN NOT NULL DEFAULT FALSE,

    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_coupon_code UNIQUE(code),

    CONSTRAINT chk_coupon_window
        CHECK(valid_until IS NULL OR valid_until > valid_from),

    CONSTRAINT chk_percentage_value
        CHECK (
            discount_type <> 'percentage'
            OR (discount_value > 0 AND discount_value <= 100)
        )
);

COMMENT ON TABLE coupons IS
'Reusable promotional coupons supporting percentage and fixed discounts.';

CREATE INDEX IF NOT EXISTS idx_coupons_active
ON coupons(is_active, valid_until)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_public
ON coupons(is_public)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_validity
ON coupons(valid_from, valid_until)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_redemptions
ON coupons(redemption_count);

CREATE INDEX IF NOT EXISTS gin_coupons_metadata
ON coupons
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_coupons_updated_at
ON coupons;

CREATE TRIGGER trg_coupons_updated_at
BEFORE UPDATE
ON coupons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

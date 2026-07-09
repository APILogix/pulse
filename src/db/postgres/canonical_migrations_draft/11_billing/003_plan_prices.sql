-- =============================================================================
-- Module      : Billing
-- Migration   : 003_plan_prices.sql
-- Description : Billing plan pricing
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               002_plans.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS plan_prices
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    plan_id UUID NOT NULL
        REFERENCES plans(id)
        ON DELETE CASCADE,

    provider billing_provider_type NOT NULL,

    billing_interval billing_interval_type NOT NULL,

    currency CHAR(3) NOT NULL,

    amount_minor BIGINT NOT NULL
        CHECK (amount_minor >= 0),

    provider_price_id VARCHAR(150),

    is_default BOOLEAN NOT NULL DEFAULT FALSE,

    starts_at TIMESTAMPTZ,

    ends_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_plan_price UNIQUE
    (
        plan_id,
        provider,
        billing_interval,
        currency,
        starts_at
    ),

    CONSTRAINT chk_plan_price_window
    CHECK
    (
        ends_at IS NULL
        OR starts_at IS NULL
        OR ends_at > starts_at
    )
);

COMMENT ON TABLE plan_prices IS
'Commercial pricing for subscription plans. Supports multiple providers,
currencies, billing intervals, regional pricing and future grandfathered prices.';

COMMENT ON COLUMN plan_prices.amount_minor IS
'Amount stored in smallest currency unit (paise/cents).';

COMMENT ON COLUMN plan_prices.provider_price_id IS
'Stripe Price ID, Razorpay Plan ID, etc.';

COMMENT ON COLUMN plan_prices.metadata IS
'Provider specific metadata.';

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_plan_prices_plan
ON plan_prices(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_provider
ON plan_prices(provider)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_currency
ON plan_prices(currency)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_interval
ON plan_prices(billing_interval)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_lookup
ON plan_prices
(
    plan_id,
    provider,
    billing_interval,
    currency
)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_prices_default
ON plan_prices
(
    plan_id,
    billing_interval,
    currency
)
WHERE is_default = TRUE
AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_price
ON plan_prices
(
    provider,
    provider_price_id
)
WHERE provider_price_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_active_window
ON plan_prices
(
    starts_at,
    ends_at
)
WHERE deleted_at IS NULL;

-- ============================================================================
-- Trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trg_plan_prices_updated_at
ON plan_prices;

CREATE TRIGGER trg_plan_prices_updated_at
BEFORE UPDATE
ON plan_prices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
-- =============================================================================
-- Module      : Billing
-- Migration   : 027_seed_plan_prices.sql
-- Description : Seed plan pricing
-- PostgreSQL  : 16+
-- Depends On  :
--      002_plans.sql
--      003_plan_prices.sql
--      026_seed_plans.sql
-- =============================================================================

BEGIN;

WITH price_seed
(
    plan_key,
    version,
    provider,
    billing_interval,
    currency,
    amount_minor,
    is_default,
    metadata
)
AS
(
VALUES

-- ============================================================
-- FREE
-- ============================================================

(
    'free',
    1,
    'system',
    'monthly',
    'USD',
    0,
    TRUE,
    '{"display":"Free"}'::jsonb
),

(
    'free',
    1,
    'system',
    'annual',
    'USD',
    0,
    FALSE,
    '{"display":"Free"}'::jsonb
),

-- ============================================================
-- STARTER
-- ============================================================

(
    'starter',
    1,
    'stripe',
    'monthly',
    'USD',
    2900,
    TRUE,
    '{
        "display":"$29/mo",
        "recommended":false
    }'
),

(
    'starter',
    1,
    'stripe',
    'annual',
    'USD',
    29000,
    FALSE,
    '{
        "display":"$290/year",
        "discount":"2 months"
    }'
),

-- ============================================================
-- GROWTH
-- ============================================================

(
    'growth',
    1,
    'stripe',
    'monthly',
    'USD',
    9900,
    TRUE,
    '{
        "display":"$99/mo",
        "recommended":true
    }'
),

(
    'growth',
    1,
    'stripe',
    'annual',
    'USD',
    99000,
    FALSE,
    '{
        "display":"$990/year",
        "discount":"2 months"
    }'
),

-- ============================================================
-- BUSINESS
-- ============================================================

(
    'business',
    1,
    'stripe',
    'monthly',
    'USD',
    29900,
    TRUE,
    '{
        "display":"$299/mo"
    }'
),

(
    'business',
    1,
    'stripe',
    'annual',
    'USD',
    299000,
    FALSE,
    '{
        "display":"$2990/year",
        "discount":"2 months"
    }'
),

-- ============================================================
-- ENTERPRISE
-- ============================================================

(
    'enterprise',
    1,
    'system',
    'monthly',
    'USD',
    0,
    TRUE,
    '{
        "contactSales":true
    }'
),

(
    'enterprise',
    1,
    'system',
    'annual',
    'USD',
    0,
    FALSE,
    '{
        "contactSales":true
    }'
)

)

INSERT INTO plan_prices
(
    plan_id,
    provider,
    billing_interval,
    currency,
    amount_minor,
    provider_price_id,
    is_default,
    starts_at,
    ends_at,
    metadata
)

SELECT

    p.id,

    ps.provider::billing_provider_type,

    ps.billing_interval::billing_interval_type,

    ps.currency,

    ps.amount_minor,

    NULL,

    ps.is_default,

    '-infinity'::timestamptz,

    NULL,

    ps.metadata

FROM price_seed ps

JOIN plans p

ON p.key = ps.plan_key
AND p.version = ps.version
AND p.deleted_at IS NULL

ON CONFLICT
(
    plan_id,
    provider,
    billing_interval,
    currency,
    starts_at
)

DO UPDATE

SET

    amount_minor = EXCLUDED.amount_minor,

    provider_price_id = EXCLUDED.provider_price_id,

    is_default = EXCLUDED.is_default,

    ends_at = EXCLUDED.ends_at,

    metadata = EXCLUDED.metadata,

    deleted_at = NULL,

    updated_at = NOW();

COMMIT;
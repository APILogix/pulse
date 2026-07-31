-- =============================================================================
-- Module      : Billing
-- Migration   : 037_seed_coupon_templates.sql
-- Description : Seed reusable coupon templates for promotions
-- =============================================================================

BEGIN;

INSERT INTO billing_coupon_templates (
    coupon_code,
    display_name,
    discount_type,
    discount_value,
    duration_type,
    duration_months,
    max_redemptions,
    applicable_plan_keys,
    first_time_customers_only,
    starts_at,
    expires_at,
    is_active
)
VALUES
(
    'WELCOME20',
    '20% Welcome Discount',
    'percentage',
    20,
    'repeating',
    3,
    NULL,
    ARRAY['starter','growth','business'],
    TRUE,
    NOW(),
    NOW() + INTERVAL '1 year',
    TRUE
),
(
    'STARTER50',
    '50% Off Starter',
    'percentage',
    50,
    'once',
    NULL,
    1000,
    ARRAY['starter'],
    TRUE,
    NOW(),
    NOW() + INTERVAL '90 days',
    TRUE
),
(
    'AI100K',
    '100K Free AI Credits',
    'credit',
    100000,
    'once',
    NULL,
    NULL,
    ARRAY['growth','business','enterprise'],
    FALSE,
    NOW(),
    NOW() + INTERVAL '180 days',
    TRUE
),
(
    'TRIAL30',
    '30 Day Trial',
    'trial',
    30,
    'once',
    NULL,
    NULL,
    ARRAY['starter','growth'],
    TRUE,
    NOW(),
    NOW() + INTERVAL '1 year',
    TRUE
)
ON CONFLICT (coupon_code)
DO UPDATE SET
    display_name = EXCLUDED.display_name,
    discount_type = EXCLUDED.discount_type,
    discount_value = EXCLUDED.discount_value,
    duration_type = EXCLUDED.duration_type,
    duration_months = EXCLUDED.duration_months,
    max_redemptions = EXCLUDED.max_redemptions,
    applicable_plan_keys = EXCLUDED.applicable_plan_keys,
    first_time_customers_only = EXCLUDED.first_time_customers_only,
    starts_at = EXCLUDED.starts_at,
    expires_at = EXCLUDED.expires_at,
    is_active = EXCLUDED.is_active,
    updated_at = NOW(),
    deleted_at = NULL;

COMMIT;
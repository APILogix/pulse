-- =============================================================================
-- Module      : Billing
-- Migration   : 026_seed_plans.sql
-- Description : Seed default billing plans
-- PostgreSQL  : 16+
-- Depends On  : 002_plans.sql
-- =============================================================================

BEGIN;

INSERT INTO plans
(
    key,
    version,
    name,
    tier,
    description,

    trial_days,

    is_active,
    is_public,
    is_customizable,

    next_plan_key,

    badge,

    sort_order
)
VALUES

(
    'free',
    1,
    'Free',
    'free',
    'Perfect for personal projects, prototypes and evaluation.',

    0,

    TRUE,
    TRUE,
    FALSE,

    'starter',

    NULL,

    1
),

(
    'starter',
    1,
    'Starter',
    'starter',
    'Production-ready observability for small teams.',

    14,

    TRUE,
    TRUE,
    FALSE,

    'growth',

    'Popular',

    2
),

(
    'growth',
    1,
    'Growth',
    'growth',
    'Scaling teams requiring advanced observability and AI capabilities.',

    14,

    TRUE,
    TRUE,
    FALSE,

    'business',

    'Recommended',

    3
),

(
    'business',
    1,
    'Business',
    'business',
    'Enterprise-ready monitoring with governance, security and automation.',

    14,

    TRUE,
    TRUE,
    FALSE,

    'enterprise',

    'Best Value',

    4
),

(
    'enterprise',
    1,
    'Enterprise',
    'enterprise',
    'Custom enterprise deployment with unlimited scale and dedicated support.',

    30,

    TRUE,
    FALSE,
    TRUE,

    NULL,

    NULL,

    5
)

ON CONFLICT (key, version)

DO UPDATE

SET

name = EXCLUDED.name,

tier = EXCLUDED.tier,

description = EXCLUDED.description,

trial_days = EXCLUDED.trial_days,

is_active = EXCLUDED.is_active,

is_public = EXCLUDED.is_public,

is_customizable = EXCLUDED.is_customizable,

next_plan_key = EXCLUDED.next_plan_key,

badge = EXCLUDED.badge,

sort_order = EXCLUDED.sort_order,

deleted_at = NULL,

updated_at = NOW();

COMMENT ON TABLE plans IS
'Default billing plans for the platform. Enterprise plans may be customized using overrides.';

COMMIT;
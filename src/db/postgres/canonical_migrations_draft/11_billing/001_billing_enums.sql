-- =============================================================================
-- Module      : Billing
-- Migration   : 001_billing_enums.sql
-- Description : Billing enums used throughout the billing module
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

-- =============================================================================
-- Billing Plan Tier
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_plan_tier'
    ) THEN
        CREATE TYPE billing_plan_tier AS ENUM
        (
            'free',
            'starter',
            'growth',
            'business',
            'enterprise'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_plan_tier IS
'Commercial subscription tier.';


-- =============================================================================
-- Subscription Status
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_subscription_status'
    ) THEN
        CREATE TYPE billing_subscription_status AS ENUM
        (
            'trialing',
            'active',
            'past_due',
            'paused',
            'cancelled',
            'expired',
            'incomplete'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_subscription_status IS
'Current lifecycle status of an organization subscription.';


-- =============================================================================
-- Billing Provider
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_provider_type'
    ) THEN
        CREATE TYPE billing_provider_type AS ENUM
        (
            'stripe',
            'razorpay',
            'manual',
            'system'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_provider_type IS
'External billing/payment provider.';


-- =============================================================================
-- Billing Interval
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_interval_type'
    ) THEN
        CREATE TYPE billing_interval_type AS ENUM
        (
            'monthly',
            'annual'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_interval_type IS
'Subscription billing cycle.';


-- =============================================================================
-- Invoice Status
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_invoice_status'
    ) THEN
        CREATE TYPE billing_invoice_status AS ENUM
        (
            'draft',
            'open',
            'paid',
            'void',
            'uncollectible',
            'refunded'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_invoice_status IS
'Invoice lifecycle state.';


-- =============================================================================
-- Payment Status
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_payment_status'
    ) THEN
        CREATE TYPE billing_payment_status AS ENUM
        (
            'pending',
            'processing',
            'succeeded',
            'failed',
            'cancelled',
            'refunded'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_payment_status IS
'Status of an individual payment transaction.';


-- =============================================================================
-- Coupon Discount Type
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_coupon_discount_type'
    ) THEN
        CREATE TYPE billing_coupon_discount_type AS ENUM
        (
            'percentage',
            'fixed_amount'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_coupon_discount_type IS
'Coupon discount calculation method.';


-- =============================================================================
-- Feature Value Type
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_feature_value_type'
    ) THEN
        CREATE TYPE billing_feature_value_type AS ENUM
        (
            'boolean',
            'integer',
            'decimal',
            'string'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_feature_value_type IS
'Data type stored by a billing feature entitlement.';


-- =============================================================================
-- Feature Category
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_feature_category'
    ) THEN
        CREATE TYPE billing_feature_category AS ENUM
        (
            'monitoring',
            'ai',
            'alerts',
            'projects',
            'organization',
            'dashboard',
            'security',
            'limits',
            'integrations'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_feature_category IS
'Logical grouping of billable platform capabilities.';


-- =============================================================================
-- Subscription Event Type
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'subscription_event_type'
    ) THEN
        CREATE TYPE subscription_event_type AS ENUM
        (
            'created',
            'upgraded',
            'downgraded',
            'renewed',
            'trial_started',
            'trial_ended',
            'cancelled',
            'resumed',
            'expired',
            'payment_failed',
            'payment_succeeded',
            'addon_purchased',
            'feature_override_added'
        );
    END IF;
END $$;

COMMENT ON TYPE subscription_event_type IS
'Immutable subscription history events.';


-- =============================================================================
-- Subscription Event Actor
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'subscription_event_actor'
    ) THEN
        CREATE TYPE subscription_event_actor AS ENUM
        (
            'user',
            'admin',
            'system',
            'billing_provider'
        );
    END IF;
END $$;

COMMENT ON TYPE subscription_event_actor IS
'Entity responsible for the subscription event.';


COMMIT;
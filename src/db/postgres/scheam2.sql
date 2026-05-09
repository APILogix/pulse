-- =====================================================
-- EXTENSIONS
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- ENUMS
-- =====================================================

DO $$ BEGIN
    CREATE TYPE plan_interval AS ENUM ('monthly', 'yearly', 'custom');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE plan_tier AS ENUM ('starter', 'professional', 'enterprise', 'custom');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE billing_status AS ENUM (
        'active',
        'past_due',
        'canceled',
        'unpaid',
        'paused',
        'trialing'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_method_type AS ENUM (
        'card',
        'bank_transfer',
        'paypal',
        'crypto',
        'invoice'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE invoice_status AS ENUM (
        'draft',
        'open',
        'paid',
        'uncollectible',
        'void'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE quota_request_status AS ENUM (
        'pending',
        'approved',
        'rejected'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- UPDATED_AT TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- BILLING PLANS
-- =====================================================

CREATE TABLE IF NOT EXISTS billing_plans (
    id VARCHAR(50) PRIMARY KEY,

    name VARCHAR(100) NOT NULL,
    description TEXT,

    tier plan_tier NOT NULL DEFAULT 'starter',

    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,

    base_price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0
        CHECK (base_price_monthly >= 0),

    base_price_yearly NUMERIC(10,2)
        CHECK (base_price_yearly >= 0),

    currency VARCHAR(3) NOT NULL DEFAULT 'USD',

    billing_interval plan_interval NOT NULL DEFAULT 'monthly',

    limits JSONB NOT NULL DEFAULT '{}'::jsonb,

    features JSONB NOT NULL DEFAULT '{}'::jsonb,

    trial_days INTEGER NOT NULL DEFAULT 14
        CHECK (trial_days >= 0),

    grace_period_days INTEGER NOT NULL DEFAULT 7
        CHECK (grace_period_days >= 0),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    deprecated_at TIMESTAMPTZ,

    replaced_by VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE billing_plans
ADD CONSTRAINT fk_billing_plans_replaced_by
FOREIGN KEY (replaced_by)
REFERENCES billing_plans(id)
ON DELETE SET NULL;

CREATE TRIGGER trg_billing_plans_updated_at
BEFORE UPDATE ON billing_plans
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- ORGANIZATION BILLING
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_billing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL UNIQUE
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    plan_id VARCHAR(50) NOT NULL
        REFERENCES billing_plans(id),

    status billing_status NOT NULL DEFAULT 'trialing',

    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    billing_cycle_anchor TIMESTAMPTZ NOT NULL,

    default_payment_method_id UUID,

    payment_method_type payment_method_type
        NOT NULL DEFAULT 'card',

    stripe_customer_id VARCHAR(100),
    stripe_subscription_id VARCHAR(100),

    invoice_prefix VARCHAR(20),

    next_invoice_number INTEGER NOT NULL DEFAULT 1
        CHECK (next_invoice_number > 0),

    invoice_notes TEXT,

    net_terms_days INTEGER NOT NULL DEFAULT 0
        CHECK (net_terms_days >= 0),

    usage_billing_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    overage_rate_per_unit NUMERIC(10,4)
        CHECK (overage_rate_per_unit >= 0),

    mrr NUMERIC(10,2) NOT NULL DEFAULT 0
        CHECK (mrr >= 0),

    arr NUMERIC(10,2)
        GENERATED ALWAYS AS (mrr * 12) STORED,

    total_paid_to_date NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (total_paid_to_date >= 0),

    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,

    canceled_at TIMESTAMPTZ,
    cancellation_reason TEXT,

    grace_period_start TIMESTAMPTZ,
    grace_period_end TIMESTAMPTZ,

    tax_exempt BOOLEAN NOT NULL DEFAULT FALSE,

    tax_id VARCHAR(50),

    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (tax_rate >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_organization_billing_updated_at
BEFORE UPDATE ON organization_billing
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- PAYMENT METHODS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    type payment_method_type NOT NULL,

    is_default BOOLEAN NOT NULL DEFAULT FALSE,

    card_brand VARCHAR(20),
    card_last4 VARCHAR(4),
    card_exp_month INTEGER,
    card_exp_year INTEGER,

    bank_account_last4 VARCHAR(4),
    bank_name VARCHAR(100),

    stripe_payment_method_id VARCHAR(100),

    paypal_email VARCHAR(255),

    billing_details JSONB,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_one_default_payment_method
ON organization_payment_methods(org_id)
WHERE is_default = TRUE;
-- =====================================================
-- EXTENSIONS
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- ENUMS
-- =====================================================

DO $$ BEGIN
    CREATE TYPE invoice_status AS ENUM (
        'draft',
        'open',
        'paid',
        'uncollectible',
        'void'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE quota_request_status AS ENUM (
        'pending',
        'approved',
        'rejected'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE usage_granularity AS ENUM (
        'hourly',
        'daily',
        'weekly',
        'monthly'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE coupon_discount_type AS ENUM (
        'percentage',
        'fixed_amount'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE coupon_duration_type AS ENUM (
        'once',
        'repeating',
        'forever'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- UPDATED_AT TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- ORGANIZATION INVOICES
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    invoice_number VARCHAR(50) NOT NULL UNIQUE,

    status invoice_status NOT NULL DEFAULT 'draft',

    invoice_date TIMESTAMPTZ NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,

    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,

    subtotal NUMERIC(12,2) NOT NULL
        CHECK (subtotal >= 0),

    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (discount_amount >= 0),

    discount_code VARCHAR(50),

    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (tax_amount >= 0),

    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (tax_rate >= 0),

    total NUMERIC(12,2) NOT NULL
        CHECK (total >= 0),

    amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (amount_paid >= 0),

    amount_due NUMERIC(12,2)
        GENERATED ALWAYS AS (
            GREATEST(total - amount_paid, 0)
        ) STORED,

    currency VARCHAR(3) NOT NULL DEFAULT 'USD'
        CHECK (char_length(currency) = 3),

    line_items JSONB NOT NULL DEFAULT '[]'::jsonb,

    payment_method payment_method_type,

    payment_intent_id VARCHAR(100),

    stripe_invoice_id VARCHAR(100),

    pdf_url TEXT,

    footer_note TEXT,
    memo TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (due_date >= invoice_date),
    CHECK (period_end >= period_start),
    CHECK (amount_paid <= total)
);

CREATE INDEX idx_invoices_org
ON organization_invoices(org_id, created_at DESC);

CREATE INDEX idx_invoices_status
ON organization_invoices(status);

CREATE INDEX idx_invoices_due_date
ON organization_invoices(due_date)
WHERE status IN ('open');

CREATE TRIGGER trg_organization_invoices_updated_at
BEFORE UPDATE ON organization_invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- ORGANIZATION USAGE
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    metric_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,

    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,

    granularity usage_granularity
        NOT NULL DEFAULT 'daily',

    usage_count BIGINT NOT NULL DEFAULT 0
        CHECK (usage_count >= 0),

    usage_limit BIGINT
        CHECK (usage_limit >= 0),

    overage_count BIGINT NOT NULL DEFAULT 0
        CHECK (overage_count >= 0),

    unit_cost NUMERIC(12,6)
        CHECK (unit_cost >= 0),

    total_cost NUMERIC(14,4) NOT NULL DEFAULT 0
        CHECK (total_cost >= 0),

    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (period_end >= period_start),

    UNIQUE (
        org_id,
        metric_type,
        metric_name,
        period_start,
        granularity
    )
);

CREATE INDEX idx_usage_org_period
ON organization_usage(org_id, period_start DESC);

CREATE INDEX idx_usage_metric
ON organization_usage(metric_type, period_start DESC);

CREATE INDEX idx_usage_overages
ON organization_usage(org_id, overage_count DESC)
WHERE overage_count > 0;

CREATE TRIGGER trg_organization_usage_updated_at
BEFORE UPDATE ON organization_usage
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- ORGANIZATION USAGE COUNTERS
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_usage_counters (
    org_id UUID PRIMARY KEY
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    current_period_start TIMESTAMPTZ NOT NULL,

    api_requests_this_period BIGINT NOT NULL DEFAULT 0
        CHECK (api_requests_this_period >= 0),

    metrics_ingested_this_period BIGINT NOT NULL DEFAULT 0
        CHECK (metrics_ingested_this_period >= 0),

    storage_gb_this_period NUMERIC(14,4) NOT NULL DEFAULT 0
        CHECK (storage_gb_this_period >= 0),

    notifications_sent_this_period BIGINT NOT NULL DEFAULT 0
        CHECK (notifications_sent_this_period >= 0),

    total_api_requests_all_time BIGINT NOT NULL DEFAULT 0
        CHECK (total_api_requests_all_time >= 0),

    total_metrics_ingested_all_time BIGINT NOT NULL DEFAULT 0
        CHECK (total_metrics_ingested_all_time >= 0),

    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    limit_warning_80_sent_at TIMESTAMPTZ,
    limit_warning_100_sent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_counters_last_updated
ON organization_usage_counters(last_updated_at DESC);

CREATE TRIGGER trg_usage_counters_updated_at
BEFORE UPDATE ON organization_usage_counters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- COUPONS
-- =====================================================

CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(50) NOT NULL UNIQUE,

    description TEXT,

    discount_type coupon_discount_type NOT NULL,

    discount_value NUMERIC(12,2) NOT NULL
        CHECK (discount_value > 0),

    currency VARCHAR(3)
        CHECK (
            currency IS NULL
            OR char_length(currency) = 3
        ),

    duration coupon_duration_type NOT NULL,

    duration_in_months INTEGER
        CHECK (
            duration_in_months IS NULL
            OR duration_in_months > 0
        ),

    max_redemptions INTEGER
        CHECK (
            max_redemptions IS NULL
            OR max_redemptions > 0
        ),

    redeem_by TIMESTAMPTZ,

    times_redeemed INTEGER NOT NULL DEFAULT 0
        CHECK (times_redeemed >= 0),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        NOT (
            discount_type = 'percentage'
            AND discount_value > 100
        )
    )
);

CREATE INDEX idx_coupons_active
ON coupons(code)
WHERE is_active = TRUE;

CREATE INDEX idx_coupons_redeem_by
ON coupons(redeem_by);

CREATE TRIGGER trg_coupons_updated_at
BEFORE UPDATE ON coupons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- QUOTA REQUESTS
-- =====================================================

CREATE TABLE IF NOT EXISTS quota_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    quota_type VARCHAR(50) NOT NULL,

    requested_limit BIGINT NOT NULL
        CHECK (requested_limit > current_limit),

    current_limit BIGINT NOT NULL
        CHECK (current_limit >= 0),

    reason TEXT NOT NULL,

    status quota_request_status
        NOT NULL DEFAULT 'pending',

    reviewed_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    reviewed_at TIMESTAMPTZ,

    notes TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        (status = 'pending' AND reviewed_at IS NULL)
        OR
        (status IN ('approved', 'rejected'))
    )
);

CREATE INDEX idx_quota_requests_org
ON quota_requests(org_id, created_at DESC);

CREATE INDEX idx_quota_requests_status
ON quota_requests(status);

CREATE TRIGGER trg_quota_requests_updated_at
BEFORE UPDATE ON quota_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
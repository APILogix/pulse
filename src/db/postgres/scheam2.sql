CREATE TYPE plan_interval AS ENUM ('monthly', 'yearly', 'custom');
CREATE TYPE plan_tier AS ENUM ('starter', 'professional', 'enterprise', 'custom');

CREATE TABLE billing_plans (
    id VARCHAR(50) PRIMARY KEY, -- 'starter', 'pro', 'enterprise-2024'
    
    -- Display
    name VARCHAR(100) NOT NULL,
    description TEXT,
    tier plan_tier NOT NULL DEFAULT 'starter',
    is_public BOOLEAN DEFAULT TRUE, -- Show on pricing page?
    sort_order INTEGER DEFAULT 0,
    
    -- Pricing
    base_price_monthly DECIMAL(10,2) NOT NULL, -- USD
    base_price_yearly DECIMAL(10,2), -- Often discounted
    currency VARCHAR(3) DEFAULT 'USD',
    billing_interval plan_interval DEFAULT 'monthly',
    
    -- Limits (for APU monitoring tool specifically)
    limits JSONB NOT NULL DEFAULT '{
        "max_projects": 5,
        "max_members": 3,
        "max_applications": 10,
        "max_metrics_per_app": 100,
        "data_retention_days": 30,
        "api_requests_per_min": 1000,
        "alert_rules": 10,
        "dashboards": 5,
        "integrations": 3,
        "support_level": "community",
        "sso_enabled": false,
        "advanced_analytics": false,
        "custom_domains": 0,
        "sla_uptime": "99.9%"
    }',
    
    -- Features flags
    features JSONB DEFAULT '{
        "real_time_alerts": true,
        "email_notifications": true,
        "slack_integration": false,
        "pagerduty_integration": false,
        "custom_webhooks": false,
        "log_retention_extended": false,
        "audit_logs": false,
        "dedicated_support": false,
        "custom_contract": false
    }',
    
    -- Trial
    trial_days INTEGER DEFAULT 14,
    
    -- Grace period when downgrading/cancelling
    grace_period_days INTEGER DEFAULT 7,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    deprecated_at TIMESTAMPTZ, -- When plan is no longer available for new signups
    replaced_by VARCHAR(50) REFERENCES billing_plans(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data for your APU monitoring tool
INSERT INTO billing_plans (id, name, tier, base_price_monthly, base_price_yearly, limits, features) VALUES
('starter', 'Starter', 'starter', 0, 0, 
 '{"max_projects": 3, "max_members": 2, "max_applications": 5, "max_metrics_per_app": 50, "data_retention_days": 7, "api_requests_per_min": 100, "alert_rules": 3, "dashboards": 1, "integrations": 1, "support_level": "community", "sso_enabled": false, "advanced_analytics": false, "custom_domains": 0}'::jsonb,
 '{"real_time_alerts": true, "email_notifications": true, "slack_integration": false, "pagerduty_integration": false, "custom_webhooks": false, "log_retention_extended": false, "audit_logs": false, "dedicated_support": false}'::jsonb),

('professional', 'Professional', 'professional', 29, 290,
 '{"max_projects": 10, "max_members": 10, "max_applications": 50, "max_metrics_per_app": 500, "data_retention_days": 90, "api_requests_per_min": 10000, "alert_rules": 50, "dashboards": 10, "integrations": 10, "support_level": "email", "sso_enabled": false, "advanced_analytics": true, "custom_domains": 1}'::jsonb,
 '{"real_time_alerts": true, "email_notifications": true, "slack_integration": true, "pagerduty_integration": false, "custom_webhooks": true, "log_retention_extended": true, "audit_logs": true, "dedicated_support": false}'::jsonb),

('enterprise', 'Enterprise', 'enterprise', 99, 990,
 '{"max_projects": 100, "max_members": 100, "max_applications": 500, "max_metrics_per_app": 2000, "data_retention_days": 365, "api_requests_per_min": 100000, "alert_rules": 999, "dashboards": 100, "integrations": 50, "support_level": "priority", "sso_enabled": true, "advanced_analytics": true, "custom_domains": 10}'::jsonb,
 '{"real_time_alerts": true, "email_notifications": true, "slack_integration": true, "pagerduty_integration": true, "custom_webhooks": true, "log_retention_extended": true, "audit_logs": true, "dedicated_support": true, "custom_contract": true}'::jsonb);


 CREATE TYPE billing_status AS ENUM ('active', 'past_due', 'canceled', 'unpaid', 'paused', 'trialing');
CREATE TYPE payment_method_type AS ENUM ('card', 'bank_transfer', 'paypal', 'crypto', 'invoice');

CREATE TABLE organization_billing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Current Subscription
    plan_id VARCHAR(50) NOT NULL REFERENCES billing_plans(id),
    status billing_status DEFAULT 'trialing',
    
    -- Billing Cycle
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    billing_cycle_anchor TIMESTAMPTZ NOT NULL, -- Day of month billing happens
    
    -- Payment Method
    default_payment_method_id UUID, -- Reference to payment_methods table
    payment_method_type payment_method_type DEFAULT 'card',
    
    -- Stripe/Payment Provider IDs (if using external processor)
    stripe_customer_id VARCHAR(100),
    stripe_subscription_id VARCHAR(100),
    
    -- Invoicing (for enterprise/invoice customers)
    invoice_prefix VARCHAR(20),
    next_invoice_number INTEGER DEFAULT 1,
    invoice_notes TEXT, -- "PO Number: 12345" etc.
    net_terms_days INTEGER DEFAULT 0, -- 0 = immediate, 30 = Net 30
    
    -- Usage-based billing tracking
    usage_billing_enabled BOOLEAN DEFAULT FALSE,
    overage_rate_per_unit DECIMAL(10,4), -- e.g., $0.001 per 1000 API calls over limit
    
    -- Totals
    mrr DECIMAL(10,2) DEFAULT 0, -- Monthly Recurring Revenue
    arr DECIMAL(10,2) GENERATED ALWAYS AS (mrr * 12) STORED,
    total_paid_to_date DECIMAL(12,2) DEFAULT 0,
    
    -- Cancellation
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    canceled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    
    -- Grace period
    grace_period_start TIMESTAMPTZ,
    grace_period_end TIMESTAMPTZ,
    
    -- Tax
    tax_exempt BOOLEAN DEFAULT FALSE,
    tax_id VARCHAR(50), -- VAT/GST number
    tax_rate DECIMAL(5,2) DEFAULT 0, -- Percentage
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment Methods table (for multiple cards/accounts)
CREATE TABLE organization_payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    type payment_method_type NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    
    -- Card details (last 4 only, never full PAN)
    card_brand VARCHAR(20), -- 'visa', 'mastercard'
    card_last4 VARCHAR(4),
    card_exp_month INTEGER,
    card_exp_year INTEGER,
    
    -- Bank transfer
    bank_account_last4 VARCHAR(4),
    bank_name VARCHAR(100),
    
    -- External references
    stripe_payment_method_id VARCHAR(100),
    paypal_email VARCHAR(255),
    
    -- Billing address for this method
    billing_details JSONB,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT only_one_default_per_org UNIQUE (org_id, is_default) 
    DEFERRABLE INITIALLY DEFERRED
);
CREATE TYPE invoice_status AS ENUM ('draft', 'open', 'paid', 'uncollectible', 'void');

CREATE TABLE organization_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Invoice details
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    status invoice_status DEFAULT 'draft',
    
    -- Dates
    invoice_date TIMESTAMPTZ NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    
    -- Period covered
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    
    -- Amounts
    subtotal DECIMAL(10,2) NOT NULL, -- Before discounts/tax
    discount_amount DECIMAL(10,2) DEFAULT 0,
    discount_code VARCHAR(50),
    tax_amount DECIMAL(10,2) DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    amount_paid DECIMAL(10,2) DEFAULT 0,
    amount_due DECIMAL(10,2) GENERATED ALWAYS AS (total - amount_paid) STORED,
    
    -- Currency
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Line items (stored as JSONB for flexibility)
    line_items JSONB NOT NULL DEFAULT '[]',
    /* Example:
    [
      {"description": "Professional Plan - Monthly", "amount": 29.00, "quantity": 1, "unit_price": 29.00},
      {"description": "API Overage (50,000 requests)", "amount": 5.00, "quantity": 50000, "unit_price": 0.0001}
    ]
    */
    
    -- Payment
    payment_method payment_method_type,
    payment_intent_id VARCHAR(100), -- Stripe payment intent
    
    -- External refs
    stripe_invoice_id VARCHAR(100),
    pdf_url TEXT,
    
    -- Notes
    footer_note TEXT,
    memo TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TYPE quota_request_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE organization_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    metric_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    granularity VARCHAR(20) NOT NULL DEFAULT 'daily',
    usage_count INTEGER NOT NULL DEFAULT 0,
    usage_limit INTEGER,
    overage_count INTEGER NOT NULL DEFAULT 0,
    unit_cost DECIMAL(10,4),
    total_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (org_id, metric_type, period_start, granularity)
);

CREATE INDEX idx_usage_org_period ON organization_usage(org_id, period_start DESC);
CREATE INDEX idx_usage_metric ON organization_usage(metric_type, period_start DESC);

CREATE TABLE organization_usage_counters (
    org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    current_period_start TIMESTAMPTZ NOT NULL,
    api_requests_this_period INTEGER NOT NULL DEFAULT 0,
    metrics_ingested_this_period INTEGER NOT NULL DEFAULT 0,
    storage_gb_this_period DECIMAL(12,4) NOT NULL DEFAULT 0,
    notifications_sent_this_period INTEGER NOT NULL DEFAULT 0,
    total_api_requests_all_time INTEGER NOT NULL DEFAULT 0,
    total_metrics_ingested_all_time INTEGER NOT NULL DEFAULT 0,
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    limit_warning_80_sent_at TIMESTAMPTZ,
    limit_warning_100_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount')),
    discount_value DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3),
    duration VARCHAR(20) NOT NULL CHECK (duration IN ('once', 'repeating', 'forever')),
    duration_in_months INTEGER,
    max_redemptions INTEGER,
    redeem_by TIMESTAMPTZ,
    times_redeemed INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quota_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    quota_type VARCHAR(50) NOT NULL,
    requested_limit INTEGER NOT NULL,
    current_limit INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status quota_request_status NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quota_requests_org ON quota_requests(org_id, created_at DESC);
CREATE INDEX idx_coupons_active ON coupons(code) WHERE is_active = TRUE;

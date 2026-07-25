# PostgreSQL Billing Complete Actual Schema DDL

This document contains the exact, actual PostgreSQL DDL statements for all tables, partitions, views, functions, and ENUM types from the billing module located at `pulse/src/db/postgres/canonical_migrations_draft/11_billing`.

---

## 1. Custom Billing ENUM Types (`001_billing_enums.sql`)

```sql
-- Commercial Plan Tiers
CREATE TYPE billing_plan_tier AS ENUM (
    'free',
    'starter',
    'growth',
    'business',
    'enterprise'
);

-- Subscription Lifecycle Statuses
CREATE TYPE billing_subscription_status AS ENUM (
    'trialing',
    'active',
    'past_due',
    'paused',
    'cancelled',
    'expired',
    'incomplete'
);

-- External Payment / Billing Providers
CREATE TYPE billing_provider_type AS ENUM (
    'stripe',
    'razorpay',
    'manual',
    'system'
);

-- Billing Cycle Intervals
CREATE TYPE billing_interval_type AS ENUM (
    'monthly',
    'annual'
);

-- Invoice Statuses
CREATE TYPE billing_invoice_status AS ENUM (
    'draft',
    'open',
    'paid',
    'void',
    'uncollectible',
    'refunded'
);

-- Individual Payment Transaction Statuses
CREATE TYPE billing_payment_status AS ENUM (
    'pending',
    'processing',
    'succeeded',
    'failed',
    'cancelled',
    'refunded'
);

-- Coupon Calculation Types
CREATE TYPE billing_coupon_discount_type AS ENUM (
    'percentage',
    'fixed_amount'
);

-- Feature Entitlement Value Types
CREATE TYPE billing_feature_value_type AS ENUM (
    'boolean',
    'integer',
    'decimal',
    'string'
);

-- Feature Categories
CREATE TYPE billing_feature_category AS ENUM (
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

-- Subscription Event History Classifications
CREATE TYPE subscription_event_type AS ENUM (
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

-- Event Actor Responsible Entity
CREATE TYPE subscription_event_actor AS ENUM (
    'user',
    'admin',
    'system',
    'billing_provider'
);
```

---

## 2. Table: `plans` (`002_plans.sql`)

```sql
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(100) NOT NULL,
  tier billing_plan_tier NOT NULL,
  description TEXT,
  trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT uq_plans_key_version UNIQUE (key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_active_key
  ON plans (key)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_active_public
  ON plans (sort_order, tier, key)
  WHERE is_active = TRUE AND is_public = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_tier_active
  ON plans (tier, version DESC)
  WHERE is_active = TRUE AND deleted_at IS NULL;
```

---

## 3. Table: `plan_prices` (`003_plan_prices.sql`)

```sql
CREATE TABLE IF NOT EXISTS plan_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    provider billing_provider_type NOT NULL,
    billing_interval billing_interval_type NOT NULL,
    currency CHAR(3) NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    provider_price_id VARCHAR(150),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_plan_price UNIQUE (
        plan_id,
        provider,
        billing_interval,
        currency,
        starts_at
    ),

    CONSTRAINT chk_plan_price_window CHECK (
        ends_at IS NULL
        OR starts_at IS NULL
        OR ends_at > starts_at
    )
);

CREATE INDEX IF NOT EXISTS idx_plan_prices_plan ON plan_prices(plan_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_prices_default ON plan_prices(plan_id, billing_interval, currency) WHERE is_default = TRUE AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_price ON plan_prices(provider, provider_price_id) WHERE provider_price_id IS NOT NULL AND deleted_at IS NULL;
```

---

## 4. Table: `billing_features` (`004_billing_features.sql`)

```sql
CREATE TABLE IF NOT EXISTS billing_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key VARCHAR(100) NOT NULL,
    feature_name VARCHAR(150) NOT NULL,
    description TEXT,
    category billing_feature_category NOT NULL,
    value_type billing_feature_value_type NOT NULL,
    is_billable BOOLEAN NOT NULL DEFAULT TRUE,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    is_deprecated BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_billing_feature_key UNIQUE(feature_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_features_category ON billing_features(category) WHERE deleted_at IS NULL;
```

---

## 5. Table: `plan_feature_entitlements` (`005_plan_feature_entitlements.sql`)

```sql
CREATE TABLE IF NOT EXISTS plan_feature_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    feature_id UUID NOT NULL REFERENCES billing_features(id) ON DELETE CASCADE,
    boolean_value BOOLEAN,
    integer_value BIGINT,
    decimal_value NUMERIC(20,6),
    string_value TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_plan_feature UNIQUE(plan_id, feature_id),

    CONSTRAINT chk_single_value CHECK (
        ((boolean_value IS NOT NULL)::int +
         (integer_value IS NOT NULL)::int +
         (decimal_value IS NOT NULL)::int +
         (string_value IS NOT NULL)::int) <= 1
    )
);

CREATE INDEX IF NOT EXISTS idx_pfe_plan ON plan_feature_entitlements(plan_id) WHERE deleted_at IS NULL;
```

---

## 6. Table: `organization_subscriptions` (`006_organization_subscriptions.sql`)

```sql
CREATE TABLE IF NOT EXISTS organization_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    status billing_subscription_status NOT NULL,
    provider billing_provider_type NOT NULL DEFAULT 'system',
    billing_interval billing_interval_type NOT NULL,
    provider_customer_id VARCHAR(150),
    provider_subscription_id VARCHAR(150),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    cancelled_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_subscription_period CHECK (current_period_end > current_period_start),
    CONSTRAINT chk_trial_period CHECK (trial_start IS NULL OR trial_end IS NULL OR trial_end > trial_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_single_active_subscription
ON organization_subscriptions(organization_id)
WHERE status IN ('trialing','active','past_due') AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_subscription
ON organization_subscriptions(provider, provider_subscription_id)
WHERE provider_subscription_id IS NOT NULL AND deleted_at IS NULL;
```

---

## 7. Table: `subscription_events` (`007_subscription_events.sql`)

```sql
CREATE TABLE IF NOT EXISTS subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
    event_type subscription_event_type NOT NULL,
    actor subscription_event_actor NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    old_plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    new_plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    request_id UUID,
    correlation_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_org_time ON subscription_events (organization_id, created_at DESC);
```

---

## 8. Table: `subscription_addons` (`008_subscription_addons.sql`)

```sql
CREATE TABLE IF NOT EXISTS subscription_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    feature_id UUID NOT NULL REFERENCES billing_features(id) ON DELETE RESTRICT,
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    provider billing_provider_type NOT NULL DEFAULT 'system',
    provider_reference VARCHAR(150),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','scheduled','expired','cancelled')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_addon_window CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_active ON subscription_addons(status, expires_at) WHERE status='active';
```

---

## 9. Table: `organization_feature_overrides` (`009_organization_feature_overrides.sql`)

```sql
CREATE TABLE IF NOT EXISTS organization_feature_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    feature_id UUID NOT NULL REFERENCES billing_features(id) ON DELETE RESTRICT,
    boolean_value BOOLEAN,
    integer_value BIGINT,
    decimal_value NUMERIC(20,6),
    string_value TEXT,
    reason TEXT NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_override_window CHECK (expires_at IS NULL OR expires_at > effective_from),
    CONSTRAINT chk_override_single_value CHECK (
        ((boolean_value IS NOT NULL)::int +
         (integer_value IS NOT NULL)::int +
         (decimal_value IS NOT NULL)::int +
         (string_value IS NOT NULL)::int) <= 1
    )
);

CREATE INDEX IF NOT EXISTS idx_ofo_org_feature ON organization_feature_overrides(organization_id, feature_id) WHERE deleted_at IS NULL;
```

---

## 10. Table: `organization_usage_current_period` (`010_organization_usage_current_period.sql`)

```sql
CREATE TABLE IF NOT EXISTS organization_usage_current_period (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    events_used BIGINT NOT NULL DEFAULT 0,
    ai_credits_used BIGINT NOT NULL DEFAULT 0,
    projects_used INTEGER NOT NULL DEFAULT 0,
    members_used INTEGER NOT NULL DEFAULT 0,
    api_keys_used INTEGER NOT NULL DEFAULT 0,
    connectors_used INTEGER NOT NULL DEFAULT 0,
    alert_rules_used INTEGER NOT NULL DEFAULT 0,
    dashboards_used INTEGER NOT NULL DEFAULT 0,
    event_limit BIGINT NOT NULL DEFAULT 0,
    ai_credit_limit BIGINT NOT NULL DEFAULT 0,
    overage_events BIGINT NOT NULL DEFAULT 0,
    overage_ai_credits BIGINT NOT NULL DEFAULT 0,
    last_event_at TIMESTAMPTZ,
    last_ai_request_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_usage_period CHECK (period_end > period_start),
    CONSTRAINT chk_non_negative CHECK (
        events_used >= 0 AND ai_credits_used >= 0 AND projects_used >= 0 AND
        members_used >= 0 AND api_keys_used >= 0 AND connectors_used >= 0 AND
        alert_rules_used >= 0 AND dashboards_used >= 0 AND event_limit >= 0 AND ai_credit_limit >= 0
    )
);
```

---

## 11. Partitioned Table: `usage_daily_counters` (`011_usage_daily_counters.sql`)

```sql
CREATE TABLE IF NOT EXISTS usage_daily_counters (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL,
    events_count BIGINT NOT NULL DEFAULT 0,
    ai_credits_used BIGINT NOT NULL DEFAULT 0,
    requests_count BIGINT NOT NULL DEFAULT 0,
    errors_count BIGINT NOT NULL DEFAULT 0,
    traces_count BIGINT NOT NULL DEFAULT 0,
    spans_count BIGINT NOT NULL DEFAULT 0,
    metrics_count BIGINT NOT NULL DEFAULT 0,
    logs_count BIGINT NOT NULL DEFAULT 0,
    profiles_count BIGINT NOT NULL DEFAULT 0,
    replays_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, usage_date),
    CONSTRAINT uq_usage_scope UNIQUE (organization_id, project_id, usage_date)
) PARTITION BY RANGE (usage_date);

-- July 2026 Monthly Partition
CREATE TABLE IF NOT EXISTS usage_daily_counters_2026_07
PARTITION OF usage_daily_counters
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

---

## 12. Partitioned Table: `ai_usage_logs` (`012_ai_usage_logs.sql`)

```sql
CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    feature_key VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
    prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
    completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
    total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
    estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success','failed','timeout','cancelled')),
    request_id UUID,
    trace_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- July 2026 Monthly Partition
CREATE TABLE IF NOT EXISTS ai_usage_logs_2026_07
PARTITION OF ai_usage_logs
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

---

## 13. Table: `invoices` (`013_invoices.sql`)

```sql
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
    provider billing_provider_type NOT NULL,
    provider_invoice_id VARCHAR(150),
    invoice_number VARCHAR(100) NOT NULL,
    status billing_invoice_status NOT NULL,
    currency CHAR(3) NOT NULL,
    subtotal_amount BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
    tax_amount BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    amount_paid BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    tax_rate NUMERIC(6,3),
    tax_id_snapshot VARCHAR(100),
    billing_address_snapshot JSONB,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    overage_events BIGINT NOT NULL DEFAULT 0,
    overage_amount BIGINT NOT NULL DEFAULT 0,
    pdf_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_invoice_period CHECK (period_end > period_start),
    CONSTRAINT uq_invoice_number UNIQUE (invoice_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_invoice ON invoices(provider, provider_invoice_id) WHERE provider_invoice_id IS NOT NULL AND deleted_at IS NULL;
```

---

## 14. Table: `payments` (`014_payments.sql`)

```sql
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    subscription_id UUID REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
    provider billing_provider_type NOT NULL,
    provider_payment_id VARCHAR(150),
    provider_order_id VARCHAR(150),
    status billing_payment_status NOT NULL,
    currency CHAR(3) NOT NULL,
    amount BIGINT NOT NULL CHECK (amount >= 0),
    fee_amount BIGINT NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
    tax_amount BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
    payment_method VARCHAR(50),
    payment_method_last4 VARCHAR(10),
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    authorized_at TIMESTAMPTZ,
    captured_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    failure_code VARCHAR(100),
    failure_reason TEXT,
    idempotency_key VARCHAR(150),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_provider_payment UNIQUE(provider, provider_payment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
```

---

## 15. Table: `billing_webhook_events` (`015_billing_webhook_events.sql`)

```sql
CREATE TABLE IF NOT EXISTS billing_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider billing_provider_type NOT NULL,
    provider_event_id VARCHAR(200) NOT NULL,
    event_type VARCHAR(150) NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    payload JSONB NOT NULL,
    payload_sha256 CHAR(64),
    signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
    api_version VARCHAR(50),
    processing_status VARCHAR(20) NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processing','processed','failed','ignored','dead_letter')),
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    next_retry_at TIMESTAMPTZ,
    processing_started_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    processing_duration_ms INTEGER CHECK (processing_duration_ms IS NULL OR processing_duration_ms >= 0),
    request_id UUID,
    correlation_id UUID,
    last_error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_provider_event UNIQUE(provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_bwe_pending ON billing_webhook_events(next_retry_at, received_at) WHERE processing_status IN ('received','failed');
```

---

## 16. Table: `coupons` (`016_coupons.sql`)

```sql
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    discount_type billing_coupon_discount_type NOT NULL,
    discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
    currency CHAR(3),
    max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
    redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
    max_redemptions_per_org INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions_per_org > 0),
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
    CONSTRAINT chk_coupon_window CHECK(valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT chk_percentage_value CHECK (discount_type <> 'percentage' OR (discount_value > 0 AND discount_value <= 100))
);
```

---

## 17. Table: `coupon_redemptions` (`017_coupon_redemptions.sql`)

```sql
CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    redeemed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    currency CHAR(3) NOT NULL,
    redemption_source VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (redemption_source IN ('manual','checkout','admin','promotion','api')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_coupon_org UNIQUE(coupon_id, organization_id)
);
```

---

## 18. Junction Table: `coupon_applicable_plans` (`018_coupon_applicable_plans.sql`)

```sql
CREATE TABLE IF NOT EXISTS coupon_applicable_plans (
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (coupon_id, plan_id)
);
```

---

## 19. Partitioned Table: `billing_audit_logs` (`019_billing_audit_logs.sql`)

```sql
CREATE TABLE IF NOT EXISTS billing_audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
    actor_type subscription_event_actor NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    request_id UUID,
    correlation_id UUID,
    trace_id UUID,
    ip_address INET,
    user_agent TEXT,
    previous_state JSONB,
    new_state JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- July 2026 Monthly Partition
CREATE TABLE IF NOT EXISTS billing_audit_logs_2026_07
PARTITION OF billing_audit_logs
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

---

## 20. Views & Stored Functions (`020_views_and_functions.sql`)

```sql
-- Effective Entitlements View
CREATE OR REPLACE VIEW v_effective_entitlements AS
SELECT
    os.organization_id,
    bf.feature_key,
    COALESCE(ofo.boolean_value, pfe.boolean_value)     AS boolean_value,
    COALESCE(ofo.integer_value, pfe.integer_value)     AS integer_value,
    COALESCE(ofo.decimal_value, pfe.decimal_value)     AS decimal_value,
    COALESCE(ofo.string_value, pfe.string_value)       AS string_value
FROM organization_subscriptions os
JOIN plans p ON p.id = os.plan_id
JOIN plan_feature_entitlements pfe ON pfe.plan_id = p.id
JOIN billing_features bf ON bf.id = pfe.feature_id
LEFT JOIN organization_feature_overrides ofo
  ON ofo.organization_id = os.organization_id
 AND ofo.feature_id = bf.id
 AND ofo.deleted_at IS NULL
 AND (ofo.expires_at IS NULL OR ofo.expires_at > NOW())
WHERE os.status IN ('trialing','active','past_due');

-- Current Period Usage View
CREATE OR REPLACE VIEW v_current_usage AS
SELECT
    organization_id,
    period_start,
    period_end,
    events_used,
    event_limit,
    (event_limit - events_used) AS remaining_events,
    ai_credits_used,
    ai_credit_limit,
    (ai_credit_limit - ai_credits_used) AS remaining_ai_credits,
    projects_used,
    members_used,
    api_keys_used,
    connectors_used,
    alert_rules_used,
    dashboards_used
FROM organization_usage_current_period;

-- Subscription Summary View
CREATE OR REPLACE VIEW v_subscription_summary AS
SELECT
    os.organization_id,
    p.name            AS plan_name,
    p.key             AS plan_key,
    p.tier,
    os.status,
    os.billing_interval,
    os.current_period_start,
    os.current_period_end,
    os.cancel_at_period_end
FROM organization_subscriptions os
JOIN plans p ON p.id = os.plan_id;
```

-- ============================================================================
-- 015_billing_create_core_schema.up.sql
-- ----------------------------------------------------------------------------
-- Canonical billing schema for the authoritative migrations2 chain.
--
-- Design goals:
--   * Reuse existing canonical tables from migrations2:
--       - organizations(id)
--       - projects(id)
--       - project_usage / usage_counter_staging (ingestion usage source)
--   * Do NOT recreate legacy billing_plans / organization_billing /
--     organization_usage tables from scheam2.sql.
--   * Keep the request-path subscription table lean and index the hot lookups.
--   * Add daily billing usage rollup storage that can be fed from project_usage.
--
-- Notes:
--   * provider_* columns are nullable so free/system/manual subscriptions can
--     exist without fake provider identifiers.
--   * billing_provider includes system/manual in addition to stripe/razorpay to
--     support free-plan downgrades and admin-entered enterprise contracts.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_plan_tier') THEN
    CREATE TYPE billing_plan_tier AS ENUM ('free','pro','enterprise');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_subscription_status') THEN
    CREATE TYPE billing_subscription_status AS ENUM ('trialing','active','past_due','canceled','incomplete','paused');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_provider_type') THEN
    CREATE TYPE billing_provider_type AS ENUM ('stripe','razorpay','manual','system');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_interval_type') THEN
    CREATE TYPE billing_interval_type AS ENUM ('monthly','annual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_invoice_status') THEN
    CREATE TYPE billing_invoice_status AS ENUM ('draft','open','paid','void','uncollectible');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_coupon_discount_type') THEN
    CREATE TYPE billing_coupon_discount_type AS ENUM ('percent','fixed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(50) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    name VARCHAR(100) NOT NULL,
    tier billing_plan_tier NOT NULL,
    description TEXT,
    event_limit_monthly BIGINT NOT NULL,
    price_inr_monthly INTEGER,
    price_usd_monthly INTEGER,
    price_inr_annual INTEGER,
    price_usd_annual INTEGER,
    overage_price_per_1k_inr INTEGER,
    overage_price_per_1k_usd INTEGER,
    hard_cap BOOLEAN NOT NULL DEFAULT TRUE,
    stripe_price_id_monthly VARCHAR(100),
    stripe_price_id_annual VARCHAR(100),
    razorpay_plan_id_monthly VARCHAR(100),
    razorpay_plan_id_annual VARCHAR(100),
    feature_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_plans_key_version UNIQUE (key, version)
);

CREATE INDEX IF NOT EXISTS idx_plans_active_public
  ON plans (sort_order, key)
  WHERE is_active = TRUE AND is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_plans_feature_config
  ON plans USING GIN (feature_config);
CREATE INDEX IF NOT EXISTS idx_plans_tier_active
  ON plans (tier, version DESC)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS organization_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    status billing_subscription_status NOT NULL,
    billing_provider billing_provider_type NOT NULL DEFAULT 'system',
    provider_customer_id VARCHAR(100),
    provider_subscription_id VARCHAR(100),
    billing_interval billing_interval_type NOT NULL DEFAULT 'monthly',
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at TIMESTAMPTZ,
    seats INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_sub_one_active
  ON organization_subscriptions (org_id)
  WHERE status IN ('trialing','active','past_due');
CREATE INDEX IF NOT EXISTS idx_org_sub_provider_lookup
  ON organization_subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_sub_period_end
  ON organization_subscriptions (current_period_end)
  WHERE status IN ('active','trialing');
CREATE INDEX IF NOT EXISTS idx_org_sub_trial_end
  ON organization_subscriptions (trial_end)
  WHERE status = 'trialing';
CREATE INDEX IF NOT EXISTS idx_org_sub_org_created
  ON organization_subscriptions (org_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_org_subscriptions_updated_at ON organization_subscriptions;
CREATE TRIGGER trg_org_subscriptions_updated_at BEFORE UPDATE ON organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
    event_type VARCHAR(30) NOT NULL,
    old_plan_id UUID REFERENCES plans(id),
    new_plan_id UUID REFERENCES plans(id),
    actor VARCHAR(20) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_org_time
  ON subscription_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_events_sub_time
  ON subscription_events (subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_daily_counters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    events_count BIGINT NOT NULL DEFAULT 0,
    ai_analyses_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_usage_daily_counters_scope UNIQUE (org_id, project_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_org_date_brin
  ON usage_daily_counters USING BRIN (date);
CREATE INDEX IF NOT EXISTS idx_usage_org_lookup
  ON usage_daily_counters (org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_usage_project_lookup
  ON usage_daily_counters (project_id, date DESC);

DROP TRIGGER IF EXISTS trg_usage_daily_counters_updated_at ON usage_daily_counters;
CREATE TRIGGER trg_usage_daily_counters_updated_at BEFORE UPDATE ON usage_daily_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
    provider billing_provider_type NOT NULL,
    provider_invoice_id VARCHAR(100) NOT NULL,
    status billing_invoice_status NOT NULL,
    amount_due INTEGER NOT NULL,
    amount_paid INTEGER NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    overage_events BIGINT NOT NULL DEFAULT 0,
    overage_amount INTEGER NOT NULL DEFAULT 0,
    pdf_url TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_invoices_provider_invoice UNIQUE (provider, provider_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_org
  ON invoices (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription
  ON invoices (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices (status, created_at DESC);

CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) NOT NULL UNIQUE,
    discount_type billing_coupon_discount_type NOT NULL,
    discount_value INTEGER NOT NULL,
    applicable_plans UUID[],
    max_redemptions INTEGER,
    redemption_count INTEGER NOT NULL DEFAULT 0,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_active
  ON coupons (code)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_coupons_valid_until
  ON coupons (valid_until)
  WHERE valid_until IS NOT NULL;

DROP TRIGGER IF EXISTS trg_coupons_updated_at ON coupons;
CREATE TRIGGER trg_coupons_updated_at BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_coupon_redemptions_coupon_org UNIQUE (coupon_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_org
  ON coupon_redemptions (org_id, redeemed_at DESC);

COMMIT;

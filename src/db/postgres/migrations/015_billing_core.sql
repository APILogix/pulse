BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE plan_interval AS ENUM ('monthly', 'yearly', 'custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE plan_tier AS ENUM ('starter', 'professional', 'enterprise', 'custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE billing_status AS ENUM ('active', 'past_due', 'canceled', 'unpaid', 'paused', 'trialing');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_method_type AS ENUM ('card', 'bank_transfer', 'paypal', 'crypto', 'invoice');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS billing_plans (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  tier plan_tier NOT NULL DEFAULT 'starter',
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  base_price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (base_price_monthly >= 0),
  base_price_yearly NUMERIC(10,2) CHECK (base_price_yearly >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  billing_interval plan_interval NOT NULL DEFAULT 'monthly',
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  trial_days INTEGER NOT NULL DEFAULT 14 CHECK (trial_days >= 0),
  grace_period_days INTEGER NOT NULL DEFAULT 7 CHECK (grace_period_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deprecated_at TIMESTAMPTZ,
  replaced_by VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_billing_plans_replaced_by'
  ) THEN
    ALTER TABLE billing_plans
      ADD CONSTRAINT fk_billing_plans_replaced_by
      FOREIGN KEY (replaced_by)
      REFERENCES billing_plans(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_billing_plans_updated_at ON billing_plans;
CREATE TRIGGER trg_billing_plans_updated_at
BEFORE UPDATE ON billing_plans
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS organization_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id VARCHAR(50) NOT NULL REFERENCES billing_plans(id),
  status billing_status NOT NULL DEFAULT 'trialing',
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  billing_cycle_anchor TIMESTAMPTZ NOT NULL,
  default_payment_method_id UUID,
  payment_method_type payment_method_type NOT NULL DEFAULT 'card',
  stripe_customer_id VARCHAR(100),
  stripe_subscription_id VARCHAR(100),
  invoice_prefix VARCHAR(20),
  next_invoice_number INTEGER NOT NULL DEFAULT 1 CHECK (next_invoice_number > 0),
  invoice_notes TEXT,
  net_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (net_terms_days >= 0),
  usage_billing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  overage_rate_per_unit NUMERIC(10,4) CHECK (overage_rate_per_unit >= 0),
  mrr NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (mrr >= 0),
  arr NUMERIC(10,2) GENERATED ALWAYS AS (mrr * 12) STORED,
  total_paid_to_date NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_paid_to_date >= 0),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  grace_period_start TIMESTAMPTZ,
  grace_period_end TIMESTAMPTZ,
  tax_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  tax_id VARCHAR(50),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_organization_billing_updated_at ON organization_billing;
CREATE TRIGGER trg_organization_billing_updated_at
BEFORE UPDATE ON organization_billing
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS organization_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_organization_payment_methods_updated_at ON organization_payment_methods;
CREATE TRIGGER trg_organization_payment_methods_updated_at
BEFORE UPDATE ON organization_payment_methods
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_payment_method
ON organization_payment_methods(org_id)
WHERE is_default = TRUE;

COMMIT;

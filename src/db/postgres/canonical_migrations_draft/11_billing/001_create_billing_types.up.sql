BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_plan_tier') THEN
    CREATE TYPE billing_plan_tier AS ENUM ('free', 'pro', 'enterprise');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_subscription_status') THEN
    CREATE TYPE billing_subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'paused');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_provider_type') THEN
    CREATE TYPE billing_provider_type AS ENUM ('stripe', 'razorpay', 'manual', 'system');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_interval_type') THEN
    CREATE TYPE billing_interval_type AS ENUM ('monthly', 'annual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_invoice_status') THEN
    CREATE TYPE billing_invoice_status AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_coupon_discount_type') THEN
    CREATE TYPE billing_coupon_discount_type AS ENUM ('percent', 'fixed');
  END IF;
END $$;

COMMIT;

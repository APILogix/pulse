BEGIN;

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
  ON plans(sort_order, key)
  WHERE is_active = TRUE AND is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_plans_feature_config
  ON plans USING GIN (feature_config);
CREATE INDEX IF NOT EXISTS idx_plans_tier_active
  ON plans(tier, version DESC)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

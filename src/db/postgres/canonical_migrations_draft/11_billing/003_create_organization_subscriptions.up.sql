BEGIN;

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_sub_one_active
  ON organization_subscriptions(org_id)
  WHERE status IN ('trialing', 'active', 'past_due');
CREATE INDEX IF NOT EXISTS idx_org_sub_provider_lookup
  ON organization_subscriptions(provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_sub_period_end
  ON organization_subscriptions(current_period_end)
  WHERE status IN ('active', 'trialing');
CREATE INDEX IF NOT EXISTS idx_org_sub_trial_end
  ON organization_subscriptions(trial_end)
  WHERE status = 'trialing';
CREATE INDEX IF NOT EXISTS idx_org_sub_org_created
  ON organization_subscriptions(org_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_org_subscriptions_updated_at ON organization_subscriptions;
CREATE TRIGGER trg_org_subscriptions_updated_at
  BEFORE UPDATE ON organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

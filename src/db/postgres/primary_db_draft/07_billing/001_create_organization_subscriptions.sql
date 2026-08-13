-- Normalized final definition for organization_subscriptions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/006_organization_subscriptions.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS organization_subscriptions
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  plan_id UUID NOT NULL
  REFERENCES plans(id),
  status billing_subscription_status NOT NULL,
  provider billing_provider_type NOT NULL DEFAULT 'system',
  billing_interval billing_interval_type NOT NULL,
  provider_customer_id VARCHAR(150),
  provider_subscription_id VARCHAR(150),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end   TIMESTAMPTZ NOT NULL,
  trial_start TIMESTAMPTZ,
  trial_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  modules JSONB NOT NULL DEFAULT '{}',
  performance_class VARCHAR(20),
  addons JSONB NOT NULL DEFAULT '[]',
  next_plan_id UUID REFERENCES plans(id),
  entitlement_version INTEGER NOT NULL DEFAULT 1,
  entitlement_snapshot_version INTEGER,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_subscription_period
  CHECK (current_period_end > current_period_start),
  CONSTRAINT chk_trial_period
  CHECK (
  trial_start IS NULL
  OR trial_end IS NULL
  OR trial_end > trial_start
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_single_active_subscription
ON organization_subscriptions(organization_id)
WHERE status IN ('trialing','active','past_due')
AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_subscription
ON organization_subscriptions(provider, provider_subscription_id)
WHERE provider_subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org
ON organization_subscriptions(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_plan
ON organization_subscriptions(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_period_end
ON organization_subscriptions(current_period_end)
WHERE status IN ('trialing','active','past_due')
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_status
ON organization_subscriptions(status)
WHERE deleted_at IS NULL;

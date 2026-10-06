-- Normalized final definition for subscription_addons.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/008_subscription_addons.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/006_organization_subscriptions.sql

CREATE TABLE IF NOT EXISTS subscription_addons
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL
  REFERENCES organization_subscriptions(id)
  ON DELETE CASCADE,
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  feature_id UUID NOT NULL
  REFERENCES billing_features(id)
  ON DELETE RESTRICT,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  provider billing_provider_type NOT NULL DEFAULT 'system',
  provider_reference VARCHAR(150),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','scheduled','expired','cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  addon_key VARCHAR(50),
  module VARCHAR(50),
  addon_id UUID REFERENCES addons(id) ON DELETE SET NULL,
  CONSTRAINT chk_addon_window
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_subscription
ON subscription_addons(subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_org
ON subscription_addons(organization_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_feature
ON subscription_addons(feature_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_active
ON subscription_addons(status, expires_at)
WHERE status='active';

CREATE INDEX IF NOT EXISTS idx_subscription_addons_metadata
ON subscription_addons
USING GIN(metadata);

-- Normalized final definition for billing_features.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/004_billing_features.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/006_organization_subscriptions.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS billing_features
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key        VARCHAR(100) NOT NULL,
  feature_name       VARCHAR(150) NOT NULL,
  description        TEXT,
  category           billing_feature_category NOT NULL,
  value_type         billing_feature_value_type NOT NULL,
  is_billable        BOOLEAN NOT NULL DEFAULT TRUE,
  is_public          BOOLEAN NOT NULL DEFAULT TRUE,
  is_deprecated      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ,
  module VARCHAR(50),
  is_module_root BOOLEAN NOT NULL DEFAULT FALSE,
  usage_behavior billing_usage_behavior NOT NULL DEFAULT 'none',
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility billing_visibility NOT NULL DEFAULT 'public',
  CONSTRAINT uq_billing_feature_key UNIQUE(feature_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_features_category
ON billing_features(category)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_features_public
ON billing_features(is_public, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_features_billable
ON billing_features(is_billable)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_feature_public ON billing_features(category, sort_order) WHERE is_public = TRUE;

-- Normalized final definition for plan_feature_entitlements.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/005_plan_feature_entitlements.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS plan_feature_entitlements
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL
  REFERENCES plans(id)
  ON DELETE CASCADE,
  feature_id UUID NOT NULL
  REFERENCES billing_features(id)
  ON DELETE CASCADE,
  boolean_value BOOLEAN,
  integer_value BIGINT,
  decimal_value NUMERIC(20,6),
  string_value TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_value TEXT,
  CONSTRAINT uq_plan_feature UNIQUE(plan_id, feature_id),
  CONSTRAINT chk_single_value CHECK (
  ((boolean_value IS NOT NULL)::int +
  (integer_value IS NOT NULL)::int +
  (decimal_value IS NOT NULL)::int +
  (string_value IS NOT NULL)::int) <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_pfe_plan
ON plan_feature_entitlements(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pfe_feature
ON plan_feature_entitlements(feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pfe_plan_feature
ON plan_feature_entitlements(plan_id, feature_id)
WHERE deleted_at IS NULL;

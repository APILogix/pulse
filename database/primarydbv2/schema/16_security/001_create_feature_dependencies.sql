-- Normalized final definition for feature_dependencies.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS feature_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id UUID NOT NULL REFERENCES billing_features(id) ON DELETE CASCADE,
  depends_on_feature_id UUID NOT NULL REFERENCES billing_features(id) ON DELETE CASCADE,
  dependency_type VARCHAR(20) NOT NULL DEFAULT 'requires',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_feature_dependency_not_self CHECK (feature_id <> depends_on_feature_id),
  CONSTRAINT uq_feature_dependency UNIQUE (feature_id, depends_on_feature_id)
);

CREATE INDEX IF NOT EXISTS idx_feature_dependencies_feature ON feature_dependencies(feature_id);

CREATE INDEX IF NOT EXISTS idx_feature_dependencies_depends_on ON feature_dependencies(depends_on_feature_id);

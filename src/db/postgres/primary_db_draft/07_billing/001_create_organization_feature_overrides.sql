-- Normalized final definition for organization_feature_overrides.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/009_organization_feature_overrides.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS organization_feature_overrides
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  feature_id UUID NOT NULL
  REFERENCES billing_features(id)
  ON DELETE RESTRICT,
  boolean_value BOOLEAN,
  integer_value BIGINT,
  decimal_value NUMERIC(20,6),
  string_value TEXT,
  reason TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_by UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  approved_by UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_override_window
  CHECK (expires_at IS NULL OR expires_at > effective_from),
  CONSTRAINT chk_override_single_value
  CHECK (
  ((boolean_value IS NOT NULL)::int +
  (integer_value IS NOT NULL)::int +
  (decimal_value IS NOT NULL)::int +
  (string_value IS NOT NULL)::int) <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_ofo_org
ON organization_feature_overrides(organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_feature
ON organization_feature_overrides(feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_org_feature
ON organization_feature_overrides(organization_id, feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_active
ON organization_feature_overrides(effective_from, expires_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_metadata
ON organization_feature_overrides
USING GIN(metadata);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ofo_active_org_feature
  ON organization_feature_overrides(organization_id, feature_id)
  WHERE deleted_at IS NULL;

-- =============================================================================
-- Canonical billing reconciliation
--
-- This file is intentionally additive.  It extends the versioned canonical
-- tables and must remain safe in the draft migration loader, which executes
-- every .sql file lexically.  Do not create parallel add-on, override, or
-- usage tables here.
-- =============================================================================

BEGIN;

-- The feature seeds use these categories.  Existing values are preserved.
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'quota';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'feature';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'sdk';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'transport';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'sampling';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'instrumentation';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'privacy';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'killswitch';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'alerting';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'integration';
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'support';
ALTER TYPE billing_feature_value_type ADD VALUE IF NOT EXISTS 'json';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_usage_behavior') THEN
    CREATE TYPE billing_usage_behavior AS ENUM ('none', 'hard_limit', 'soft_limit', 'overage', 'throttle');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_visibility') THEN
    CREATE TYPE billing_visibility AS ENUM ('public', 'internal', 'hidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_tax_behavior') THEN
    CREATE TYPE billing_tax_behavior AS ENUM ('exclusive', 'inclusive', 'unspecified');
  END IF;
END $$;

ALTER TABLE billing_features
  ADD COLUMN IF NOT EXISTS usage_behavior billing_usage_behavior NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS visibility billing_visibility NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS module VARCHAR(50),
  ADD COLUMN IF NOT EXISTS is_module_root BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE plan_feature_entitlements
  ADD COLUMN IF NOT EXISTS configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS display_value TEXT;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS is_customizable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS next_plan_key VARCHAR(50),
  ADD COLUMN IF NOT EXISTS previous_plan_key VARCHAR(50),
  ADD COLUMN IF NOT EXISTS badge VARCHAR(50),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE organization_subscriptions
  ADD COLUMN IF NOT EXISTS next_plan_id UUID REFERENCES plans(id),
  ADD COLUMN IF NOT EXISTS entitlement_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS entitlement_snapshot_version INTEGER,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT TRUE;

-- The existing organization_feature_overrides table is canonical.  Extend it
-- for structured SDK/runtime overrides rather than introducing a second table.
ALTER TABLE organization_feature_overrides
  ADD COLUMN IF NOT EXISTS configuration JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Keep the denormalized current-period row compatible with existing resource
-- lifecycle code.  Feature-keyed entitlements remain the authority; these are
-- cached limits for the atomic fast path.
ALTER TABLE organization_usage_current_period
  ADD COLUMN IF NOT EXISTS projects_limit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS members_limit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS api_keys_limit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS connectors_limit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alert_rules_limit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dashboards_limit INTEGER NOT NULL DEFAULT 0;

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
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(sort_order) WHERE deleted_at IS NULL AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_plan_prices_active ON plan_prices(plan_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_feature_public ON billing_features(category, sort_order) WHERE is_public = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ofo_active_org_feature
  ON organization_feature_overrides(organization_id, feature_id)
  WHERE deleted_at IS NULL;

-- SQL consumers receive the same plan → override → add-on values as the
-- application resolver.  Add-ons increase numeric values and enable booleans.
CREATE OR REPLACE VIEW v_effective_entitlements AS
WITH active_subscription AS (
  SELECT DISTINCT ON (organization_id) *
  FROM organization_subscriptions
  WHERE status IN ('trialing', 'active', 'past_due')
    AND deleted_at IS NULL
    AND current_period_end > NOW()
  ORDER BY organization_id,
           CASE status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 ELSE 2 END,
           created_at DESC
), base AS (
  SELECT os.organization_id, bf.id AS feature_id, bf.feature_key, bf.value_type,
         COALESCE(ofo.boolean_value, pfe.boolean_value) AS boolean_value,
         COALESCE(ofo.integer_value, pfe.integer_value) AS integer_value,
         COALESCE(ofo.decimal_value, pfe.decimal_value) AS decimal_value,
         COALESCE(ofo.string_value, pfe.string_value) AS string_value
  FROM active_subscription os
  JOIN plan_feature_entitlements pfe ON pfe.plan_id = os.plan_id AND pfe.deleted_at IS NULL
  JOIN billing_features bf ON bf.id = pfe.feature_id AND bf.deleted_at IS NULL AND bf.is_deprecated = FALSE
  LEFT JOIN organization_feature_overrides ofo
    ON ofo.organization_id = os.organization_id AND ofo.feature_id = bf.id
   AND ofo.deleted_at IS NULL AND ofo.effective_from <= NOW()
   AND (ofo.expires_at IS NULL OR ofo.expires_at > NOW())
), addon AS (
  SELECT os.organization_id, sa.feature_id,
         BOOL_OR(bf.value_type = 'boolean') AS boolean_value,
         SUM(sa.quantity) FILTER (WHERE bf.value_type = 'integer')::bigint AS integer_value,
         SUM(sa.quantity) FILTER (WHERE bf.value_type = 'decimal')::numeric AS decimal_value
  FROM active_subscription os
  JOIN subscription_addons sa ON sa.subscription_id = os.id AND sa.organization_id = os.organization_id
    AND sa.status = 'active' AND sa.starts_at <= NOW() AND (sa.expires_at IS NULL OR sa.expires_at > NOW())
  JOIN billing_features bf ON bf.id = sa.feature_id
  GROUP BY os.organization_id, sa.feature_id
)
SELECT base.organization_id, base.feature_key,
       CASE WHEN base.value_type = 'boolean' THEN COALESCE(base.boolean_value, FALSE) OR COALESCE(addon.boolean_value, FALSE) ELSE base.boolean_value END AS boolean_value,
       CASE WHEN base.integer_value = -1 THEN -1 ELSE COALESCE(base.integer_value, 0) + COALESCE(addon.integer_value, 0) END AS integer_value,
       CASE WHEN base.decimal_value = -1 THEN -1 ELSE COALESCE(base.decimal_value, 0) + COALESCE(addon.decimal_value, 0) END AS decimal_value,
       base.string_value
FROM base
LEFT JOIN addon ON addon.organization_id = base.organization_id AND addon.feature_id = base.feature_id;

COMMIT;

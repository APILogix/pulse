-- =============================================================================
-- Module      : Billing
-- Migration   : 002_plans.sql
-- Description : Plan definitions for billing
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(100) NOT NULL,
  tier billing_plan_tier NOT NULL,
  description TEXT,
  trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT uq_plans_key_version UNIQUE (key, version)
);

COMMENT ON TABLE plans IS
'Billing plans define commercial tiers and lifecycle metadata. Pricing and entitlements are stored in separate tables.';

COMMENT ON COLUMN plans.id IS 'Primary identifier for the plan.';
COMMENT ON COLUMN plans.key IS 'Stable machine-readable identifier for the plan family, such as free or starter.';
COMMENT ON COLUMN plans.version IS 'Version number for the plan definition.';
COMMENT ON COLUMN plans.name IS 'Human-readable plan name.';
COMMENT ON COLUMN plans.tier IS 'Commercial tier used for display and logic.';
COMMENT ON COLUMN plans.description IS 'Optional marketing or internal description.';
COMMENT ON COLUMN plans.trial_days IS 'Number of trial days included with the plan.';
COMMENT ON COLUMN plans.is_active IS 'Whether this plan version can be assigned to subscriptions.';
COMMENT ON COLUMN plans.is_public IS 'Whether this plan is visible in public pricing pages.';
COMMENT ON COLUMN plans.sort_order IS 'Display order for UI listing.';
COMMENT ON COLUMN plans.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN plans.updated_at IS 'Row update timestamp.';
COMMENT ON COLUMN plans.deleted_at IS 'Soft delete timestamp.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_active_key
  ON plans (key)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_active_public
  ON plans (sort_order, tier, key)
  WHERE is_active = TRUE AND is_public = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_tier_active
  ON plans (tier, version DESC)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_key_version
  ON plans (key, version DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_public_sort
  ON plans (is_public, sort_order)
  WHERE is_active = TRUE AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
-- Normalized final definition for plans.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/002_plans.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

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
  is_customizable BOOLEAN NOT NULL DEFAULT FALSE,
  next_plan_key VARCHAR(50),
  previous_plan_key VARCHAR(50),
  badge VARCHAR(50),
  CONSTRAINT uq_plans_key_version UNIQUE (key, version)
);

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

CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(sort_order) WHERE deleted_at IS NULL AND is_active = TRUE;

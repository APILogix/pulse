-- Normalized final definition for credit_rules.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/004_credit_rules.up.sql

CREATE TABLE IF NOT EXISTS credit_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope VARCHAR(20) NOT NULL
  CHECK (scope IN ('platform', 'plan', 'tenant')),
  plan TEXT,
  tenant_id UUID,
  ai_mode TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost >= 0),
  cached_cost INTEGER NOT NULL DEFAULT 0 CHECK (cached_cost >= 0),
  partial_cost INTEGER NOT NULL DEFAULT 0 CHECK (partial_cost >= 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  priority INTEGER NOT NULL DEFAULT 100,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_rules_platform_mode
  ON credit_rules (ai_mode)
  WHERE scope = 'platform' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_credit_rules_lookup
  ON credit_rules (scope, plan, tenant_id, ai_mode)
  WHERE status = 'active';

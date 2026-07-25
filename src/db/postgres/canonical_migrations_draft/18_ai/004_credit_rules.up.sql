-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 004_credit_rules.up.sql
-- Description : Configurable credit costs per scope (platform/plan/tenant)
--               and AI mode. Seeds platform-scope defaults from the
--               masterprompt safe-default costs (cached 0, partial 0).
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

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

COMMENT ON TABLE credit_rules IS
  'Configurable credit costs per AI mode. Resolution is most-specific-wins: tenant > plan > platform.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_rules_platform_mode
  ON credit_rules (ai_mode)
  WHERE scope = 'platform' AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_credit_rules_lookup
  ON credit_rules (scope, plan, tenant_id, ai_mode)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_credit_rules_updated_at ON credit_rules;
CREATE TRIGGER trg_credit_rules_updated_at
  BEFORE UPDATE ON credit_rules
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Platform-scope safe defaults (masterprompt CREDIT-BASED SYSTEM RULES).
INSERT INTO credit_rules (scope, ai_mode, cost, cached_cost, partial_cost, priority, status)
SELECT 'platform', v.ai_mode, v.cost, 0, 0, 100, 'active'
FROM (VALUES
  ('AI_ERROR_EXPLANATION',      2),
  ('AI_ROOT_CAUSE_ANALYSIS',    3),
  ('AI_STACK_TRACE_ANALYSIS',   2),
  ('AI_TRACE_ANALYSIS',         3),
  ('AI_SPAN_ANALYSIS',          2),
  ('AI_SUGGESTED_FIXES',        3),
  ('AI_SQL_OPTIMIZATION',       3),
  ('AI_LOG_SUMMARY',            2),
  ('AI_DEPLOYMENT_CORRELATION', 3),
  ('AI_INCIDENT_SUMMARY',       5),
  ('AI_WEEKLY_REPORT',          5)
) AS v(ai_mode, cost)
WHERE NOT EXISTS (
  SELECT 1 FROM credit_rules cr
  WHERE cr.scope = 'platform' AND cr.ai_mode = v.ai_mode
);

COMMIT;

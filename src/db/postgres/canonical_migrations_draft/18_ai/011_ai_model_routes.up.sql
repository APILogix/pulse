-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 011_ai_model_routes.up.sql
-- Description : Model routing rules per AI mode (optionally per plan or
--               tenant). Seeds defaults: small/fast model for lightweight
--               explanation modes, strong model for analytical modes.
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_model_routes (
  route_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_mode TEXT NOT NULL,
  plan TEXT,
  tenant_id UUID,
  primary_model TEXT NOT NULL,
  fallback_model TEXT,
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.2
    CHECK (temperature >= 0 AND temperature <= 2),
  max_tokens INTEGER NOT NULL DEFAULT 4096 CHECK (max_tokens > 0),
  timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (timeout_ms >= 1000),
  priority INTEGER NOT NULL DEFAULT 100,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_model_routes IS
  'Model routing per AI mode. Resolution is most-specific-wins: tenant > plan > global (plan/tenant NULL).';

CREATE INDEX IF NOT EXISTS idx_ai_model_routes_lookup
  ON ai_model_routes (ai_mode, plan, tenant_id)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_ai_model_routes_updated_at ON ai_model_routes;
CREATE TRIGGER trg_ai_model_routes_updated_at
  BEFORE UPDATE ON ai_model_routes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Global default routes (plan/tenant NULL). Small/fast model for lightweight
-- modes; strong model for analytical modes; temperature ~0.2 for analytical,
-- 30s timeouts. Idempotent seed.
INSERT INTO ai_model_routes (ai_mode, primary_model, fallback_model, temperature, max_tokens, timeout_ms, priority, status)
SELECT v.ai_mode, v.primary_model, v.fallback_model, v.temperature, v.max_tokens, 30000, 100, 'active'
FROM (VALUES
  ('AI_ERROR_EXPLANATION',      'gpt-4o-mini', 'gpt-4o',      0.30::numeric, 2048),
  ('AI_STACK_TRACE_ANALYSIS',   'gpt-4o-mini', 'gpt-4o',      0.20::numeric, 2048),
  ('AI_SPAN_ANALYSIS',          'gpt-4o-mini', 'gpt-4o',      0.20::numeric, 2048),
  ('AI_LOG_SUMMARY',            'gpt-4o-mini', 'gpt-4o',      0.30::numeric, 2048),
  ('AI_ROOT_CAUSE_ANALYSIS',    'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_TRACE_ANALYSIS',         'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_SUGGESTED_FIXES',        'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_SQL_OPTIMIZATION',       'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_DEPLOYMENT_CORRELATION', 'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_INCIDENT_SUMMARY',       'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_WEEKLY_REPORT',          'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096)
) AS v(ai_mode, primary_model, fallback_model, temperature, max_tokens)
WHERE NOT EXISTS (
  SELECT 1 FROM ai_model_routes r
  WHERE r.ai_mode = v.ai_mode AND r.plan IS NULL AND r.tenant_id IS NULL
);

COMMIT;

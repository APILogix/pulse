-- Normalized final definition for ai_model_routes.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/011_ai_model_routes.up.sql

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

CREATE INDEX IF NOT EXISTS idx_ai_model_routes_lookup
  ON ai_model_routes (ai_mode, plan, tenant_id)
  WHERE status = 'active';

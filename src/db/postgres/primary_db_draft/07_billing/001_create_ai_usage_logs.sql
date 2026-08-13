-- Normalized final definition for ai_usage_logs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/012_ai_usage_logs.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ai_usage_logs
(
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  project_id UUID
  REFERENCES projects(id)
  ON DELETE SET NULL,
  user_id UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  feature_key VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS
  (prompt_tokens + completion_tokens) STORED,
  estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0
  CHECK (estimated_cost_usd >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'success'
  CHECK (status IN ('success','failed','timeout','cancelled')),
  request_id UUID,
  trace_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

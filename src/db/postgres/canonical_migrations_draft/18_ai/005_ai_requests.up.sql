-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 005_ai_requests.up.sql
-- Description : Metadata for each AI request. Raw prompts are NEVER stored
--               here (privacy rule) — only hashes, routing and usage metadata.
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  input_hash TEXT,
  cache_key TEXT,
  model_route TEXT,
  provider TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  status TEXT,
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_requests IS
  'AI request metadata. Raw prompt content is intentionally not stored; input_hash identifies the redacted input.';

CREATE INDEX IF NOT EXISTS idx_ai_requests_tenant_time
  ON ai_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_tenant_mode
  ON ai_requests (tenant_id, ai_mode);
CREATE INDEX IF NOT EXISTS idx_ai_requests_cache_key
  ON ai_requests (cache_key)
  WHERE cache_key IS NOT NULL;

COMMIT;

-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 006_ai_responses.up.sql
-- Description : Structured AI answers (redacted) with citations, credit
--               action and prompt-template version for reproducibility.
-- PostgreSQL  : 16+
-- Depends On  : 005_ai_requests.up.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_responses (
  response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ai_requests(request_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  answer JSONB,
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  credit_action JSONB,
  status TEXT,
  prompt_template_version TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_responses IS
  'Structured, redacted AI answers. answer holds the full structured JSONB (summary, analysis, fixes, credit_action, ...).';

CREATE INDEX IF NOT EXISTS idx_ai_responses_request
  ON ai_responses (request_id);
CREATE INDEX IF NOT EXISTS idx_ai_responses_tenant_time
  ON ai_responses (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_responses_tenant_mode
  ON ai_responses (tenant_id, ai_mode);

COMMIT;

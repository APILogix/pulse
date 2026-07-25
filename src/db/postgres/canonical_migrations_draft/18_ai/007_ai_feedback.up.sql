-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 007_ai_feedback.up.sql
-- Description : User feedback on AI answers (ratings, helpfulness,
--               corrections) used for evaluation and improvement.
-- PostgreSQL  : 16+
-- Depends On  : 006_ai_responses.up.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES ai_requests(request_id) ON DELETE SET NULL,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  helpful BOOLEAN,
  correction TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_feedback IS
  'User feedback on AI answers: rating, helpfulness flag, free-text corrections and comments.';

CREATE INDEX IF NOT EXISTS idx_ai_feedback_response
  ON ai_feedback (response_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_tenant_time
  ON ai_feedback (tenant_id, created_at DESC);

COMMIT;

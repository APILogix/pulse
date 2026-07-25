-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 009_ai_cache.up.sql
-- Description : Durable cache of AI answers keyed by a composite cache key
--               (tenant, mode, input, evidence/KB versions, locale, depth).
-- PostgreSQL  : 16+
-- Depends On  : 006_ai_responses.up.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_mode TEXT NOT NULL,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (ttl_seconds >= 0),
  etag TEXT,
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ
);

COMMENT ON TABLE ai_cache IS
  'Durable AI answer cache. Cached successful answers are billed at cached_cost (default 0 credits).';

CREATE INDEX IF NOT EXISTS idx_ai_cache_tenant_mode
  ON ai_cache (tenant_id, ai_mode);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expiry
  ON ai_cache (expires_at)
  WHERE invalidated_at IS NULL;

COMMIT;

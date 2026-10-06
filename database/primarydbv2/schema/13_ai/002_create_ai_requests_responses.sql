-- AI Requests, Responses, Feedback, Jobs, and Cache for PrimaryDB
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

CREATE INDEX IF NOT EXISTS idx_ai_requests_tenant_time
  ON ai_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_tenant_mode
  ON ai_requests (tenant_id, ai_mode);
CREATE INDEX IF NOT EXISTS idx_ai_requests_cache_key
  ON ai_requests (cache_key)
  WHERE cache_key IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_ai_responses_request
  ON ai_responses (request_id);
CREATE INDEX IF NOT EXISTS idx_ai_responses_tenant_time
  ON ai_responses (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_responses_tenant_mode
  ON ai_responses (tenant_id, ai_mode);

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

CREATE INDEX IF NOT EXISTS idx_ai_feedback_response
  ON ai_feedback (response_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_tenant_time
  ON ai_feedback (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input_hash TEXT,
  input_ciphertext TEXT,
  idempotency_key TEXT,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  model_route TEXT,
  pgboss_job_id TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_status
  ON ai_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_time
  ON ai_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_pgboss
  ON ai_jobs (pgboss_job_id)
  WHERE pgboss_job_id IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_ai_cache_tenant_mode
  ON ai_cache (tenant_id, ai_mode);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expiry
  ON ai_cache (expires_at)
  WHERE invalidated_at IS NULL;

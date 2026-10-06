-- AI subsystem runtime telemetry for ai_tool_calls (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_tool_calls_default PARTITION OF ai_tool_calls DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_org_time ON ai_tool_calls (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_environment_time ON ai_tool_calls (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_model_time ON ai_tool_calls (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_cache_key ON ai_tool_calls (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_metadata_gin ON ai_tool_calls USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_occurred_brin ON ai_tool_calls USING BRIN (occurred_at);

BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ai_requests',
    'ai_responses',
    'ai_jobs',
    'ai_cache',
    'ai_event_insights',
    'ai_evaluations',
    'ai_reports',
    'ai_usage_receipts',
    'ai_tool_calls',
    'ai_feedback'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        environment_id UUID,
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
        PRIMARY KEY (id, occurred_at)
      ) PARTITION BY RANGE (occurred_at)
    $sql$, table_name);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, occurred_at DESC)', 'idx_' || table_name || '_org_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (model, occurred_at DESC) WHERE model IS NOT NULL', 'idx_' || table_name || '_model_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL', 'idx_' || table_name || '_cache_key', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (metadata)', 'idx_' || table_name || '_metadata_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (occurred_at)', 'idx_' || table_name || '_occurred_brin', table_name);
  END LOOP;
END $$;

COMMIT;

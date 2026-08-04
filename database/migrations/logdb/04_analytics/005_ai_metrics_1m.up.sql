BEGIN;

SELECT analytics_engine_create_rollup('ai_metrics_1m', 'B');

ALTER TABLE ai_metrics_1m
  ADD COLUMN IF NOT EXISTS model             TEXT,
  ADD COLUMN IF NOT EXISTS request_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_hit_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_consumed  NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_micros       BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('ai_metrics_1m');

COMMIT;

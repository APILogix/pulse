-- Normalized final definition for ai_usage_logs_2026_07.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/012_ai_usage_logs.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ai_usage_logs_2026_07
PARTITION OF ai_usage_logs
FOR VALUES FROM (
  '2026-07-01'
) TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS brin_ai_usage_2026_07_time
ON ai_usage_logs_2026_07
USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS gin_ai_usage_2026_07_metadata
ON ai_usage_logs_2026_07
USING GIN (metadata);

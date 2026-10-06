-- Normalized final definition for usage_daily_counters_2026_07.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/011_usage_daily_counters.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS usage_daily_counters_2026_07
PARTITION OF usage_daily_counters
FOR VALUES FROM (
  '2026-07-01'
) TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS brin_udc_2026_07_date
ON usage_daily_counters_2026_07
USING BRIN (usage_date);

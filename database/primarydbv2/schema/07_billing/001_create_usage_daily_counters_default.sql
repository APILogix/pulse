-- Normalized final definition for usage_daily_counters_default.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/17_enterprise_ingestion/005_usage_counters_default_partition.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS usage_daily_counters_default
  PARTITION OF usage_daily_counters DEFAULT;

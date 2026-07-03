-- ============================================================================
-- 010_ingestion_create_usage_counters_schema.down.sql
-- ----------------------------------------------------------------------------
-- Rollback for 010_ingestion_create_usage_counters_schema.up.sql.
--
-- Drops the usage-counter view, flush function and both storage tiers. The
-- shared set_updated_at() trigger function is left in place (owned by 006).
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS project_usage_realtime;
DROP FUNCTION IF EXISTS flush_usage_counters();

DROP TRIGGER IF EXISTS trg_project_usage_updated_at ON project_usage;
DROP TABLE IF EXISTS project_usage;
DROP TABLE IF EXISTS usage_counter_staging;

COMMIT;


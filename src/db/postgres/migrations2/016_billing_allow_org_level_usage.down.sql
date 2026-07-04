-- ============================================================================
-- 016_billing_allow_org_level_usage.down.sql
-- ============================================================================

BEGIN;

DELETE FROM usage_daily_counters
WHERE project_id IS NULL;

DROP INDEX IF EXISTS uq_usage_daily_counters_scope;

ALTER TABLE usage_daily_counters
  ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE usage_daily_counters
  ADD CONSTRAINT uq_usage_daily_counters_scope UNIQUE (org_id, project_id, date);

COMMIT;

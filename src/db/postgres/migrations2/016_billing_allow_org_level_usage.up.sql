-- ============================================================================
-- 016_billing_allow_org_level_usage.up.sql
-- ----------------------------------------------------------------------------
-- Allow billing to create an org-level zero usage row at organization creation.
-- Project-scoped usage still uses project_id; org-level rollups use NULL.
-- ============================================================================

BEGIN;

ALTER TABLE usage_daily_counters
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE usage_daily_counters
  DROP CONSTRAINT IF EXISTS uq_usage_daily_counters_scope;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_daily_counters_scope
  ON usage_daily_counters (
    org_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    date
  );

COMMIT;

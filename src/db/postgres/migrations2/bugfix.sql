BEGIN;

-- 1. Allow project_id to be NULL for organization-level usage rollups
ALTER TABLE usage_daily_counters
  ALTER COLUMN project_id DROP NOT NULL;

-- 2. Drop the old basic constraint
ALTER TABLE usage_daily_counters
  DROP CONSTRAINT IF EXISTS uq_usage_daily_counters_scope;

-- 3. Create the new expression-based unique index that matches your backend query
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_daily_counters_scope
  ON usage_daily_counters (
    org_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    date
  );

COMMIT;

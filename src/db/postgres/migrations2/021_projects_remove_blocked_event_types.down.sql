-- ============================================================================
-- 021_projects_remove_blocked_event_types.down.sql
-- ----------------------------------------------------------------------------
-- Restores blocked_event_types columns if this migration is rolled back.
-- ============================================================================

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS blocked_event_types TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE project_environments
  ADD COLUMN IF NOT EXISTS blocked_event_types TEXT[] NOT NULL DEFAULT '{}';

COMMIT;

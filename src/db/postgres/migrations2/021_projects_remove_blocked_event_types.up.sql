-- ============================================================================
-- 021_projects_remove_blocked_event_types.up.sql
-- ----------------------------------------------------------------------------
-- Removes unused blocked_event_types configuration from project module tables.
-- The backend no longer reads or writes these columns.
-- ============================================================================

BEGIN;

ALTER TABLE projects
  DROP COLUMN IF EXISTS blocked_event_types;

ALTER TABLE project_environments
  DROP COLUMN IF EXISTS blocked_event_types;

COMMIT;

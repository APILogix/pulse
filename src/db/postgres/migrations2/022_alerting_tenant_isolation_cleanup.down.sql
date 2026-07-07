-- ============================================================================
-- 022_alerting_tenant_isolation_cleanup.down.sql
-- ----------------------------------------------------------------------------
-- Reverts backfills and drops the composite foreign key for project member 
-- alert preferences.
-- ============================================================================

BEGIN;

-- 6. Recreate dead code table `project_alert_routes` if it didn't exist? 
-- We'll just leave it dropped or recreate an empty version if strictly needed.
-- But standard practice for dropping unused tables is to recreate it.
CREATE TABLE IF NOT EXISTS project_alert_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES notification_routes(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_alert_routes_project ON project_alert_routes(project_id);
CREATE INDEX IF NOT EXISTS idx_project_alert_routes_route ON project_alert_routes(route_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_alert_routes_unique ON project_alert_routes(project_id, route_id);

-- 5. Drop composite foreign key and restore original FKs
ALTER TABLE project_member_alert_preferences
  DROP CONSTRAINT IF EXISTS fk_project_member_alert_preferences_project_member;

ALTER TABLE project_member_alert_preferences
  ADD CONSTRAINT project_member_alert_preferences_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE project_member_alert_preferences
  ADD CONSTRAINT project_member_alert_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- We don't "un-backfill" project_id values because they represent actual data 
-- fixes that are safe to leave.

COMMIT;

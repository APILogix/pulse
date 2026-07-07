BEGIN;

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS recipients JSONB;

CREATE INDEX IF NOT EXISTS idx_deliveries_project_created
  ON notification_deliveries(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dead_letter_project_created
  ON notification_dead_letter(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_routes_org_project_active
  ON notification_routes(organization_id, project_id, priority DESC)
  WHERE deleted_at IS NULL AND is_active = TRUE AND project_id IS NOT NULL;

COMMIT;

BEGIN;

DROP INDEX IF EXISTS idx_routes_org_project_active;
DROP INDEX IF EXISTS idx_dead_letter_project_created;
DROP INDEX IF EXISTS idx_deliveries_project_created;

ALTER TABLE notification_deliveries
  DROP COLUMN IF EXISTS recipients;

COMMIT;

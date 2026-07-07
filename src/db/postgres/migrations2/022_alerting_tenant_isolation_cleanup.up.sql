-- ============================================================================
-- 022_alerting_tenant_isolation_cleanup.up.sql  (FINAL — based on actual schema)
-- ============================================================================
-- Schema reality:
--   - connector_configs: org-scoped (organization_id), NO project_id
--   - notification_routes: project-scoped (project_id nullable), target_connector_ids ARRAY
--   - notification_deliveries: project_id nullable, route_id nullable, connector_id NOT NULL
--   - connector_audit_logs: project_id nullable, connector_id nullable, NO route_id
--   - notification_dead_letter: project_id nullable, original_delivery_id NOT NULL
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Backfill notification_routes.project_id from deliveries
-- ============================================================================
-- Routes created after migration have project_id set.
-- Routes created before have NULL. Infer from deliveries referencing that route.
-- Use MODE() to find the most common project_id per route.

WITH route_project_inference AS (
  SELECT 
    nd.route_id,
    MODE() WITHIN GROUP (ORDER BY nd.project_id) AS inferred_project_id
  FROM notification_deliveries nd
  WHERE nd.route_id IS NOT NULL
    AND nd.project_id IS NOT NULL
  GROUP BY nd.route_id
)
UPDATE notification_routes nr
SET project_id = rpi.inferred_project_id
FROM route_project_inference rpi
WHERE rpi.route_id = nr.id
  AND nr.project_id IS NULL;

-- ============================================================================
-- STEP 2: Backfill notification_deliveries.project_id from routes
-- ============================================================================
-- Now that routes have project_id (from Step 1), copy to their deliveries.

UPDATE notification_deliveries nd
SET project_id = nr.project_id
FROM notification_routes nr
WHERE nr.id = nd.route_id
  AND nd.project_id IS NULL
  AND nr.project_id IS NOT NULL;

-- ============================================================================
-- STEP 3: Backfill notification_dead_letter.project_id from original delivery
-- ============================================================================
-- Dead letter references the original delivery via original_delivery_id.

UPDATE notification_dead_letter ndl
SET project_id = nd.project_id
FROM notification_deliveries nd
WHERE nd.id = ndl.original_delivery_id
  AND ndl.project_id IS NULL
  AND nd.project_id IS NOT NULL;

-- ============================================================================
-- STEP 4: connector_audit_logs — CANNOT safely backfill
-- ============================================================================
-- connector_audit_logs tracks org-level connector config changes.
-- It has NO route_id. connector_configs has NO project_id.
-- Therefore, there is NO automatic way to determine project_id.
-- 
-- OPTIONS (pick one):
--   A) Leave NULL — audit logs remain org-scoped (RECOMMENDED)
--   B) Extract from JSONB — if previous_state/new_state contains project_id
--   C) Delete old records — if they have no project context
--
-- Option A (default): Do nothing. project_id stays NULL for historical records.
-- Option B (uncomment if you store project_id in JSONB):
/*
UPDATE connector_audit_logs cal
SET project_id = COALESCE(
  (cal.previous_state->>'project_id')::uuid,
  (cal.new_state->>'project_id')::uuid
)
WHERE cal.project_id IS NULL
  AND (cal.previous_state ? 'project_id' OR cal.new_state ? 'project_id');
*/

-- ============================================================================
-- STEP 5: Report remaining unbackfilled records
-- ============================================================================
DO $$
DECLARE
  v_routes_null INTEGER;
  v_deliveries_null INTEGER;
  v_deadletter_null INTEGER;
  v_audit_null INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_routes_null 
  FROM notification_routes WHERE project_id IS NULL;
  
  SELECT COUNT(*) INTO v_deliveries_null 
  FROM notification_deliveries WHERE project_id IS NULL;
  
  SELECT COUNT(*) INTO v_deadletter_null 
  FROM notification_dead_letter WHERE project_id IS NULL;
  
  SELECT COUNT(*) INTO v_audit_null 
  FROM connector_audit_logs WHERE project_id IS NULL;
  
  RAISE NOTICE 'UNBACKFILLED RECORDS: routes=%, deliveries=%, dead_letter=%, audit_logs=%',
    v_routes_null, v_deliveries_null, v_deadletter_null, v_audit_null;
END $$;

-- ============================================================================
-- STEP 6: Clean up orphaned routes with no project_id and no deliveries
-- ============================================================================
-- Routes that couldn't be backfilled and have no delivery history are safe to delete.

DELETE FROM notification_routes
WHERE project_id IS NULL
  AND id NOT IN (
    SELECT DISTINCT route_id 
    FROM notification_deliveries 
    WHERE route_id IS NOT NULL
  );

-- ============================================================================
-- STEP 7: Add composite foreign key for project_member_alert_preferences
-- ============================================================================
ALTER TABLE project_member_alert_preferences
  DROP CONSTRAINT IF EXISTS project_member_alert_preferences_project_id_fkey,
  DROP CONSTRAINT IF EXISTS project_member_alert_preferences_user_id_fkey;

-- Ensure unique constraint on project_members(project_id, user_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_project_members_project_user_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_project_members_project_user_unique 
    ON project_members(project_id, user_id);
  END IF;
END $$;

ALTER TABLE project_member_alert_preferences
  ADD CONSTRAINT fk_project_member_alert_preferences_project_member
  FOREIGN KEY (project_id, user_id)
  REFERENCES project_members(project_id, user_id)
  ON DELETE CASCADE;

-- ============================================================================
-- STEP 8: Drop dead code table
-- ============================================================================
DROP TABLE IF EXISTS project_alert_routes CASCADE;

COMMIT;
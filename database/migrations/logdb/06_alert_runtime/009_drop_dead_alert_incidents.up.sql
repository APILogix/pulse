-- ============================================================================
-- 009_drop_dead_alert_incidents (Log DB)
--
-- PURPOSE
--   Remove the dead `alert_incidents` table (and its FK child
--   `alert_correlation_groups`) from the LOG DB. Incidents are now owned by the
--   PRIMARY database (`09_alerting/001_create_alert_incidents.sql`).
--
-- WHY THIS MATTERS (it is not just tidiness)
--   1. NAME AMBIGUITY IS A LIVE HAZARD. `IncidentsRepository` issues unqualified
--      `alert_incidents` SQL and is constructed with the PRIMARY pool. If any
--      future caller passes the Log DB pool instead, the queries would silently
--      resolve against THIS table - which has no project_id, no status enum, and
--      no partial unique index - producing column errors at best and wrong
--      tenant-scoped results at worst. Deleting the table makes that
--      misconfiguration fail loudly and immediately.
--   2. The Log DB copy is structurally WRONG for incidents:
--        - no `project_id`, so incidents cannot be project-scoped or filtered;
--        - `UNIQUE (organization_id, fingerprint)` is FULL, not partial, so once
--          an incident resolves a second one can NEVER open for that fingerprint.
--          Recurrence is impossible by construction.
--   3. Log DB runtime tables are range-partitioned for retention pruning
--      (00_shared/001_foundation.up.sql). Incident lifecycle must OUTLIVE
--      telemetry retention, so this is the wrong database for it.
--
-- SAFETY
--   Verified before writing this migration: ZERO TypeScript references to
--   `alert_incidents` resolve to the Log DB (all are IncidentsRepository on the
--   primary pool), and ZERO references of any kind to
--   `alert_correlation_groups`. Both are dead schema.
--
--   This migration nonetheless REFUSES TO DESTROY DATA SILENTLY: if either table
--   contains rows it raises and rolls back, so an operator must consciously
--   decide what to do. See the override note below.
--
-- ORDER
--   alert_correlation_groups is dropped first - it holds the FK to
--   alert_incidents.
-- ============================================================================

BEGIN;

-- ── Guard: refuse to drop non-empty tables ──────────────────────────────────
-- If this raises, the tables are NOT dead in your environment. Investigate
-- before proceeding. To override deliberately (accepting data loss), comment out
-- this DO block and re-run.
DO $$
DECLARE
  incident_rows   bigint := 0;
  correlation_rows bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'alert_incidents') THEN
    EXECUTE 'SELECT COUNT(*) FROM alert_incidents' INTO incident_rows;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'alert_correlation_groups') THEN
    EXECUTE 'SELECT COUNT(*) FROM alert_correlation_groups' INTO correlation_rows;
  END IF;

  IF incident_rows > 0 OR correlation_rows > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop non-empty Log DB tables: alert_incidents=% row(s), alert_correlation_groups=% row(s). These were expected to be dead schema. Export or migrate the data to the primary-database alert_incidents table first, then re-run with the guard removed.',
      incident_rows, correlation_rows;
  END IF;

  RAISE NOTICE 'Log DB alert_incidents / alert_correlation_groups confirmed empty - safe to drop.';
END $$;

-- ── Drop, FK child first ────────────────────────────────────────────────────
DROP TABLE IF EXISTS alert_correlation_groups;
DROP TABLE IF EXISTS alert_incidents;

-- Record the decision so the reason survives in the database itself
-- (same mechanism as 00_shared/001_foundation.up.sql).
INSERT INTO logdb_schema_notes (subject, decision)
VALUES (
  'alert_incident_ownership',
  'Incidents are owned by the PRIMARY database (alert_incidents + alert_incident_events). The Log DB copy was dropped in 009: it lacked project_id, used a FULL unique constraint that made recurrence impossible, and sat in a range-partitioned/retention-pruned schema unsuitable for durable lifecycle state. The Log DB retains only telemetry, alert event facts, runtime state, notification jobs, and delivery attempts.'
)
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;

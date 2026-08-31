-- =============================================================================
-- Drop the misplaced automation runtime tables from the LOG database.
--
-- WHY:
--   001_automation_runtime.up.sql created automation_runs, automation_run_steps,
--   automation_events_inbox and automation_audit_logs in the LOG database from a
--   generic 16-column template (id, organization_id, project_id, workflow_id,
--   run_id, step_id, actor_user_id, status, event_type, dedupe_key, input, output,
--   error_message, started_at, completed_at, updated_at).
--
--   That was wrong on two counts:
--     1. WRONG DATABASE. AutomationRepository is constructed with the PRIMARY pool
--        (src/modules/automation/automation.module.ts), and claimNextStep() JOINs
--        automation_run_steps -> automation_runs -> automation_workflows ->
--        automation_actions. The control-plane tables live in PRIMARY, so a
--        cross-database join is impossible.
--     2. WRONG SHAPE. The generic columns bear almost no relation to what
--        repository.ts/audit.ts actually read and write (source_module, payload,
--        headers, received_at, locked_by, attempts, next_retry_at, sort_order,
--        timeout_at, idempotency_key, occurred_at, ...).
--
--   The correctly-shaped tables now exist in the PRIMARY database via
--   src/db/postgres/primary_db_draft/14_automation/002_create_automation_runtime.sql.
--   Leaving these Log DB stubs in place would keep two competing, contradictory
--   definitions of the same four tables in the repository.
--
-- SAFETY (verified with scripts/audit-logdb-automation-deps.cjs before writing):
--   - all four Log DB tables contained 0 rows (no data loss)
--   - no inbound foreign keys reference them
--   - no views or materialized views depend on them
--   - only the default partitions were attached
--   - no application code queries them through the Log DB pool: the only three
--     files referencing these table names (repository.ts, audit.ts, workers.ts)
--     all execute against the PRIMARY pool
--
-- CASCADE is required only to remove the attached *_default partitions that
-- 001 created; it is not masking any unexpected dependency (verified above).
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS automation_audit_logs CASCADE;
DROP TABLE IF EXISTS automation_run_steps CASCADE;
DROP TABLE IF EXISTS automation_events_inbox CASCADE;
DROP TABLE IF EXISTS automation_runs CASCADE;

COMMIT;

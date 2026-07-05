-- ============================================================================
-- 009_ingestion_create_queue_schema.down.sql
-- ----------------------------------------------------------------------------
-- Rollback for 009_ingestion_create_queue_schema.up.sql.
--
-- WARNING: this drops the live ingestion work queue and its dead-letter +
-- admin-log sinks. Only run on a fresh/empty environment or after the queue
-- has been fully drained. Any in-flight or pending jobs are lost.
--
-- We drop only the objects this migration is authoritative for. The shared
-- set_updated_at() trigger function is left in place (owned by migration 006).
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS ingestion_queue_snapshot;

-- Admin logs (drop default partition first, then the partitioned parent).
DROP TABLE IF EXISTS ingestion_admin_logs_default;
DROP TABLE IF EXISTS ingestion_admin_logs;

DROP TABLE IF EXISTS ingestion_dead_letter_jobs;

DROP TRIGGER IF EXISTS trg_ingestion_jobs_updated_at ON ingestion_jobs;
DROP TABLE IF EXISTS ingestion_jobs;

DROP TYPE IF EXISTS ingestion_job_priority;
DROP TYPE IF EXISTS ingestion_job_state;

COMMIT;


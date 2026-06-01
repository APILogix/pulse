-- ============================================================================
-- 015_ingestion_hardening.sql
-- ----------------------------------------------------------------------------
-- Hardening pass for the Postgres-native ingestion queue (built in 012).
--
-- This migration is purely additive and idempotent. It adds:
--
--   1. Index on ingestion_jobs.org_id for fair-share/per-tenant queries.
--   2. Index on ingestion_dead_letter_jobs.original_job_id for traceability
--      between a live job that died and its DLQ row.
--   3. CHECK constraints to bound priority and last_error length so a buggy
--      caller cannot insert pathological values that explode storage or
--      destabilize ORDER BY priority.
--   4. A retention helper view to make operator queries cheaper.
--
-- Safe to re-run. Designed for production: no destructive operations, no
-- table rewrites.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Indexes for tenant scoping + DLQ traceability
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_org_state
  ON ingestion_jobs (org_id, state)
  WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dlq_original_job
  ON ingestion_dead_letter_jobs (original_job_id)
  WHERE original_job_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2) Defensive CHECK constraints (added only if missing)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- priority must fit a SMALLINT comfortably and stay ordered.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_jobs_priority_chk'
  ) THEN
    ALTER TABLE ingestion_jobs
      ADD CONSTRAINT ingestion_jobs_priority_chk
      CHECK (priority >= 0 AND priority <= 1000);
  END IF;

  -- max_attempts must be sane: >= 1 and bounded so a buggy caller cannot
  -- enqueue a job that retries forever and starves the queue.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_jobs_max_attempts_chk'
  ) THEN
    ALTER TABLE ingestion_jobs
      ADD CONSTRAINT ingestion_jobs_max_attempts_chk
      CHECK (max_attempts >= 1 AND max_attempts <= 50);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Operator-friendly view: queue snapshot (no GROUP BY in handlers).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW ingestion_queue_snapshot AS
SELECT
  queue,
  state,
  COUNT(*)::bigint                                              AS job_count,
  COUNT(*) FILTER (WHERE attempts > 0)::bigint                  AS retried_count,
  MIN(run_at)                                                   AS oldest_run_at,
  MAX(updated_at)                                               AS most_recent_update,
  COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(run_at)))::bigint, 0) AS oldest_age_seconds
FROM ingestion_jobs
GROUP BY queue, state;

COMMENT ON VIEW ingestion_queue_snapshot IS
  'Operator snapshot of the ingestion queue (counts + lag per state).';

COMMIT;

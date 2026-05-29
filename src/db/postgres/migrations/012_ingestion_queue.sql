-- ============================================================================
-- 012_ingestion_queue.sql
-- ----------------------------------------------------------------------------
-- PostgreSQL-native job queue for the ingestion pipeline (pg-boss style).
--
-- Replaces the BullMQ/Redis queue with a transactional, FOR UPDATE SKIP LOCKED
-- work queue. This gives us:
--   * exactly-one-worker claiming under concurrency (SKIP LOCKED)
--   * at-least-once delivery with a visibility timeout (locked_until)
--   * exponential backoff retries (attempts + run_at)
--   * priority + delayed jobs
--   * dead-letter handling
--   * job dedup (dedupe_key)
--   * worker heartbeats + stuck-job recovery
--   * tenant-aware queueing (org_id / project_id) for fair-share + isolation
--
-- Multi-tenant safe: every job row carries org_id + project_id.
-- Designed for high throughput: the claim path hits one partial index.
--
-- Idempotent. Safe to run repeatedly.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) ENUM: job state
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE ingestion_job_state AS ENUM (
    'pending',     -- ready/claimable when run_at <= now()
    'active',      -- claimed by a worker (locked_until in the future)
    'completed',   -- done (kept briefly for metrics, then pruned)
    'failed',      -- terminal failure moved to dead-letter
    'cancelled'    -- administratively cancelled
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2) INGESTION_JOBS — the live work queue
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Routing / classification
    queue        VARCHAR(64)  NOT NULL DEFAULT 'ingestion',
    job_type     VARCHAR(64)  NOT NULL,            -- e.g. 'request','error','log','metric','trace','span'
    priority     SMALLINT     NOT NULL DEFAULT 100, -- LOWER number = HIGHER priority

    -- Tenancy (multi-tenant isolation + fair scheduling)
    org_id       UUID,
    project_id   UUID,

    -- Payload (the EnrichedEvent or batch envelope). JSONB, never trusted blindly.
    payload      JSONB        NOT NULL,

    -- Idempotency. A unique partial index on this prevents duplicate enqueues
    -- of the same logical unit (e.g. the SDK event id) while it is in flight.
    dedupe_key   VARCHAR(200),

    -- State machine
    state        ingestion_job_state NOT NULL DEFAULT 'pending',

    -- Scheduling + retry
    run_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(), -- delayed jobs set this in the future
    attempts     SMALLINT     NOT NULL DEFAULT 0,
    max_attempts SMALLINT     NOT NULL DEFAULT 5,

    -- Visibility timeout: while active, locked_until is the lease expiry. A
    -- recovery sweep returns jobs whose lease expired (crashed worker) to
    -- 'pending'. This is the at-least-once delivery guarantee.
    locked_until TIMESTAMPTZ,
    locked_by    VARCHAR(128),         -- worker id holding the lease
    heartbeat_at TIMESTAMPTZ,          -- last heartbeat from the holding worker

    -- Diagnostics
    last_error   TEXT,

    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    CONSTRAINT ingestion_jobs_attempts_chk CHECK (attempts >= 0 AND attempts <= max_attempts + 1)
);

-- THE claim index. The worker query is:
--   WHERE queue = $1 AND state = 'pending' AND run_at <= now()
--   ORDER BY priority ASC, run_at ASC
--   FOR UPDATE SKIP LOCKED
-- A partial index on claimable rows keeps that scan tiny even with millions of
-- completed/active rows present.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim
  ON ingestion_jobs (queue, priority, run_at)
  WHERE state = 'pending';

-- Recovery sweep index: find active jobs whose lease expired.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_lease
  ON ingestion_jobs (locked_until)
  WHERE state = 'active';

-- Dedup: at most one in-flight (pending/active) job per dedupe_key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_dedupe
  ON ingestion_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state IN ('pending', 'active');

-- Tenant observability / fair-share queries.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_project
  ON ingestion_jobs (project_id, state) WHERE project_id IS NOT NULL;

-- Pruning of terminal rows.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_completed
  ON ingestion_jobs (completed_at) WHERE state = 'completed';

-- ----------------------------------------------------------------------------
-- 3) INGESTION_DEAD_LETTER_JOBS — terminal failures, retained for inspection/replay
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_dead_letter_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_job_id UUID,
    queue        VARCHAR(64)  NOT NULL,
    job_type     VARCHAR(64)  NOT NULL,
    org_id       UUID,
    project_id   UUID,
    payload      JSONB        NOT NULL,
    dedupe_key   VARCHAR(200),
    attempts     SMALLINT     NOT NULL,
    last_error   TEXT,
    failed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Set when an operator requeues this DLQ row back onto the live queue.
    replayed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dlq_queue_time
  ON ingestion_dead_letter_jobs (queue, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_project
  ON ingestion_dead_letter_jobs (project_id, failed_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dlq_unreplayed
  ON ingestion_dead_letter_jobs (failed_at) WHERE replayed_at IS NULL;

-- ----------------------------------------------------------------------------
-- 4) Trigger: keep updated_at fresh on ingestion_jobs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ingestion_jobs_updated_at ON ingestion_jobs;
CREATE TRIGGER trg_ingestion_jobs_updated_at
  BEFORE UPDATE ON ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE ingestion_jobs IS
  'PostgreSQL-native ingestion work queue (pg-boss style, FOR UPDATE SKIP LOCKED).';
COMMENT ON TABLE ingestion_dead_letter_jobs IS
  'Terminal ingestion job failures retained for inspection and replay.';

COMMIT;

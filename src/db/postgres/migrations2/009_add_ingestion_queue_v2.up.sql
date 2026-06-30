-- ============================================================================
-- 009_add_ingestion_queue_v2.up.sql
-- ----------------------------------------------------------------------------
-- Canonical, idempotent, safe-to-run-on-fresh-DB snapshot of the INGESTION
-- QUEUE schema, upgraded to enterprise grade ("v2").
--
-- Why this file exists:
--   * The legacy ingestion queue DDL lived OUTSIDE the migrations2 lineage
--     (migrations/012_ingestion_queue.sql + migrations/015_ingestion_hardening.sql).
--     This migration brings the queue under the migrations2 lineage and ADDS
--     the enterprise tracking columns, the generated priority label, the
--     hardened dead-letter table, the partitioned admin-log sink and the
--     operator snapshot view that the v2 worker tier depends on.
--
-- What it adds on top of the legacy shape (migrations/012 + 015):
--   * ingestion_jobs            — correlation columns (event_id, trace_id,
--                                 span_id, session_id, user_id, tenant_id),
--                                 generated priority_label, error_code,
--                                 processed_by, processing_duration_ms.
--   * ingestion_dead_letter_jobs— error_code, max_attempts, replayed_by,
--                                 created_at (full lifecycle parity).
--   * ingestion_admin_logs      — NEW. Partitioned (monthly RANGE) admin/audit
--                                 log sink written by the worker tier's
--                                 AdminLogger for immediate operator queries.
--   * ingestion_queue_snapshot  — richer per (queue, job_type, state,
--                                 priority_label) operator view.
--
-- Conventions match migrations2/006/007/008:
--   * Enums guarded with DO / IF NOT EXISTS so re-runs are no-ops.
--   * CREATE TABLE IF NOT EXISTS + additive ALTER ... ADD COLUMN IF NOT EXISTS
--     so running this AFTER the legacy migrations/012+015 only UPGRADES columns
--     and is a no-op on a fresh DB run from the migrations2 lineage.
--   * The live ingestion_jobs table is intentionally NOT range-partitioned:
--     it is a short-lived work queue (rows are pruned minutes after
--     completion), so partitioning adds planning overhead without retention
--     benefit. Long-lived telemetry tables ARE partitioned (migrations/013-014).
--   * RLS intentionally disabled (tenant isolation enforced in the service
--     layer; every row carries org_id + project_id).
--
-- Depends on: nothing in this lineage (queue is self-contained). org_id /
-- project_id are stored denormalized and are NOT foreign keys so the hot
-- enqueue path never pays a referential-integrity check.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 0) Shared updated_at trigger (reused from migration 006/008).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1) ENUM types (idempotent)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_job_state') THEN
    CREATE TYPE ingestion_job_state AS ENUM (
      'pending',     -- ready/claimable when run_at <= now()
      'active',      -- claimed by a worker (locked_until in the future)
      'completed',   -- done (kept briefly for metrics, then pruned)
      'failed',      -- terminal failure moved to dead-letter
      'cancelled'    -- administratively cancelled
    );
  END IF;

  -- Human-readable priority bucket, derived from the numeric priority.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_job_priority') THEN
    CREATE TYPE ingestion_job_priority AS ENUM (
      'critical','high','normal','low','background'
    );
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- 2) INGESTION_JOBS — the live work queue (v2)
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Routing / classification.
    queue        VARCHAR(64)  NOT NULL DEFAULT 'ingestion',
    job_type     VARCHAR(64)  NOT NULL CHECK (job_type IN (
                   'error','message','request','span','trace',
                   'metric','log','profile','cron_checkin','replay')),
    priority     SMALLINT     NOT NULL DEFAULT 100
                   CHECK (priority >= 0 AND priority <= 1000), -- LOWER = HIGHER

    -- Human-readable bucket derived from the numeric priority. Workers/operators
    -- can filter on this without memorizing the numeric thresholds.
    priority_label ingestion_job_priority GENERATED ALWAYS AS (
        CASE
            WHEN priority <= 10 THEN 'critical'::ingestion_job_priority
            WHEN priority <= 50 THEN 'high'::ingestion_job_priority
            WHEN priority <= 80 THEN 'normal'::ingestion_job_priority
            WHEN priority <= 95 THEN 'low'::ingestion_job_priority
            ELSE 'background'::ingestion_job_priority
        END
    ) STORED,

    -- Tenancy (multi-tenant isolation + fair scheduling). Denormalized, not FK.
    org_id       UUID,
    project_id   UUID,

    -- Payload (the normalized, tenant-scoped event envelope). JSONB.
    payload      JSONB        NOT NULL,

    -- Correlation columns (lifted out of the payload for indexed lookups and
    -- operator debugging without a JSONB scan).
    event_id     VARCHAR(64),
    trace_id     VARCHAR(64),
    span_id      VARCHAR(64),
    session_id   VARCHAR(64),
    user_id      VARCHAR(64),
    tenant_id    VARCHAR(64),

    -- Idempotency. The partial unique index below prevents duplicate enqueues
    -- of the same logical unit while it is in flight.
    dedupe_key   VARCHAR(256),

    -- State machine.
    state        ingestion_job_state NOT NULL DEFAULT 'pending',

    -- Scheduling + retry.
    run_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    attempts     SMALLINT     NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 50),
    max_attempts SMALLINT     NOT NULL DEFAULT 3 CHECK (max_attempts >= 1 AND max_attempts <= 50),

    -- Visibility timeout / lease.
    locked_until TIMESTAMPTZ,
    locked_by    VARCHAR(128),
    heartbeat_at TIMESTAMPTZ,

    -- Diagnostics + processing accounting.
    last_error            TEXT,
    error_code            VARCHAR(64),
    processed_by          VARCHAR(128),
    processing_duration_ms INTEGER CHECK (processing_duration_ms IS NULL OR processing_duration_ms >= 0),

    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Additive upgrades for databases that already created `ingestion_jobs` via the
-- legacy migrations/012_ingestion_queue.sql (which lacked the v2 columns).
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS event_id VARCHAR(64);
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS trace_id VARCHAR(64);
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS span_id VARCHAR(64);
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS session_id VARCHAR(64);
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64);
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS error_code VARCHAR(64);
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS processed_by VARCHAR(128);
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS processing_duration_ms INTEGER;

-- The legacy dedupe_key was VARCHAR(200); widen to 256 to match v2.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_jobs' AND column_name = 'dedupe_key'
      AND character_maximum_length = 200
  ) THEN
    ALTER TABLE ingestion_jobs ALTER COLUMN dedupe_key TYPE VARCHAR(256);
  END IF;
END $$;

-- priority_label is a generated column; add it only if missing (e.g. on top of
-- the legacy table). ADD COLUMN ... GENERATED is supported on PG12+.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_jobs' AND column_name = 'priority_label'
  ) THEN
    ALTER TABLE ingestion_jobs ADD COLUMN priority_label ingestion_job_priority
      GENERATED ALWAYS AS (
        CASE
            WHEN priority <= 10 THEN 'critical'::ingestion_job_priority
            WHEN priority <= 50 THEN 'high'::ingestion_job_priority
            WHEN priority <= 80 THEN 'normal'::ingestion_job_priority
            WHEN priority <= 95 THEN 'low'::ingestion_job_priority
            ELSE 'background'::ingestion_job_priority
        END
      ) STORED;
  END IF;
END $$;

-- THE claim index. Worker query: WHERE queue=$1 AND state='pending' AND run_at<=now()
-- ORDER BY priority ASC, run_at ASC FOR UPDATE SKIP LOCKED.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim
  ON ingestion_jobs (queue, priority ASC, run_at ASC, created_at ASC)
  WHERE state = 'pending';

-- Job-type-scoped claim (general vs specialized worker isolation).
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim_typed
  ON ingestion_jobs (queue, job_type, priority ASC, run_at ASC)
  WHERE state = 'pending';

-- Recovery sweep: active jobs whose lease expired.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_lease
  ON ingestion_jobs (locked_until, state)
  WHERE state = 'active';

-- Dedup: at most one in-flight (pending/active) job per dedupe_key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_dedupe
  ON ingestion_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state IN ('pending','active');

-- Tenant observability / fair-share.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_project
  ON ingestion_jobs (project_id, state, priority) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_org_state
  ON ingestion_jobs (org_id, state) WHERE org_id IS NOT NULL;

-- Correlation lookups for operator debugging.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_event_id
  ON ingestion_jobs (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_trace_id
  ON ingestion_jobs (trace_id) WHERE trace_id IS NOT NULL;

-- Pruning of terminal rows.
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_completed
  ON ingestion_jobs (completed_at) WHERE state = 'completed';

DROP TRIGGER IF EXISTS trg_ingestion_jobs_updated_at ON ingestion_jobs;
CREATE TRIGGER trg_ingestion_jobs_updated_at
  BEFORE UPDATE ON ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE ingestion_jobs IS
  'PostgreSQL-native ingestion work queue v2 (FOR UPDATE SKIP LOCKED). Short-lived rows pruned after completion; correlation columns lifted out of payload for indexed lookups.';

COMMIT;

-- ============================================================================
-- 3) INGESTION_DEAD_LETTER_JOBS — terminal failures (v2)
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_dead_letter_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_job_id UUID,
    queue        VARCHAR(64)  NOT NULL,
    job_type     VARCHAR(64)  NOT NULL,
    org_id       UUID,
    project_id   UUID,
    payload      JSONB        NOT NULL,
    dedupe_key   VARCHAR(256),
    attempts     SMALLINT     NOT NULL,
    max_attempts SMALLINT     NOT NULL DEFAULT 3,
    last_error   TEXT         NOT NULL,
    error_code   VARCHAR(64),
    failed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    replayed_at  TIMESTAMPTZ,
    replayed_by  VARCHAR(128),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Additive upgrades for databases that already created the legacy DLQ table.
ALTER TABLE ingestion_dead_letter_jobs ADD COLUMN IF NOT EXISTS max_attempts SMALLINT NOT NULL DEFAULT 3;
ALTER TABLE ingestion_dead_letter_jobs ADD COLUMN IF NOT EXISTS error_code VARCHAR(64);
ALTER TABLE ingestion_dead_letter_jobs ADD COLUMN IF NOT EXISTS replayed_by VARCHAR(128);
ALTER TABLE ingestion_dead_letter_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ingestion_dead_letter_jobs' AND column_name = 'dedupe_key'
      AND character_maximum_length = 200
  ) THEN
    ALTER TABLE ingestion_dead_letter_jobs ALTER COLUMN dedupe_key TYPE VARCHAR(256);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dlq_queue_time
  ON ingestion_dead_letter_jobs (queue, failed_at);
CREATE INDEX IF NOT EXISTS idx_dlq_project
  ON ingestion_dead_letter_jobs (project_id, failed_at) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dlq_unreplayed
  ON ingestion_dead_letter_jobs (failed_at) WHERE replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dlq_original_job
  ON ingestion_dead_letter_jobs (original_job_id) WHERE original_job_id IS NOT NULL;

COMMENT ON TABLE ingestion_dead_letter_jobs IS
  'Terminal ingestion job failures retained for inspection and replay (v2: error_code + replay actor).';

COMMIT;

-- ============================================================================
-- 4) INGESTION_ADMIN_LOGS — partitioned admin/audit log sink (NEW)
-- ----------------------------------------------------------------------------
-- Written by the worker tier's AdminLogger for IMMEDIATE operator queries
-- (the TimescaleDB hypertable is the long-term analytics copy). Partitioned by
-- created_at (monthly RANGE) so retention is an O(1) partition DROP.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_admin_logs (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    log_level   VARCHAR(16) NOT NULL CHECK (log_level IN ('debug','info','warn','error','fatal')),
    category    VARCHAR(64) NOT NULL,
    message     TEXT NOT NULL,
    org_id      UUID,
    project_id  UUID,
    job_id      UUID,
    event_id    VARCHAR(64),
    worker_id   VARCHAR(128),
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS ingestion_admin_logs_default
  PARTITION OF ingestion_admin_logs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_admin_logs_created
  ON ingestion_admin_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_category
  ON ingestion_admin_logs (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_project
  ON ingestion_admin_logs (project_id, created_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_logs_level
  ON ingestion_admin_logs (log_level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_metadata
  ON ingestion_admin_logs USING GIN (metadata);

COMMENT ON TABLE ingestion_admin_logs IS
  'Partitioned admin/audit log sink for the ingestion worker tier. Immediate-query copy; long-term analytics live in the TimescaleDB admin_audit_log hypertable.';

COMMIT;

-- ============================================================================
-- 5) INGESTION_QUEUE_SNAPSHOT — richer operator view (v2)
-- ============================================================================
BEGIN;

-- The legacy view (migrations/015) has a different column set; CREATE OR
-- REPLACE cannot change existing column names/order, so drop first.
DROP VIEW IF EXISTS ingestion_queue_snapshot;

CREATE OR REPLACE VIEW ingestion_queue_snapshot AS
SELECT
  queue,
  job_type,
  state,
  priority_label,
  COUNT(*)::bigint                                              AS job_count,
  COUNT(*) FILTER (WHERE attempts > 0)::bigint                  AS retried_count,
  COALESCE(MIN(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS oldest_age_seconds,
  COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS newest_age_seconds,
  COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS avg_age_seconds
FROM ingestion_jobs
GROUP BY queue, job_type, state, priority_label;

COMMENT ON VIEW ingestion_queue_snapshot IS
  'Operator snapshot of the ingestion queue v2 (counts + lag per queue/type/state/priority bucket).';

COMMIT;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (INTENTIONALLY DISABLED)
-- ----------------------------------------------------------------------------
-- Tenant isolation is enforced in the service/worker layer: every job row
-- carries org_id + project_id, and those values come from the authenticated
-- API key, never the payload. This codebase never sets app.current_org_id, so
-- enabling RLS here would filter every claim to zero rows.

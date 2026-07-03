-- ============================================================================
-- 010_ingestion_create_usage_counters_schema.up.sql
-- ----------------------------------------------------------------------------
-- Three-tier usage counter storage for the ingestion pipeline (NEW).
--
-- Architecture (see modules/ingestion/usage/usage-counter.ts):
--   Tier 1: in-memory Map per worker process (fastest, lossy on crash).
--   Tier 2: usage_counter_staging â€” UNLOGGED table. No WAL, so bulk inserts
--           are extremely cheap; the trade-off is the staging rows are lost on
--           an unclean crash (acceptable: counters are approximate billing
--           pre-aggregation, not the durable telemetry itself).
--   Tier 3: project_usage â€” durable, logged, hourly-bucketed rollups. This is
--           the source of truth read by the usage/billing endpoints.
--
-- A SQL function flush_usage_counters() aggregates staging rows into hourly
-- buckets and UPSERTs them into project_usage, then deletes the consumed
-- staging rows. The realtime view sums durable buckets + un-flushed staging so
-- reads never miss the last few seconds of activity.
--
-- Conventions match migrations2/006/007/008: idempotent, additive, RLS off.
-- Depends on: nothing (org_id/project_id stored denormalized, not FKs, so the
-- hot increment path never pays a referential-integrity check).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1) TIER 2 â€” UNLOGGED staging table (fast writes, no WAL).
-- ----------------------------------------------------------------------------
CREATE UNLOGGED TABLE IF NOT EXISTS usage_counter_staging (
    id           BIGSERIAL PRIMARY KEY,
    project_id   UUID NOT NULL,
    org_id       UUID NOT NULL,
    counter_type VARCHAR(64) NOT NULL,
    increment_by BIGINT NOT NULL DEFAULT 1 CHECK (increment_by > 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_staging_project
  ON usage_counter_staging (project_id, counter_type, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_staging_flush
  ON usage_counter_staging (created_at);

COMMENT ON TABLE usage_counter_staging IS
  'UNLOGGED tier-2 staging buffer for usage counters. Bulk-inserted from per-worker memory, aggregated into project_usage by flush_usage_counters(). Lossy on crash by design.';

-- ----------------------------------------------------------------------------
-- 2) TIER 3 â€” durable hourly-bucketed rollups.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_usage (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL,
    org_id       UUID NOT NULL,
    counter_type VARCHAR(64) NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end   TIMESTAMPTZ NOT NULL,
    value        BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (project_id, counter_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_lookup
  ON project_usage (project_id, counter_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_project_usage_org
  ON project_usage (org_id, period_start DESC);

DROP TRIGGER IF EXISTS trg_project_usage_updated_at ON project_usage;
CREATE TRIGGER trg_project_usage_updated_at BEFORE UPDATE ON project_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE project_usage IS
  'Durable tier-3 usage rollups, hourly-bucketed per (project, counter_type). Source of truth for usage/billing reads.';

COMMIT;

-- ============================================================================
-- 3) flush_usage_counters() â€” staging -> hourly buckets (UPSERT) -> delete.
-- ----------------------------------------------------------------------------
-- Aggregates staging rows older than a small settle window (5s) into hourly
-- buckets and UPSERTs them, then deletes exactly the rows it consumed. Bounded
-- to 10k staging rows per call so the function never holds a long lock under a
-- flood; the worker calls it repeatedly until it returns empty.
--
-- Returns one row per affected project with the number of rollup rows touched.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION flush_usage_counters()
RETURNS TABLE(flushed_project_id UUID, flushed_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id, project_id, org_id, counter_type, increment_by, created_at
    FROM usage_counter_staging
    WHERE created_at < NOW() - INTERVAL '5 seconds'
    ORDER BY id
    LIMIT 10000
    FOR UPDATE SKIP LOCKED
  ),
  aggregated AS (
    SELECT
      project_id,
      org_id,
      counter_type,
      date_trunc('hour', created_at)                        AS period_start,
      date_trunc('hour', created_at) + INTERVAL '1 hour'    AS period_end,
      SUM(increment_by)                                     AS total_increment
    FROM batch
    GROUP BY project_id, org_id, counter_type, date_trunc('hour', created_at)
  ),
  upserted AS (
    INSERT INTO project_usage
      (project_id, org_id, counter_type, period_start, period_end, value, updated_at)
    SELECT project_id, org_id, counter_type, period_start, period_end, total_increment, NOW()
    FROM aggregated
    ON CONFLICT (project_id, counter_type, period_start)
    DO UPDATE SET value = project_usage.value + EXCLUDED.value, updated_at = NOW()
    RETURNING project_id
  ),
  deleted AS (
    DELETE FROM usage_counter_staging s
    USING batch b
    WHERE s.id = b.id
    RETURNING s.id, s.project_id
  )
  SELECT d.project_id, COUNT(*)::BIGINT
  FROM deleted d
  GROUP BY d.project_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION flush_usage_counters() IS
  'Aggregates settled usage_counter_staging rows into hourly project_usage buckets (UPSERT) and deletes them. Bounded to 10k rows/call; call repeatedly to drain.';

COMMIT;

-- ============================================================================
-- 4) project_usage_realtime â€” durable buckets + un-flushed staging.
-- ============================================================================
BEGIN;

CREATE OR REPLACE VIEW project_usage_realtime AS
SELECT
  COALESCE(p.project_id, s.project_id)     AS project_id,
  COALESCE(p.org_id, s.org_id)             AS org_id,
  COALESCE(p.counter_type, s.counter_type) AS counter_type,
  COALESCE(p.value, 0) + COALESCE(s.unflushed_value, 0) AS total_value,
  p.period_start,
  p.period_end,
  p.updated_at                             AS last_flushed_at,
  NOW()                                    AS queried_at
FROM project_usage p
FULL OUTER JOIN (
  SELECT
    project_id,
    org_id,
    counter_type,
    date_trunc('hour', created_at) AS period_start,
    SUM(increment_by)              AS unflushed_value
  FROM usage_counter_staging
  GROUP BY project_id, org_id, counter_type, date_trunc('hour', created_at)
) s
  ON  p.project_id   = s.project_id
  AND p.counter_type = s.counter_type
  AND p.period_start = s.period_start;

COMMENT ON VIEW project_usage_realtime IS
  'Realtime usage: durable project_usage buckets PLUS the un-flushed staging tail, so reads never miss the last few seconds.';

COMMIT;


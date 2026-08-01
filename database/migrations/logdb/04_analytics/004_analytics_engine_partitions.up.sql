BEGIN;

-- ============================================================================
-- Analytics Engine — partition maintenance + telemetry read indexes
--
-- 1. analytics_engine_ensure_partitions(days_ahead) creates real range
--    partitions for every analytics-engine table. This replaces the dependency
--    on create_event_partitions(), which src/modules/event-analytics/queue.ts
--    calls but which no migration in this tree defines (see
--    docs/analytics/03-logdb-audit.md §5).
--
-- 2. analytics_engine_drop_partitions_before(cutoff) supports retention by
--    dropping whole partitions instead of DELETE, restricted to an allowlist so
--    the retention worker can never touch events_* or another module's tables.
--
-- 3. Watermark indexes on events_* — analytics workers track progress on
--    ingested_at (not occurred_at) so late-arriving events are never skipped.
--    These are the only changes this work makes to the canonical event tables:
--    additive indexes, no columns, no triggers, no constraints.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Partition granularity registry
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_engine_partition_tables()
RETURNS TABLE (table_name TEXT, part_column TEXT, granularity TEXT) AS $fn$
BEGIN
  RETURN QUERY
  SELECT c.relname::TEXT,
         CASE
           WHEN c.relname = 'anomaly_detections'    THEN 'detected_at'
           WHEN c.relname = 'analytics_worker_runs' THEN 'started_at'
           ELSE 'bucket'
         END::TEXT,
         CASE
           WHEN c.relname LIKE '%\_1m' OR c.relname LIKE '%\_5m' THEN 'day'
           WHEN c.relname IN ('anomaly_detections', 'analytics_worker_runs')  THEN 'day'
           ELSE 'month'
         END::TEXT
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'p'
     AND n.nspname = current_schema()
     AND (
       c.relname ~ '_metrics_(1m|5m|1h|1d)$'
       OR c.relname ~ '^metric_series_(1m|1h|1d)$'
       OR c.relname = 'project_health_5m'
       OR c.relname = 'anomaly_detections'
       OR c.relname = 'analytics_worker_runs'
     );
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_partition_tables() IS
  'Allowlist of analytics-engine partitioned tables with their partition column and granularity. The retention and partition workers operate only on this set.';

-- ---------------------------------------------------------------------------
-- Partition creation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_engine_ensure_partitions(
  days_ahead INTEGER DEFAULT 7
) RETURNS INTEGER AS $fn$
DECLARE
  rec        RECORD;
  created    INTEGER := 0;
  d          DATE;
  m          DATE;
  part_name  TEXT;
  range_from TIMESTAMPTZ;
  range_to   TIMESTAMPTZ;
BEGIN
  IF days_ahead IS NULL OR days_ahead < 1 THEN
    days_ahead := 1;
  END IF;

  FOR rec IN SELECT * FROM analytics_engine_partition_tables() LOOP
    IF rec.granularity = 'day' THEN
      -- One day back (late events / recompute) through days_ahead forward.
      d := (NOW() AT TIME ZONE 'UTC')::DATE - 1;
      WHILE d <= (NOW() AT TIME ZONE 'UTC')::DATE + days_ahead LOOP
        part_name  := format('%s_p%s', rec.table_name, to_char(d, 'YYYYMMDD'));
        range_from := d::TIMESTAMPTZ;
        range_to   := (d + 1)::TIMESTAMPTZ;

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            part_name, rec.table_name, range_from, range_to);
          created := created + 1;
        END IF;
        d := d + 1;
      END LOOP;
    ELSE
      -- Previous, current, and enough forward months to cover days_ahead.
      m := date_trunc('month', (NOW() AT TIME ZONE 'UTC')::DATE - INTERVAL '1 month')::DATE;
      WHILE m <= date_trunc('month', (NOW() AT TIME ZONE 'UTC')::DATE + days_ahead + 31)::DATE LOOP
        part_name  := format('%s_p%s', rec.table_name, to_char(m, 'YYYYMM'));
        range_from := m::TIMESTAMPTZ;
        range_to   := (m + INTERVAL '1 month')::TIMESTAMPTZ;

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            part_name, rec.table_name, range_from, range_to);
          created := created + 1;
        END IF;
        m := (m + INTERVAL '1 month')::DATE;
      END LOOP;
    END IF;
  END LOOP;

  RETURN created;
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_ensure_partitions(INTEGER) IS
  'Creates missing range partitions for analytics-engine tables (daily for 1m/5m tiers and ledgers, monthly for 1h/1d tiers). Idempotent; returns the number of partitions created.';

-- ---------------------------------------------------------------------------
-- Retention: drop whole partitions strictly older than a cutoff
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_engine_drop_partitions_before(
  p_table  TEXT,
  p_cutoff TIMESTAMPTZ
) RETURNS INTEGER AS $fn$
DECLARE
  child     RECORD;
  dropped   INTEGER := 0;
  upper_txt TEXT;
  upper_ts  TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM analytics_engine_partition_tables() t WHERE t.table_name = p_table) THEN
    RAISE EXCEPTION 'analytics_engine_drop_partitions_before refused: % is not an analytics-engine partitioned table', p_table;
  END IF;

  FOR child IN
    SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_class parent
      JOIN pg_inherits i ON i.inhparent = parent.oid
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE parent.relname = p_table
  LOOP
    -- Never drop the default partition: it holds rows outside declared ranges.
    CONTINUE WHEN child.bound IS NULL OR child.bound = 'DEFAULT';

    upper_txt := substring(child.bound FROM $re$TO \('([^']+)'\)$re$);
    CONTINUE WHEN upper_txt IS NULL;

    BEGIN
      upper_ts := upper_txt::TIMESTAMPTZ;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;

    IF upper_ts <= p_cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', child.name);
      dropped := dropped + 1;
    END IF;
  END LOOP;

  RETURN dropped;
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_drop_partitions_before(TEXT, TIMESTAMPTZ) IS
  'Drops analytics-engine partitions whose upper bound is at or before the cutoff. Raises if the table is not in the analytics-engine allowlist, and never drops the DEFAULT partition.';

-- ---------------------------------------------------------------------------
-- Watermark indexes on the canonical event tables (additive only)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests','events_errors','events_logs','events_metrics','events_spans',
    'events_traces','events_messages','events_profiles','events_replays','events_cron_checkins'
  ] LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, project_id, environment, ingested_at)',
      'idx_' || t || '_tenant_env_ingested', t);
  END LOOP;
END $$;

-- Dimension indexes required by the geo, release, session, sdk, and span workers.
CREATE INDEX IF NOT EXISTS idx_events_requests_geo_time
  ON events_requests(organization_id, project_id, geo_country_code, timestamp DESC)
  WHERE geo_country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_release_time
  ON events_requests(organization_id, project_id, release, timestamp DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_release_time
  ON events_errors(organization_id, project_id, release, timestamp DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_session_time
  ON events_requests(organization_id, project_id, session_id, timestamp DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_db_time
  ON events_spans(organization_id, project_id, db_system, timestamp DESC)
  WHERE db_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_host_time
  ON events_spans(organization_id, project_id, http_host, timestamp DESC)
  WHERE http_host IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_sdk_time
  ON events_requests(organization_id, project_id, sdk_name, sdk_version, timestamp DESC)
  WHERE sdk_name IS NOT NULL;

-- ---------------------------------------------------------------------------
-- First partition set so the engine can write immediately after migration
-- ---------------------------------------------------------------------------

SELECT analytics_engine_ensure_partitions(7);

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  ('analytics_engine_partitioning',
   'analytics_engine_ensure_partitions(days_ahead) creates daily partitions for 1m/5m rollups and the anomaly/run ledgers, and monthly partitions for 1h/1d rollups. analytics_engine_drop_partitions_before(table, cutoff) performs retention by dropping partitions and refuses any table outside the analytics-engine allowlist.')
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;

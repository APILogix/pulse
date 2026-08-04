BEGIN;

-- ============================================================================
-- Analytics Engine — rollup + control tables
--
-- Design: docs/analytics/07-rollup-tables.md
-- Ownership: docs/analytics/07-rollup-tables.md §4 (exactly one writing worker
--            per table; dashboard APIs read these tables and never events_*).
--
-- Naming follows planning/anlatycisprompt.md Phase 10: <domain>_metrics_<window>.
-- This namespace deliberately does not collide with the never-written
-- analytics_* tables from 04_analytics/001, which are frozen below.
--
-- Two physical shapes:
--   Shape A  (organization_id, project_id, environment, bucket)
--   Shape B  (organization_id, project_id, environment, bucket, entity_key)
--
-- Sentinels keep the primary key total:
--   project_id  = '00000000-0000-0000-0000-000000000000' → org-wide aggregate
--   environment = '__all__'                              → all environments
-- Neither value can be produced by ingestion (UUID zero is never issued and
-- '__all__' fails the environment regex enforced on events_*).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_engine_create_rollup(
  p_table   TEXT,
  p_shape   TEXT,          -- 'A' | 'B'
  p_partkey TEXT DEFAULT 'bucket'
) RETURNS VOID AS $fn$
DECLARE
  entity_cols TEXT := '';
  pk_cols     TEXT := 'organization_id, project_id, environment, bucket';
BEGIN
  IF p_shape = 'B' THEN
    entity_cols := 'entity_key TEXT NOT NULL, entity_label TEXT,';
    pk_cols := pk_cols || ', entity_key';
  END IF;

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I (
      organization_id UUID        NOT NULL,
      project_id      UUID        NOT NULL,
      environment     TEXT        NOT NULL,
      bucket          TIMESTAMPTZ NOT NULL,
      %s
      sample_count    BIGINT      NOT NULL DEFAULT 0,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (%s)
    ) PARTITION BY RANGE (%I)
  $sql$, p_table, entity_cols, pk_cols, p_partkey);

  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I DEFAULT',
                 p_table || '_default', p_table);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, project_id, environment, bucket DESC)',
    'idx_' || p_table || '_tenant_time', p_table);

  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (bucket)',
                 'idx_' || p_table || '_bucket_brin', p_table);

  IF p_shape = 'B' THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, project_id, environment, entity_key, bucket DESC)',
      'idx_' || p_table || '_entity_time', p_table);
  END IF;
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_create_rollup(TEXT, TEXT, TEXT) IS
  'Creates one analytics-engine rollup table (Shape A or B) with its default partition and standard index set. Idempotent.';

-- Latency / duration block. Percentiles are exact inside a 1m bucket; coarser
-- windows recompute them from the merged latency_hist (24 log-scale buckets).
CREATE OR REPLACE FUNCTION analytics_engine_add_latency_columns(
  p_table  TEXT,
  p_prefix TEXT DEFAULT 'latency'
) RETURNS VOID AS $fn$
BEGIN
  EXECUTE format($sql$
    ALTER TABLE %I
      ADD COLUMN IF NOT EXISTS %I NUMERIC(20,3) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I BIGINT[]
  $sql$, p_table,
     p_prefix || '_sum_ms', p_prefix || '_max_ms',
     p_prefix || '_p50_ms', p_prefix || '_p75_ms', p_prefix || '_p90_ms',
     p_prefix || '_p95_ms', p_prefix || '_p99_ms', p_prefix || '_hist');
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_add_latency_columns(TEXT, TEXT) IS
  'Adds the mergeable latency block (sum/max/p50..p99/histogram) to a rollup table. Histogram edges are documented in docs/analytics/07-rollup-tables.md §1.';

-- Distinct-count block: exact within a 1m bucket, HLL sketch for merges.
CREATE OR REPLACE FUNCTION analytics_engine_add_unique_columns(
  p_table   TEXT,
  p_subject TEXT DEFAULT 'users'
) RETURNS VOID AS $fn$
BEGIN
  EXECUTE format($sql$
    ALTER TABLE %I
      ADD COLUMN IF NOT EXISTS %I BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS %I BYTEA
  $sql$, p_table,
     'unique_' || p_subject || '_exact', 'unique_' || p_subject || '_hll');
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analytics_engine_add_unique_columns(TEXT, TEXT) IS
  'Adds an exact + HyperLogLog distinct-count pair to a rollup table. Sketches are produced and merged only by the analytics engine.';

-- ---------------------------------------------------------------------------
-- Table creation from the declarative domain/window map
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  spec        TEXT;
  parts       TEXT[];
  domain      TEXT;
  shape       TEXT;
  windows     TEXT[];
  w           TEXT;
BEGIN
  -- 'domain|shape|window,window,...'
  FOREACH spec IN ARRAY ARRAY[
    'request_metrics|A|1m,5m,1h,1d',
    'endpoint_metrics|B|1m,5m,1h,1d',
    'service_metrics|B|1m,5m,1h,1d',
    'error_metrics|A|1m,5m,1h,1d',
    'error_group_metrics|B|1m,1h,1d',
    'error_dimension_metrics|B|1h',
    'log_metrics|A|1m,5m,1h,1d',
    'logger_metrics|B|1h',
    'metric_series|B|1m,1h,1d',
    'runtime_metrics|B|1m,1h',
    'gc_metrics|B|1m,1h',
    'span_metrics|B|1m,1h',
    'db_metrics|B|1h',
    'dependency_metrics|B|1h',
    'trace_metrics|A|1m,5m,1h',
    'trace_edge_metrics|B|1h',
    'cron_metrics|B|1m,1h',
    'profile_metrics|B|1h',
    'profile_function_metrics|B|1h',
    'replay_metrics|A|1h',
    'session_metrics|A|1h',
    'user_metrics|A|1d',
    'geo_metrics|B|1h',
    'device_metrics|B|1h',
    'sdk_metrics|B|1h',
    'release_metrics|B|1h',
    'slo_metrics|B|5m,1h',
    'security_metrics|B|1h',
    'usage_metrics|B|1d',
    'cost_metrics|A|1d',
    'ingest_health_metrics|B|5m',
    'alert_metrics|B|1h',
    'ai_metrics|B|1h',
    'project_health|A|5m'
  ] LOOP
    parts   := string_to_array(spec, '|');
    domain  := parts[1];
    shape   := parts[2];
    windows := string_to_array(parts[3], ',');

    FOREACH w IN ARRAY windows LOOP
      PERFORM analytics_engine_create_rollup(domain || '_' || w, shape);
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Domain columns
-- ---------------------------------------------------------------------------

-- Requests -------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['request_metrics_1m','request_metrics_5m','request_metrics_1h','request_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS success_count          BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS redirect_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS client_error_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS auth_failure_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS rate_limited_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS slow_count             BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bot_count              BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_satisfied_count  BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_tolerating_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_in               BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_out              BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS service_count          INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS route_count            INTEGER NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
    PERFORM analytics_engine_add_unique_columns(t, 'sessions');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS unique_tenants_exact BIGINT NOT NULL DEFAULT 0', t);
  END LOOP;
END $$;

-- Endpoints ------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['endpoint_metrics_1m','endpoint_metrics_5m','endpoint_metrics_1h','endpoint_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS method             TEXT,
        ADD COLUMN IF NOT EXISTS route              TEXT,
        ADD COLUMN IF NOT EXISTS service            TEXT,
        ADD COLUMN IF NOT EXISTS total_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS client_error_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS slow_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_out          BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS lifecycle          TEXT
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

-- Services -------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_metrics_1m','service_metrics_5m','service_metrics_1h','service_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS client_error_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_satisfied_count  BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_tolerating_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS span_count             BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_group_count      INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS availability_pct       NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS health_score           NUMERIC(6,2),
        ADD COLUMN IF NOT EXISTS release_current        TEXT
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

-- Errors ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['error_metrics_1m','error_metrics_5m','error_metrics_1h','error_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fatal_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS warning_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS info_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS debug_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS unique_fingerprints INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS new_group_count    INTEGER NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['error_group_metrics_1m','error_group_metrics_1h','error_group_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS error_name         TEXT,
        ADD COLUMN IF NOT EXISTS message_template   TEXT,
        ADD COLUMN IF NOT EXISTS mechanism          TEXT,
        ADD COLUMN IF NOT EXISTS severity_max       TEXT,
        ADD COLUMN IF NOT EXISTS occurrence_count   BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS service_count      INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS release_first_seen TEXT,
        ADD COLUMN IF NOT EXISTS first_seen_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_seen_at       TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS baseline_count     NUMERIC(20,6),
        ADD COLUMN IF NOT EXISTS regression_score   NUMERIC(10,4),
        ADD COLUMN IF NOT EXISTS is_new_in_window   BOOLEAN NOT NULL DEFAULT FALSE
    $sql$, t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

ALTER TABLE error_dimension_metrics_1h
  ADD COLUMN IF NOT EXISTS dimension        TEXT,
  ADD COLUMN IF NOT EXISTS dimension_value  TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_count BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_unique_columns('error_dimension_metrics_1h', 'users');

-- Logs -----------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['log_metrics_1m','log_metrics_5m','log_metrics_1h','log_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS warn_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS info_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS debug_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS unique_loggers  INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_estimate  BIGINT NOT NULL DEFAULT 0
    $sql$, t);
  END LOOP;
END $$;

ALTER TABLE logger_metrics_1h
  ADD COLUMN IF NOT EXISTS service     TEXT,
  ADD COLUMN IF NOT EXISTS total_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warn_count  BIGINT NOT NULL DEFAULT 0;

-- Custom metrics -------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['metric_series_1m','metric_series_1h','metric_series_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS metric_type      TEXT,
        ADD COLUMN IF NOT EXISTS unit             TEXT,
        ADD COLUMN IF NOT EXISTS service          TEXT,
        ADD COLUMN IF NOT EXISTS point_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS value_sum        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_min        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_max        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_last       DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_last_at    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS value_p50        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_p95        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_p99        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS tag_cardinality  INTEGER NOT NULL DEFAULT 0
    $sql$, t);
  END LOOP;
END $$;

-- Runtime + GC ---------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['runtime_metrics_1m','runtime_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS heap_used_mb_avg            NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS heap_used_mb_max            NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS heap_total_mb_avg           NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS external_mb_avg             NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS rss_mb_avg                  NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS rss_mb_max                  NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS active_handles_avg          NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS active_handles_max          NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_p50_ms        NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_p95_ms        NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_p99_ms        NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_hist          BIGINT[],
        ADD COLUMN IF NOT EXISTS eventloop_utilization_pct   NUMERIC(7,3)
    $sql$, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['gc_metrics_1m','gc_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS service            TEXT,
        ADD COLUMN IF NOT EXISTS gc_type            TEXT,
        ADD COLUMN IF NOT EXISTS pause_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS long_pause_count   BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS heap_before_mb_avg NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS heap_after_mb_avg  NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS reclaimed_mb_sum   NUMERIC(20,3) NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t, 'pause');
  END LOOP;
END $$;

-- Spans / DB / dependencies --------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['span_metrics_1m','span_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS service     TEXT,
        ADD COLUMN IF NOT EXISTS span_name   TEXT,
        ADD COLUMN IF NOT EXISTS kind        TEXT,
        ADD COLUMN IF NOT EXISTS total_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count BIGINT NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_latency_columns(t, 'self_time');
  END LOOP;
END $$;

ALTER TABLE db_metrics_1h
  ADD COLUMN IF NOT EXISTS db_system         TEXT,
  ADD COLUMN IF NOT EXISTS db_name           TEXT,
  ADD COLUMN IF NOT EXISTS db_operation      TEXT,
  ADD COLUMN IF NOT EXISTS db_collection     TEXT,
  ADD COLUMN IF NOT EXISTS statement_pattern TEXT,
  ADD COLUMN IF NOT EXISTS service           TEXT,
  ADD COLUMN IF NOT EXISTS call_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count       BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('db_metrics_1h');

ALTER TABLE dependency_metrics_1h
  ADD COLUMN IF NOT EXISTS dependency_kind  TEXT,
  ADD COLUMN IF NOT EXISTS dependency_host  TEXT,
  ADD COLUMN IF NOT EXISTS service          TEXT,
  ADD COLUMN IF NOT EXISTS call_count       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_5xx_count BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('dependency_metrics_1h');

-- Traces ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['trace_metrics_1m','trace_metrics_5m','trace_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS trace_count           BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS partial_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_trace_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS span_count_sum        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS span_count_max        INTEGER,
        ADD COLUMN IF NOT EXISTS critical_path_p95_ms  NUMERIC(14,3)
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t, 'duration');
  END LOOP;
END $$;

ALTER TABLE trace_edge_metrics_1h
  ADD COLUMN IF NOT EXISTS source_service TEXT,
  ADD COLUMN IF NOT EXISTS target_service TEXT,
  ADD COLUMN IF NOT EXISTS call_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count    BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('trace_edge_metrics_1h');

-- Crons ----------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cron_metrics_1m','cron_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS monitor_slug       TEXT,
        ADD COLUMN IF NOT EXISTS checkin_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ok_count           BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS in_progress_count  BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS missed_count       BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_status        TEXT,
        ADD COLUMN IF NOT EXISTS last_checkin_at    TIMESTAMPTZ
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t, 'duration');
  END LOOP;
END $$;

-- Profiles -------------------------------------------------------------------
ALTER TABLE profile_metrics_1h
  ADD COLUMN IF NOT EXISTS service          TEXT,
  ADD COLUMN IF NOT EXISTS profile_type     TEXT,
  ADD COLUMN IF NOT EXISTS profile_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sample_count_sum BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS node_count_sum   BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('profile_metrics_1h', 'duration');

ALTER TABLE profile_function_metrics_1h
  ADD COLUMN IF NOT EXISTS service        TEXT,
  ADD COLUMN IF NOT EXISTS function_name  TEXT,
  ADD COLUMN IF NOT EXISTS script_url     TEXT,
  ADD COLUMN IF NOT EXISTS line_number    INTEGER,
  ADD COLUMN IF NOT EXISTS hit_count_sum  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_count  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS self_share_pct NUMERIC(7,3);

-- Replays / sessions / users -------------------------------------------------
ALTER TABLE replay_metrics_1h
  ADD COLUMN IF NOT EXISTS segment_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dom_event_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crashed_session_count  BIGINT NOT NULL DEFAULT 0;

ALTER TABLE session_metrics_1h
  ADD COLUMN IF NOT EXISTS session_count         BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crashed_session_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_user_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returning_user_count  BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('session_metrics_1h', 'duration');
SELECT analytics_engine_add_unique_columns('session_metrics_1h', 'users');

ALTER TABLE user_metrics_1d
  ADD COLUMN IF NOT EXISTS dau                   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_users             BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returning_users       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sessions_per_user_avg NUMERIC(12,4);
SELECT analytics_engine_add_unique_columns('user_metrics_1d', 'users');

-- Geo / devices / SDK / releases --------------------------------------------
ALTER TABLE geo_metrics_1h
  ADD COLUMN IF NOT EXISTS country_code  CHAR(2),
  ADD COLUMN IF NOT EXISTS country_name  TEXT,
  ADD COLUMN IF NOT EXISTS region        TEXT,
  ADD COLUMN IF NOT EXISTS request_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asn_count     INTEGER NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('geo_metrics_1h');
SELECT analytics_engine_add_unique_columns('geo_metrics_1h', 'users');

ALTER TABLE device_metrics_1h
  ADD COLUMN IF NOT EXISTS dimension       TEXT,
  ADD COLUMN IF NOT EXISTS dimension_value TEXT,
  ADD COLUMN IF NOT EXISTS request_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count     BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('device_metrics_1h');
SELECT analytics_engine_add_unique_columns('device_metrics_1h', 'users');

ALTER TABLE sdk_metrics_1h
  ADD COLUMN IF NOT EXISTS sdk_name      TEXT,
  ADD COLUMN IF NOT EXISTS sdk_version   TEXT,
  ADD COLUMN IF NOT EXISTS event_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS project_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ;

ALTER TABLE release_metrics_1h
  ADD COLUMN IF NOT EXISTS release              TEXT,
  ADD COLUMN IF NOT EXISTS request_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_group_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_error_group_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crash_free_rate      NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS adoption_share_pct   NUMERIC(7,4);
SELECT analytics_engine_add_latency_columns('release_metrics_1h');
SELECT analytics_engine_add_unique_columns('release_metrics_1h', 'users');

-- SLO ------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['slo_metrics_5m','slo_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS slo_name                   TEXT,
        ADD COLUMN IF NOT EXISTS slo_kind                   TEXT,
        ADD COLUMN IF NOT EXISTS slo_target_pct             NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS good_count                 BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_count                BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS availability_pct           NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS error_budget_consumed_pct  NUMERIC(9,4),
        ADD COLUMN IF NOT EXISTS burn_rate_1h               NUMERIC(12,4),
        ADD COLUMN IF NOT EXISTS burn_rate_6h               NUMERIC(12,4),
        ADD COLUMN IF NOT EXISTS burn_rate_24h              NUMERIC(12,4)
    $sql$, t);
  END LOOP;
END $$;

-- Security -------------------------------------------------------------------
ALTER TABLE security_metrics_1h
  ADD COLUMN IF NOT EXISTS dimension              TEXT,
  ADD COLUMN IF NOT EXISTS dimension_value        TEXT,
  ADD COLUMN IF NOT EXISTS auth_failure_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forbidden_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_limited_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sensitive_access_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_anomaly_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distinct_country_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_score             NUMERIC(6,2);

-- Usage / cost / ingestion ---------------------------------------------------
ALTER TABLE usage_metrics_1d
  ADD COLUMN IF NOT EXISTS signal          TEXT,
  ADD COLUMN IF NOT EXISTS event_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billable_count  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_count  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bytes_estimate  BIGINT NOT NULL DEFAULT 0;

ALTER TABLE cost_metrics_1d
  ADD COLUMN IF NOT EXISTS billable_events         BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_micros        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_micros   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_million_micros BIGINT NOT NULL DEFAULT 0;

ALTER TABLE ingest_health_metrics_5m
  ADD COLUMN IF NOT EXISTS signal            TEXT,
  ADD COLUMN IF NOT EXISTS accepted_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dropped_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dlq_count         BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejection_reasons JSONB NOT NULL DEFAULT '{}'::jsonb;
SELECT analytics_engine_add_latency_columns('ingest_health_metrics_5m', 'ingest_lag');

-- Alerts / AI ----------------------------------------------------------------
ALTER TABLE alert_metrics_1h
  ADD COLUMN IF NOT EXISTS rule_id                  UUID,
  ADD COLUMN IF NOT EXISTS rule_name                TEXT,
  ADD COLUMN IF NOT EXISTS triggered_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_count           BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notification_count       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_success_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_failure_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mtta_seconds_avg         NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS mttr_seconds_avg         NUMERIC(14,3);

ALTER TABLE ai_metrics_1h
  ADD COLUMN IF NOT EXISTS model             TEXT,
  ADD COLUMN IF NOT EXISTS request_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_hit_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_consumed  NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_micros       BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('ai_metrics_1h');

-- Project health -------------------------------------------------------------
ALTER TABLE project_health_5m
  ADD COLUMN IF NOT EXISTS request_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_rate_pct   NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS latency_p95_ms   NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS availability_pct NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS open_alert_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_score     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS status           TEXT;

-- ---------------------------------------------------------------------------
-- Current-state tables (not rollups: one row per entity, no bucket)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cron_monitor_state (
  organization_id           UUID NOT NULL,
  project_id                UUID NOT NULL,
  environment               TEXT NOT NULL,
  monitor_slug              TEXT NOT NULL,
  last_status               TEXT,
  last_checkin_at           TIMESTAMPTZ,
  last_duration_ms          NUMERIC(14,3),
  expected_interval_seconds INTEGER,
  consecutive_failures      INTEGER NOT NULL DEFAULT 0,
  checkin_count_total       BIGINT NOT NULL DEFAULT 0,
  is_missing                BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, monitor_slug)
);
CREATE INDEX IF NOT EXISTS idx_cron_monitor_state_missing
  ON cron_monitor_state(organization_id, project_id) WHERE is_missing;

CREATE TABLE IF NOT EXISTS release_comparison (
  organization_id        UUID NOT NULL,
  project_id             UUID NOT NULL,
  environment            TEXT NOT NULL,
  release                TEXT NOT NULL,
  baseline_release       TEXT,
  request_count          BIGINT NOT NULL DEFAULT 0,
  baseline_request_count BIGINT NOT NULL DEFAULT 0,
  error_rate_pct         NUMERIC(7,4),
  baseline_error_rate_pct NUMERIC(7,4),
  error_rate_delta_pct   NUMERIC(10,4),
  latency_p95_ms         NUMERIC(14,3),
  baseline_latency_p95_ms NUMERIC(14,3),
  p95_delta_ms           NUMERIC(14,3),
  throughput_delta_pct   NUMERIC(10,4),
  new_error_groups       INTEGER NOT NULL DEFAULT 0,
  verdict                TEXT NOT NULL DEFAULT 'stable',
  first_seen_at          TIMESTAMPTZ,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, release),
  CONSTRAINT release_comparison_verdict_ck
    CHECK (verdict IN ('improved', 'stable', 'degraded', 'insufficient_data'))
);
CREATE INDEX IF NOT EXISTS idx_release_comparison_recent
  ON release_comparison(organization_id, project_id, computed_at DESC);

-- SLO definitions are authored in the control plane; the engine caches them so
-- analytics workers never query the control-plane database.
CREATE TABLE IF NOT EXISTS slo_definition_cache (
  slo_id           UUID PRIMARY KEY,
  organization_id  UUID NOT NULL,
  project_id       UUID NOT NULL,
  environment      TEXT NOT NULL,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  target_pct       NUMERIC(7,4) NOT NULL,
  window_days      INTEGER NOT NULL DEFAULT 30,
  service          TEXT,
  latency_threshold_ms NUMERIC(14,3),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT slo_definition_cache_kind_ck CHECK (kind IN ('availability', 'latency'))
);
CREATE INDEX IF NOT EXISTS idx_slo_definition_cache_scope
  ON slo_definition_cache(organization_id, project_id, environment) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Anomaly detections
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS anomaly_detections (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id      UUID NOT NULL,
  environment     TEXT NOT NULL,
  metric_key      TEXT NOT NULL,
  entity_key      TEXT,
  bucket          TIMESTAMPTZ NOT NULL,
  window_size     TEXT NOT NULL,
  observed_value  NUMERIC(20,6) NOT NULL,
  baseline_value  NUMERIC(20,6) NOT NULL,
  baseline_stddev NUMERIC(20,6),
  deviation_sigma NUMERIC(12,4) NOT NULL,
  direction       TEXT NOT NULL,
  severity        TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, detected_at),
  CONSTRAINT anomaly_detections_direction_ck CHECK (direction IN ('spike', 'drop')),
  CONSTRAINT anomaly_detections_severity_ck CHECK (severity IN ('info', 'warning', 'critical'))
) PARTITION BY RANGE (detected_at);
CREATE TABLE IF NOT EXISTS anomaly_detections_default PARTITION OF anomaly_detections DEFAULT;
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_scope_time
  ON anomaly_detections(organization_id, project_id, environment, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_metric
  ON anomaly_detections(organization_id, metric_key, detected_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_detections_dedupe
  ON anomaly_detections(organization_id, project_id, environment, metric_key,
                        COALESCE(entity_key, ''), bucket, window_size, detected_at);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_brin
  ON anomaly_detections USING BRIN (detected_at);

-- ---------------------------------------------------------------------------
-- Engine control tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics_watermarks (
  worker_id            TEXT NOT NULL,
  organization_id      UUID NOT NULL,
  window_size          TEXT NOT NULL,
  watermark_at         TIMESTAMPTZ NOT NULL,
  last_bucket_at       TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rows_processed       BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (worker_id, organization_id, window_size)
);
CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_worker_lag
  ON analytics_watermarks(worker_id, watermark_at);
CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_failing
  ON analytics_watermarks(worker_id, consecutive_failures) WHERE consecutive_failures > 0;
DROP TRIGGER IF EXISTS trg_analytics_watermarks_updated_at ON analytics_watermarks;
CREATE TRIGGER trg_analytics_watermarks_updated_at
  BEFORE UPDATE ON analytics_watermarks
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS analytics_worker_runs (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id       TEXT NOT NULL,
  organization_id UUID,
  window_size     TEXT NOT NULL,
  window_start    TIMESTAMPTZ,
  window_end      TIMESTAMPTZ,
  rows_read       BIGINT NOT NULL DEFAULT 0,
  rows_written    BIGINT NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT NOT NULL,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  PRIMARY KEY (id, started_at),
  CONSTRAINT analytics_worker_runs_outcome_ck
    CHECK (outcome IN ('success', 'partial', 'failed', 'skipped'))
) PARTITION BY RANGE (started_at);
CREATE TABLE IF NOT EXISTS analytics_worker_runs_default PARTITION OF analytics_worker_runs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_worker_time
  ON analytics_worker_runs(worker_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_failures
  ON analytics_worker_runs(worker_id, started_at DESC) WHERE outcome <> 'success';
CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_brin
  ON analytics_worker_runs USING BRIN (started_at);

-- ---------------------------------------------------------------------------
-- Documentation + freeze markers
-- ---------------------------------------------------------------------------

COMMENT ON TABLE request_metrics_1m IS
  'Analytics engine rollup. Owner: analytics.requests. Read by /analytics/v2/*. Never written by ingestion.';
COMMENT ON TABLE analytics_watermarks IS
  'Analytics engine progress ledger. watermark_at tracks the highest events_*.ingested_at consumed per (worker, org, window).';
COMMENT ON TABLE analytics_worker_runs IS
  'Analytics engine run ledger (14 day retention). Feeds the worker health endpoint and /analytics/v2/system/health.';
COMMENT ON TABLE cron_monitor_state IS
  'Current cron monitor state. Owner: analytics.crons.';
COMMENT ON TABLE release_comparison IS
  'Current release-vs-baseline verdict. Owner: analytics.releases.';
COMMENT ON TABLE slo_definition_cache IS
  'Control-plane SLO definitions mirrored into the Log DB so analytics workers never read the control-plane database.';
COMMENT ON TABLE anomaly_detections IS
  'Statistical anomaly facts derived from *_metrics_1h rollups. Owner: analytics.anomalies.';

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'analytics_hourly_rollup','analytics_daily_rollup','analytics_performance_summary',
    'analytics_endpoint_minute','analytics_endpoint_hourly','analytics_endpoint_daily',
    'analytics_service_minute','analytics_service_hourly','analytics_service_daily',
    'analytics_trace_latency','analytics_error_occurrences','analytics_error_regressions',
    'analytics_geo_hourly_rollup','analytics_alerts'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t) THEN
      EXECUTE format(
        'COMMENT ON TABLE %I IS %L', t,
        'FROZEN by 04_analytics/003_analytics_engine_rollups: superseded by the <domain>_metrics_<window> rollups. No reads, no writes. Drop requires explicit approval (docs/analytics/14-implementation-roadmap.md Wave 7).'
      );
    END IF;
  END LOOP;
END $$;

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  ('analytics_engine_ownership',
   'Tables named <domain>_metrics_<window> plus cron_monitor_state, release_comparison, slo_definition_cache, anomaly_detections, analytics_watermarks and analytics_worker_runs are written exclusively by the analytics engine workers (src/modules/analytics-engine). Dashboard APIs read these tables and must not aggregate events_* directly.'),
  ('analytics_engine_sentinels',
   'Rollups store org-wide aggregates with project_id = 00000000-0000-0000-0000-000000000000 and cross-environment aggregates with environment = __all__. Neither value can be produced by ingestion.')
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;

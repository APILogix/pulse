BEGIN;

-- Breaking telemetry environment contract.
-- SDK telemetry and derived facts use only the normalized SDK-supplied
-- environment string. Credential environment UUIDs/slugs are never converted
-- into a telemetry dimension, and missing values are never fabricated.

DO $$
DECLARE
  t TEXT;
  idx TEXT;
  invalid_rows BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests','events_errors','events_logs','events_metrics','events_spans',
    'events_traces','events_messages','events_profiles','events_replays','events_cron_checkins'
  ] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', t);
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT ''{}''::jsonb',
      t
    );

    -- Preserve a valid existing SDK string, normalizing only envelope whitespace.
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(environment)
       WHERE environment IS NOT NULL
         AND environment<>btrim(environment)
         AND char_length(btrim(environment)) BETWEEN 1 AND 64
         AND btrim(environment) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);

    -- Historical typed rows may carry the original SDK envelope in metadata.
    -- This is the only fallback source considered trustworthy.
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(metadata->>'environment')
       WHERE (
               environment IS NULL
               OR char_length(environment) NOT BETWEEN 1 AND 64
               OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
             )
         AND char_length(btrim(COALESCE(metadata->>'environment',''))) BETWEEN 1 AND 64
         AND btrim(COALESCE(metadata->>'environment','')) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);

    EXECUTE format($sql$
      SELECT count(*)
        FROM %I
       WHERE environment IS NULL
          OR char_length(environment) NOT BETWEEN 1 AND 64
          OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t) INTO invalid_rows;
    IF invalid_rows > 0 THEN
      RAISE EXCEPTION
        'Cannot migrate %: % row(s) lack a trustworthy SDK environment string',
        t, invalid_rows
        USING HINT = 'Backfill metadata.environment from the original SDK envelope, then rerun the migration.';
    END IF;

    EXECUTE format(
      'UPDATE %I SET metadata=jsonb_build_object(''environment'',environment)',
      t
    );
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS environment_id', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN environment SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_environment_string_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (char_length(environment) BETWEEN 1 AND 64 AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$'')',
      t, t || '_environment_string_ck'
    );
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_metadata_environment_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (metadata=jsonb_build_object(''environment'',environment))',
      t, t || '_metadata_environment_ck'
    );
    idx := 'idx_' || t || '_tenant_env_time';
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id,project_id,environment,occurred_at DESC)',
      idx, t
    );
  END LOOP;
END $$;

-- These operational tables normally remain in the control-plane database. If
-- an older Log DB contains them, migrate only an environment retained in the
-- original job envelope; never translate environment_id through a lookup.
DO $$
DECLARE
  t TEXT;
  has_payload BOOLEAN;
  has_environment_id BOOLEAN;
  invalid_rows BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ingestion_jobs','ingestion_dead_letter_jobs','usage_counter_staging','ingestion_failures'
  ] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', t);
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(environment)
       WHERE environment IS NOT NULL
         AND environment<>btrim(environment)
         AND char_length(btrim(environment)) BETWEEN 1 AND 64
         AND btrim(environment) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name=t AND column_name='payload'
    ) INTO has_payload;
    IF has_payload THEN
      EXECUTE format($sql$
        UPDATE %I
           SET environment=btrim(payload->'metadata'->>'environment')
         WHERE (
                 environment IS NULL
                 OR char_length(environment) NOT BETWEEN 1 AND 64
                 OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
               )
           AND char_length(btrim(COALESCE(payload->'metadata'->>'environment',''))) BETWEEN 1 AND 64
           AND btrim(COALESCE(payload->'metadata'->>'environment','')) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      $sql$, t);
      EXECUTE format($sql$
        UPDATE %I
           SET environment=btrim(payload->>'environment')
         WHERE (
                 environment IS NULL
                 OR char_length(environment) NOT BETWEEN 1 AND 64
                 OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
               )
           AND char_length(btrim(COALESCE(payload->>'environment',''))) BETWEEN 1 AND 64
           AND btrim(COALESCE(payload->>'environment','')) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      $sql$, t);
    END IF;

    EXECUTE format($sql$
      SELECT count(*)
        FROM %I
       WHERE environment IS NULL
          OR char_length(environment) NOT BETWEEN 1 AND 64
          OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t) INTO invalid_rows;
    IF invalid_rows > 0 THEN
      RAISE EXCEPTION
        'Cannot migrate %: % operational row(s) lack an SDK envelope environment',
        t, invalid_rows
        USING HINT = 'Backfill the original job envelope environment or remove non-replayable legacy rows before retrying.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name=t AND column_name='environment_id'
    ) INTO has_environment_id;
    IF has_environment_id AND t='usage_counter_staging' THEN
      EXECUTE 'ALTER TABLE usage_counter_staging DROP CONSTRAINT IF EXISTS usage_counter_staging_pkey';
    END IF;
    IF has_environment_id THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN environment_id', t);
    END IF;
    IF has_environment_id AND t='usage_counter_staging' THEN
      EXECUTE 'ALTER TABLE usage_counter_staging ADD PRIMARY KEY (organization_id,project_id,environment,api_key_id,bucket,event_type)';
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN environment SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_environment_string_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (char_length(environment) BETWEEN 1 AND 64 AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$'')',
      t, t || '_environment_string_ck'
    );
  END LOOP;
END $$;

-- Analytics rows must already carry their SDK environment dimension. They are
-- never relabeled through an environment lookup table; an unsafe historical database stops
-- here so operators can rebuild derived facts from trustworthy typed events.
DO $$
DECLARE
  t TEXT;
  has_environment_id BOOLEAN;
  invalid_rows BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'analytics_hourly_rollup','analytics_daily_rollup','analytics_geo_hourly_rollup',
    'analytics_performance_summary',
    'analytics_user_sessions','analytics_endpoint_minute','analytics_endpoint_hourly',
    'analytics_endpoint_daily','analytics_service_minute','analytics_service_hourly',
    'analytics_service_daily','analytics_trace_latency','analytics_error_occurrences',
    'analytics_error_regressions','analytics_trace_service_edges'
  ] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', t);
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(environment)
       WHERE environment IS NOT NULL
         AND environment<>btrim(environment)
         AND char_length(btrim(environment)) BETWEEN 1 AND 64
         AND btrim(environment) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);
    EXECUTE format($sql$
      SELECT count(*)
        FROM %I
       WHERE environment IS NULL
          OR char_length(environment) NOT BETWEEN 1 AND 64
          OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t) INTO invalid_rows;
    IF invalid_rows > 0 THEN
      RAISE EXCEPTION
        'Cannot migrate %: % analytics row(s) lack a trustworthy SDK environment string',
        t, invalid_rows
        USING HINT = 'Rebuild derived analytics from typed events that retain metadata.environment, then rerun the migration.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name=t AND column_name='environment_id'
    ) INTO has_environment_id;
    IF has_environment_id AND t <> 'analytics_user_sessions' THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_pkey');
    END IF;
    IF has_environment_id THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN environment_id', t);
    END IF;

    IF has_environment_id AND t IN ('analytics_hourly_rollup','analytics_daily_rollup') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD PRIMARY KEY (organization_id,project_id,environment,bucket,metric_name)',
        t
      );
    ELSIF has_environment_id AND t='analytics_geo_hourly_rollup' THEN
      EXECUTE 'ALTER TABLE analytics_geo_hourly_rollup ADD PRIMARY KEY (organization_id,project_id,environment,bucket,country_code,region,city)';
    ELSIF has_environment_id AND t='analytics_performance_summary' THEN
      EXECUTE 'ALTER TABLE analytics_performance_summary ADD PRIMARY KEY (organization_id,project_id,environment,bucket,service,endpoint)';
    ELSIF has_environment_id AND t='analytics_trace_service_edges' THEN
      EXECUTE 'ALTER TABLE analytics_trace_service_edges ADD PRIMARY KEY (organization_id,project_id,environment,bucket,source_service,target_service)';
    ELSIF has_environment_id AND t <> 'analytics_user_sessions' THEN
      EXECUTE format(
        'ALTER TABLE %I ADD PRIMARY KEY (organization_id,project_id,environment,bucket,entity_key)',
        t
      );
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN environment SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_environment_string_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (char_length(environment) BETWEEN 1 AND 64 AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$'')',
      t, t || '_environment_string_ck'
    );
  END LOOP;
END $$;

-- Derived alert and AI runtime facts may be organization-wide. A non-null
-- historical environment UUID, however, must have a trustworthy persisted SDK
-- environment string before the UUID column can be removed.
DO $$
DECLARE
  target_table TEXT;
  source_column TEXT;
  has_environment_id BOOLEAN;
  has_invalid BOOLEAN;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'alert_rule_executions',
    'alert_events',
    'alert_event_batches',
    'alert_event_history',
    'alert_acknowledgments',
    'alert_dead_letter_events',
    'alert_delivery_attempts',
    'alert_metrics',
    'alert_throttle_windows',
    'ai_requests',
    'ai_responses',
    'ai_jobs',
    'ai_cache',
    'ai_event_insights',
    'ai_evaluations',
    'ai_reports',
    'ai_usage_receipts',
    'ai_tool_calls',
    'ai_feedback'
  ] LOOP
    IF to_regclass(target_table) IS NULL THEN
      CONTINUE;
    END IF;

    source_column := CASE WHEN target_table LIKE 'alert_%' THEN 'payload' ELSE 'metadata' END;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', target_table);

    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM %I
         WHERE %I ? ''environment''
           AND (
             jsonb_typeof(%I -> ''environment'') <> ''string''
             OR char_length(btrim(%I ->> ''environment'')) NOT BETWEEN 1 AND 64
             OR btrim(%I ->> ''environment'') !~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$''
           )
       )',
      target_table,
      source_column,
      source_column,
      source_column,
      source_column
    ) INTO has_invalid;

    IF has_invalid THEN
      RAISE EXCEPTION '% contains an invalid persisted %.environment value', target_table, source_column;
    END IF;

    EXECUTE format(
      'UPDATE %I
       SET environment = btrim(%I ->> ''environment'')
       WHERE environment IS NULL AND %I ? ''environment''',
      target_table,
      source_column,
      source_column
    );

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = target_table
        AND column_name = 'environment_id'
    ) INTO has_environment_id;

    IF has_environment_id THEN
      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1 FROM %I
           WHERE environment_id IS NOT NULL AND environment IS NULL
         )',
        target_table
      ) INTO has_invalid;

      IF has_invalid THEN
        RAISE EXCEPTION '% has environment-scoped rows without a trustworthy SDK environment string', target_table;
      END IF;

      EXECUTE format('ALTER TABLE %I DROP COLUMN environment_id', target_table);
    END IF;

    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM %I
         WHERE environment IS NOT NULL
           AND (
             char_length(environment) NOT BETWEEN 1 AND 64
             OR environment !~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$''
           )
       )',
      target_table
    ) INTO has_invalid;

    IF has_invalid THEN
      RAISE EXCEPTION '% contains an invalid environment value', target_table;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      target_table,
      'ck_' || target_table || '_environment'
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (
         environment IS NULL OR (
           char_length(environment) BETWEEN 1 AND 64
           AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$''
         )
       )',
      target_table,
      'ck_' || target_table || '_environment'
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (project_id,environment,occurred_at DESC)',
      'idx_' || target_table || '_environment_time',
      target_table
    );
  END LOOP;
END $$;

-- Search documents are derived telemetry and use the same SDK environment
-- dimension. Existing rows may recover it only from their persisted facets.
DO $$
DECLARE
  t TEXT;
  has_environment_id BOOLEAN;
  invalid_rows BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY['log_search_index','trace_search_index','error_search_index'] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS environment TEXT', t);
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(environment)
       WHERE environment IS NOT NULL
         AND environment<>btrim(environment)
         AND char_length(btrim(environment)) BETWEEN 1 AND 64
         AND btrim(environment) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);
    EXECUTE format($sql$
      UPDATE %I
         SET environment=btrim(facets->>'environment')
       WHERE (
               environment IS NULL
               OR char_length(environment) NOT BETWEEN 1 AND 64
               OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
             )
         AND char_length(btrim(COALESCE(facets->>'environment',''))) BETWEEN 1 AND 64
         AND btrim(COALESCE(facets->>'environment','')) ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t);
    EXECUTE format($sql$
      SELECT count(*)
        FROM %I
       WHERE environment IS NULL
          OR char_length(environment) NOT BETWEEN 1 AND 64
          OR environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    $sql$, t) INTO invalid_rows;
    IF invalid_rows > 0 THEN
      RAISE EXCEPTION
        'Cannot migrate %: % search row(s) lack a trustworthy SDK environment string',
        t, invalid_rows
        USING HINT = 'Rebuild the search index from canonical typed events, then rerun the migration.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name=t AND column_name='environment_id'
    ) INTO has_environment_id;
    IF has_environment_id THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN environment_id', t);
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN environment SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_environment_string_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (char_length(environment) BETWEEN 1 AND 64 AND environment ~ ''^[A-Za-z0-9][A-Za-z0-9._-]*$'')',
      t, t || '_environment_string_ck'
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id,project_id,environment,occurred_at DESC)',
      'idx_' || t || '_tenant_env_time', t
    );
  END LOOP;
END $$;

COMMIT;

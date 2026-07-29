BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'events_requests',
    'events_errors',
    'events_logs',
    'events_metrics',
    'events_spans',
    'events_traces',
    'events_messages',
    'events_profiles',
    'events_replays',
    'events_cron_checkins'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        environment_id UUID,
        api_key_id UUID,
        event_id TEXT NOT NULL,
        trace_id TEXT,
        span_id TEXT,
        parent_span_id TEXT,
        session_id TEXT,
        user_id TEXT,
        service TEXT,
        endpoint TEXT,
        release TEXT,
        sdk_name TEXT,
        sdk_version TEXT,
        severity logdb_severity,
        status_code INTEGER,
        duration_ms NUMERIC(14,3),
        message TEXT,
        name TEXT,
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMPTZ NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, occurred_at)
      ) PARTITION BY RANGE (occurred_at)
    $sql$, table_name);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (organization_id, event_id, occurred_at)', 'idx_' || table_name || '_event_unique', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, project_id, occurred_at DESC)', 'idx_' || table_name || '_tenant_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (trace_id, occurred_at DESC) WHERE trace_id IS NOT NULL', 'idx_' || table_name || '_trace', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (service, occurred_at DESC) WHERE service IS NOT NULL', 'idx_' || table_name || '_service', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (attributes)', 'idx_' || table_name || '_attributes_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (payload)', 'idx_' || table_name || '_payload_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (occurred_at)', 'idx_' || table_name || '_occurred_brin', table_name);
  END LOOP;
END $$;

COMMENT ON TABLE events_requests IS 'Canonical request telemetry. Range partitions support time-window dashboards and retention pruning; tenant/time btree indexes support high-selectivity dashboard filters.';
COMMENT ON TABLE events_errors IS 'Canonical error telemetry. JSONB GIN indexes support issue triage filters; trace index joins errors to traces without cross-database constraints.';
COMMENT ON TABLE events_logs IS 'Canonical log telemetry. Append-heavy and range-partitioned by occurred_at for high write throughput.';

COMMIT;

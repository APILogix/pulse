BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'connector_deliveries',
    'connector_delivery_attempts',
    'connector_health_checks',
    'connector_test_runs',
    'connector_audit_logs'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        connector_id UUID,
        route_id UUID,
        status logdb_delivery_status,
        event_type TEXT,
        request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        response_payload JSONB,
        status_code INTEGER,
        error_message TEXT,
        latency_ms INTEGER,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, occurred_at)
      ) PARTITION BY RANGE (occurred_at)
    $sql$, table_name);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, connector_id, occurred_at DESC)', 'idx_' || table_name || '_connector_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (status, occurred_at DESC)', 'idx_' || table_name || '_status_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (request_payload)', 'idx_' || table_name || '_request_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (occurred_at)', 'idx_' || table_name || '_occurred_brin', table_name);
  END LOOP;
END $$;

COMMIT;

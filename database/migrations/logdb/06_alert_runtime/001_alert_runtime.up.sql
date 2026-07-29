BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'alert_rule_executions',
    'alert_events',
    'alert_event_batches',
    'alert_event_history',
    'alert_acknowledgments',
    'alert_dead_letter_events',
    'alert_delivery_attempts',
    'alert_metrics',
    'alert_throttle_windows'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        environment_id UUID,
        rule_id UUID,
        event_id UUID,
        batch_id UUID,
        severity logdb_severity,
        status TEXT,
        action TEXT,
        actor_user_id UUID,
        metric_name TEXT,
        metric_value NUMERIC(20,6),
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_message TEXT,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, occurred_at)
      ) PARTITION BY RANGE (occurred_at)
    $sql$, table_name);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, rule_id, occurred_at DESC)', 'idx_' || table_name || '_rule_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (status, occurred_at DESC) WHERE status IS NOT NULL', 'idx_' || table_name || '_status_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (payload)', 'idx_' || table_name || '_payload_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (occurred_at)', 'idx_' || table_name || '_occurred_brin', table_name);
  END LOOP;
END $$;

COMMENT ON TABLE alert_rule_executions IS 'Alert worker execution log. rule_id is an identifier only, never a foreign key to primary alert rules.';
COMMENT ON TABLE alert_delivery_attempts IS 'Alert notification delivery attempts. Range partitions support retention and retry dashboard queries.';

COMMIT;

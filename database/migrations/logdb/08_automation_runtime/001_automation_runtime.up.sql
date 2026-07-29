BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'automation_runs',
    'automation_run_steps',
    'automation_events_inbox',
    'automation_audit_logs'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        workflow_id UUID,
        run_id UUID,
        step_id UUID,
        actor_user_id UUID,
        status logdb_job_state,
        event_type TEXT,
        dedupe_key TEXT,
        input JSONB NOT NULL DEFAULT '{}'::jsonb,
        output JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_message TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, started_at)
      ) PARTITION BY RANGE (started_at)
    $sql$, table_name);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, workflow_id, started_at DESC)', 'idx_' || table_name || '_workflow_time', table_name);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (dedupe_key, started_at) WHERE dedupe_key IS NOT NULL', 'idx_' || table_name || '_dedupe', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (input)', 'idx_' || table_name || '_input_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (started_at)', 'idx_' || table_name || '_started_brin', table_name);
  END LOOP;
END $$;

COMMIT;

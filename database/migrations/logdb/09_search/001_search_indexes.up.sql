BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['log_search_index', 'trace_search_index', 'error_search_index'] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        environment TEXT NOT NULL,
        source_event_id UUID,
        source_table TEXT NOT NULL,
        search_text TEXT NOT NULL,
        facets JSONB NOT NULL DEFAULT '{}'::jsonb,
        embedding REAL[],
        occurred_at TIMESTAMPTZ NOT NULL,
        indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, occurred_at),
        CONSTRAINT %I CHECK (
          char_length(environment) BETWEEN 1 AND 64
          AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
        )
      ) PARTITION BY RANGE (occurred_at)
    $sql$, table_name, table_name || '_environment_string_ck');
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (to_tsvector(''english'', search_text))', 'idx_' || table_name || '_text_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (facets)', 'idx_' || table_name || '_facets_gin', table_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id,project_id,environment,occurred_at DESC)',
      'idx_' || table_name || '_tenant_env_time', table_name
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (occurred_at)', 'idx_' || table_name || '_occurred_brin', table_name);
  END LOOP;
END $$;

COMMIT;

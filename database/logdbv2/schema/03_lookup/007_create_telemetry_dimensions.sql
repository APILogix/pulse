-- Telemetry dimensions lookup reference tables
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'telemetry_dimensions_service',
    'telemetry_dimensions_endpoint',
    'telemetry_dimensions_release',
    'telemetry_dimensions_browser',
    'telemetry_dimensions_host',
    'telemetry_dimensions_os',
    'telemetry_dimensions_runtime',
    'telemetry_dimensions_region'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        dimension_key TEXT NOT NULL,
        display_name TEXT,
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, project_id, dimension_key)
      )
    $sql$, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, last_seen_at DESC)', 'idx_' || table_name || '_last_seen', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (attributes)', 'idx_' || table_name || '_attrs_gin', table_name);
  END LOOP;
END $$;

BEGIN;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'spans',
    'traces',
    'metrics',
    'logs',
    'profiles',
    'cron_checkins',
    'replays',
    'messages',
    'sdk_sessions',
    'errors',
    'requests'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        environment_id UUID,
        api_key_id UUID,
        trace_id TEXT,
        span_id TEXT,
        name TEXT,
        message TEXT,
        service TEXT,
        status TEXT,
        duration_ms NUMERIC(14,3),
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, timestamp)
      ) PARTITION BY RANGE (timestamp)
    $sql$, table_name);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, timestamp DESC)', 'idx_' || table_name || '_org_time', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (trace_id, timestamp DESC) WHERE trace_id IS NOT NULL', 'idx_' || table_name || '_trace', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (attributes)', 'idx_' || table_name || '_attrs_gin', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (timestamp)', 'idx_' || table_name || '_timestamp_brin', table_name);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unresolved',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_error_groups_last_seen ON error_groups(organization_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_metadata_gin ON error_groups USING GIN (metadata);
DROP TRIGGER IF EXISTS trg_error_groups_updated_at ON error_groups;
CREATE TRIGGER trg_error_groups_updated_at BEFORE UPDATE ON error_groups FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

COMMIT;

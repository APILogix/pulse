BEGIN;

-- Creates:
-- organization_usage_minute, organization_usage_hourly, organization_usage_daily,
-- project_usage_minute, project_usage_hourly, project_usage_daily,
-- environment_usage_minute, environment_usage_hourly, environment_usage_daily,
-- api_key_usage_minute, api_key_usage_hourly, api_key_usage_daily.
-- These tables are generated from scope/grain loops to keep columns, indexes,
-- and partitioning policy identical across tenant usage levels.

DO $$
DECLARE
  scope_name TEXT;
  grain_name TEXT;
  table_name TEXT;
  bucket_type TEXT;
BEGIN
  FOREACH scope_name IN ARRAY ARRAY['organization', 'project', 'environment', 'api_key'] LOOP
    FOREACH grain_name IN ARRAY ARRAY['minute', 'hourly', 'daily'] LOOP
      table_name := format('%s_usage_%s', scope_name, grain_name);
      bucket_type := CASE WHEN grain_name = 'daily' THEN 'DATE' ELSE 'TIMESTAMPTZ' END;

      EXECUTE format($sql$
        CREATE TABLE IF NOT EXISTS %I (
          organization_id UUID NOT NULL,
          project_id UUID,
          environment_id UUID,
          api_key_id UUID,
          bucket %s NOT NULL,
          total_events BIGINT NOT NULL DEFAULT 0 CHECK (total_events >= 0),
          accepted_events BIGINT NOT NULL DEFAULT 0 CHECK (accepted_events >= 0),
          rejected_events BIGINT NOT NULL DEFAULT 0 CHECK (rejected_events >= 0),
          request_count BIGINT NOT NULL DEFAULT 0 CHECK (request_count >= 0),
          error_count BIGINT NOT NULL DEFAULT 0 CHECK (error_count >= 0),
          span_count BIGINT NOT NULL DEFAULT 0 CHECK (span_count >= 0),
          log_count BIGINT NOT NULL DEFAULT 0 CHECK (log_count >= 0),
          metric_count BIGINT NOT NULL DEFAULT 0 CHECK (metric_count >= 0),
          profile_count BIGINT NOT NULL DEFAULT 0 CHECK (profile_count >= 0),
          replay_count BIGINT NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
          message_count BIGINT NOT NULL DEFAULT 0 CHECK (message_count >= 0),
          bytes_ingested BIGINT NOT NULL DEFAULT 0 CHECK (bytes_ingested >= 0),
          bytes_stored BIGINT NOT NULL DEFAULT 0 CHECK (bytes_stored >= 0),
          p50_latency_ms NUMERIC(12,3),
          p95_latency_ms NUMERIC(12,3),
          p99_latency_ms NUMERIC(12,3),
          dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (%s bucket)
        ) PARTITION BY RANGE (bucket)
      $sql$, table_name, bucket_type,
        CASE scope_name
          WHEN 'organization' THEN 'organization_id,'
          WHEN 'project' THEN 'organization_id,project_id,'
          WHEN 'environment' THEN 'organization_id,project_id,environment_id,'
          ELSE 'organization_id,project_id,environment_id,api_key_id,'
        END);

      EXECUTE format('CREATE TABLE IF NOT EXISTS %I_default PARTITION OF %I DEFAULT', table_name, table_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, bucket DESC)', 'idx_' || table_name || '_org_bucket', table_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (bucket)', 'idx_' || table_name || '_bucket_brin', table_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (dimensions)', 'idx_' || table_name || '_dimensions_gin', table_name);
    END LOOP;
  END LOOP;
END $$;

COMMENT ON TABLE organization_usage_minute IS 'Minute tenant usage counters. UPSERT target for ingestion workers and source for hourly rollups.';
COMMENT ON TABLE project_usage_minute IS 'Minute project usage counters partitioned by bucket for dashboard filters and retention pruning.';
COMMENT ON TABLE environment_usage_minute IS 'Minute environment usage counters used by environment-scoped dashboards and SDK config observability.';
COMMENT ON TABLE api_key_usage_minute IS 'Minute API key usage counters used for rate-limit and billing attribution without foreign keys to primary DB keys.';

COMMIT;

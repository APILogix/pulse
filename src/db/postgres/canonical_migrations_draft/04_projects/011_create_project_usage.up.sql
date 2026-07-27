BEGIN;

DROP VIEW IF EXISTS project_usage_realtime;
DO $$
BEGIN
  IF to_regclass('public.project_usage_hourly') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_usage_hourly' AND column_name='bucket_hour')
     AND to_regclass('public.project_usage_hourly_legacy') IS NULL THEN
    ALTER TABLE project_usage_hourly RENAME TO project_usage_hourly_legacy;
  END IF;
  IF to_regclass('public.project_usage_daily') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_usage_daily' AND column_name='bucket_date')
     AND to_regclass('public.project_usage_daily_legacy') IS NULL THEN
    ALTER TABLE project_usage_daily RENAME TO project_usage_daily_legacy;
  END IF;
  IF to_regclass('public.project_usage') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_usage' AND column_name='counter_type')
     AND to_regclass('public.project_usage_counter_legacy') IS NULL THEN
    ALTER TABLE project_usage RENAME TO project_usage_counter_legacy;
  END IF;
END $$;
DO $$
BEGIN
  IF to_regclass('public.project_usage_hourly_legacy') IS NOT NULL THEN
    ALTER TABLE project_usage_hourly_legacy DROP CONSTRAINT IF EXISTS project_usage_hourly_pkey;
  END IF;
  IF to_regclass('public.project_usage_daily_legacy') IS NOT NULL THEN
    ALTER TABLE project_usage_daily_legacy DROP CONSTRAINT IF EXISTS project_usage_daily_pkey;
  END IF;
END $$;
DROP INDEX IF EXISTS idx_usage_hourly_project_bucket;
DROP INDEX IF EXISTS idx_usage_hourly_org_bucket;
DROP INDEX IF EXISTS idx_usage_daily_project_date;
DROP INDEX IF EXISTS idx_usage_daily_org_date;

DO $$
DECLARE suffix TEXT; table_name TEXT;
BEGIN
  FOREACH suffix IN ARRAY ARRAY['minute','hourly','daily'] LOOP
    table_name := 'project_usage_' || suffix;
    EXECUTE format($ddl$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        environment_id UUID REFERENCES project_environments(id) ON DELETE CASCADE,
        api_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
        bucket TIMESTAMPTZ NOT NULL,
        total_events BIGINT NOT NULL DEFAULT 0,
        errors BIGINT NOT NULL DEFAULT 0,
        requests BIGINT NOT NULL DEFAULT 0,
        transactions BIGINT NOT NULL DEFAULT 0,
        traces BIGINT NOT NULL DEFAULT 0,
        spans BIGINT NOT NULL DEFAULT 0,
        logs BIGINT NOT NULL DEFAULT 0,
        metrics BIGINT NOT NULL DEFAULT 0,
        profiles BIGINT NOT NULL DEFAULT 0,
        ai_events BIGINT NOT NULL DEFAULT 0,
        sdk_requests BIGINT NOT NULL DEFAULT 0,
        active_api_keys INTEGER NOT NULL DEFAULT 0,
        active_environments INTEGER NOT NULL DEFAULT 0,
        active_users BIGINT NOT NULL DEFAULT 0,
        active_members INTEGER NOT NULL DEFAULT 0,
        alert_count BIGINT NOT NULL DEFAULT 0,
        connector_deliveries BIGINT NOT NULL DEFAULT 0,
        failed_notifications BIGINT NOT NULL DEFAULT 0,
        top_endpoints JSONB NOT NULL DEFAULT '[]'::jsonb,
        top_services JSONB NOT NULL DEFAULT '[]'::jsonb,
        top_error_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
        top_sdk_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
        top_countries JSONB NOT NULL DEFAULT '[]'::jsonb,
        top_browsers JSONB NOT NULL DEFAULT '[]'::jsonb,
        top_os JSONB NOT NULL DEFAULT '[]'::jsonb,
        top_devices JSONB NOT NULL DEFAULT '[]'::jsonb,
        top_releases JSONB NOT NULL DEFAULT '[]'::jsonb,
        rate_limit_usage NUMERIC(12,5) NOT NULL DEFAULT 0,
        latency_ms_p50 NUMERIC(12,3),
        latency_ms_p95 NUMERIC(12,3),
        latency_ms_p99 NUMERIC(12,3),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT %I CHECK (total_events>=0 AND errors>=0 AND requests>=0 AND transactions>=0 AND traces>=0 AND spans>=0 AND logs>=0 AND metrics>=0 AND profiles>=0 AND ai_events>=0 AND sdk_requests>=0)
      )
    $ddl$, table_name, table_name || '_nonnegative');
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (organization_id,project_id,environment_id,api_key_id,bucket) NULLS NOT DISTINCT', 'uq_'||table_name||'_dimensions', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (project_id,bucket DESC)', 'idx_'||table_name||'_project_bucket', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id,bucket DESC)', 'idx_'||table_name||'_org_bucket', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (environment_id,bucket DESC) WHERE environment_id IS NOT NULL', 'idx_'||table_name||'_env_bucket', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (api_key_id,bucket DESC) WHERE api_key_id IS NOT NULL', 'idx_'||table_name||'_key_bucket', table_name);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS project_usage_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  year_month DATE NOT NULL CHECK (year_month=date_trunc('month',year_month)::date),
  total_events BIGINT NOT NULL DEFAULT 0 CHECK(total_events>=0),
  total_bytes BIGINT NOT NULL DEFAULT 0 CHECK(total_bytes>=0),
  api_key_requests BIGINT NOT NULL DEFAULT 0 CHECK(api_key_requests>=0),
  rate_limited_events BIGINT NOT NULL DEFAULT 0 CHECK(rate_limited_events>=0),
  alert_notifications BIGINT NOT NULL DEFAULT 0 CHECK(alert_notifications>=0),
  active_users BIGINT NOT NULL DEFAULT 0 CHECK(active_users>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,year_month)
);
CREATE INDEX IF NOT EXISTS idx_project_usage_monthly_org ON project_usage_monthly(organization_id,year_month DESC);

CREATE TABLE IF NOT EXISTS project_usage_current (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL DEFAULT date_trunc('month',CURRENT_DATE)::date,
  total_events BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  requests BIGINT NOT NULL DEFAULT 0,
  traces BIGINT NOT NULL DEFAULT 0,
  logs BIGINT NOT NULL DEFAULT 0,
  metrics BIGINT NOT NULL DEFAULT 0,
  profiles BIGINT NOT NULL DEFAULT 0,
  alert_count BIGINT NOT NULL DEFAULT 0,
  connector_deliveries BIGINT NOT NULL DEFAULT 0,
  failed_notifications BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO project_usage_current(project_id,organization_id)
SELECT id,org_id FROM projects ON CONFLICT(project_id) DO UPDATE SET organization_id=EXCLUDED.organization_id;

DO $$
BEGIN
  IF to_regclass('public.project_usage_hourly_legacy') IS NOT NULL THEN
    EXECUTE $sql$INSERT INTO project_usage_hourly(organization_id,project_id,bucket,total_events,created_at,updated_at)
      SELECT organization_id,project_id,bucket_hour,SUM(event_count),MIN(COALESCE(created_at,NOW())),NOW()
      FROM project_usage_hourly_legacy GROUP BY organization_id,project_id,bucket_hour ON CONFLICT DO NOTHING$sql$;
    EXECUTE $sql$INSERT INTO project_usage_monthly(organization_id,project_id,year_month,total_events,total_bytes)
      SELECT organization_id,project_id,date_trunc('month',bucket_hour)::date,SUM(event_count),SUM(event_bytes)
      FROM project_usage_hourly_legacy GROUP BY organization_id,project_id,date_trunc('month',bucket_hour)::date ON CONFLICT(project_id,year_month) DO NOTHING$sql$;
  END IF;
  IF to_regclass('public.project_usage_daily_legacy') IS NOT NULL THEN
    EXECUTE $sql$INSERT INTO project_usage_daily(organization_id,project_id,bucket,total_events,created_at,updated_at)
      SELECT organization_id,project_id,bucket_date::timestamptz,SUM(total_events),MIN(COALESCE(created_at,NOW())),NOW()
      FROM project_usage_daily_legacy GROUP BY organization_id,project_id,bucket_date ON CONFLICT DO NOTHING$sql$;
  END IF;
  IF to_regclass('public.project_usage_counter_legacy') IS NOT NULL THEN
    EXECUTE $sql$INSERT INTO project_usage_hourly(organization_id,project_id,bucket,total_events,errors,requests,updated_at)
      SELECT org_id,project_id,period_start,
        COALESCE(SUM(value) FILTER(WHERE counter_type IN ('events','event','total_events')),0),
        COALESCE(SUM(value) FILTER(WHERE counter_type IN ('errors','error')),0),
        COALESCE(SUM(value) FILTER(WHERE counter_type IN ('requests','request')),0),
        NOW() FROM project_usage_counter_legacy GROUP BY org_id,project_id,period_start ON CONFLICT DO NOTHING$sql$;
  END IF;
END $$;
DROP TABLE IF EXISTS project_usage_hourly_legacy CASCADE;
DROP TABLE IF EXISTS project_usage_daily_legacy CASCADE;
DROP TABLE IF EXISTS project_usage_counter_legacy CASCADE;
DROP TABLE IF EXISTS project_usage CASCADE;

COMMENT ON TABLE project_usage_minute IS 'Canonical project minute rollups for near-real-time graphs and heatmaps.';
COMMENT ON TABLE project_usage_hourly IS 'Canonical project hourly rollups for graphs, heatmaps, and dimension comparisons.';
COMMENT ON TABLE project_usage_daily IS 'Canonical project daily rollups for calendar heatmaps and top-dimension reporting.';
COMMENT ON TABLE project_usage_monthly IS 'Canonical monthly project totals for billing and plan comparisons.';
COMMENT ON TABLE project_usage_current IS 'Current-period dashboard seed and summary for every project.';
COMMIT;

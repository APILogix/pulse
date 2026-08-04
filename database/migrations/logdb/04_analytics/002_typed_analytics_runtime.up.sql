BEGIN;

-- Columns consumed by inline error grouping and the event-analytics API. Event
-- facts remain in the dedicated Log DB; no control-plane foreign keys are used.
ALTER TABLE analytics_error_groups
  ALTER COLUMN title SET DEFAULT 'Unknown error',
  ADD COLUMN IF NOT EXISTS error_name TEXT,
  ADD COLUMN IF NOT EXISTS message_template TEXT,
  ADD COLUMN IF NOT EXISTS total_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS today_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS week_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS month_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS services TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS environments TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS releases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_to UUID,
  ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID;

ALTER TABLE analytics_error_groups
  DROP CONSTRAINT IF EXISTS analytics_error_groups_priority_ck,
  ADD CONSTRAINT analytics_error_groups_priority_ck CHECK (priority BETWEEN 1 AND 5);

ALTER TABLE analytics_user_sessions
  ADD COLUMN IF NOT EXISTS is_crashed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE analytics_performance_summary
  ADD COLUMN IF NOT EXISTS bucket_date DATE,
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS method TEXT,
  ADD COLUMN IF NOT EXISTS error_rate NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS apdex_score NUMERIC(8,6);


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='analytics_alert_operator') THEN
    CREATE TYPE analytics_alert_operator AS ENUM ('gt','gte','lt','lte','eq','neq');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  layout JSONB NOT NULL DEFAULT '{}',
  widgets JSONB NOT NULL DEFAULT '[]',
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  shared_token VARCHAR(64),
  created_by UUID NOT NULL,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_logdb_dashboards_org ON analytics_dashboards(organization_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_logdb_dashboards_updated_at ON analytics_dashboards;
CREATE TRIGGER trg_logdb_dashboards_updated_at BEFORE UPDATE ON analytics_dashboards FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS analytics_saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  query_type VARCHAR(50) NOT NULL,
  query_config JSONB NOT NULL,
  visualization_type VARCHAR(50),
  visualization_config JSONB NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_logdb_saved_queries_org ON analytics_saved_queries(organization_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_logdb_saved_queries_updated_at ON analytics_saved_queries;
CREATE TRIGGER trg_logdb_saved_queries_updated_at BEFORE UPDATE ON analytics_saved_queries FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS analytics_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  metric VARCHAR(100) NOT NULL,
  operator analytics_alert_operator NOT NULL,
  threshold NUMERIC NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  notification_channels JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_logdb_analytics_alerts_org ON analytics_alerts(organization_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_logdb_analytics_alerts_updated_at ON analytics_alerts;
CREATE TRIGGER trg_logdb_analytics_alerts_updated_at BEFORE UPDATE ON analytics_alerts FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

COMMIT;

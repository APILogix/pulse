BEGIN;

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  layout JSONB DEFAULT '{}',
  widgets JSONB DEFAULT '[]',
  is_shared BOOLEAN DEFAULT FALSE,
  shared_token VARCHAR(64),
  created_by UUID NOT NULL,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS analytics_saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  query_type VARCHAR(50) NOT NULL,
  query_config JSONB NOT NULL,
  visualization_type VARCHAR(50),
  visualization_config JSONB DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS analytics_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  metric VARCHAR(100) NOT NULL,
  operator analytics_alert_operator NOT NULL,
  threshold NUMERIC NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  notification_channels JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dashboards_org
  ON analytics_dashboards(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saved_queries_org
  ON analytics_saved_queries(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org
  ON analytics_alerts(organization_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_dashboards_updated_at ON analytics_dashboards;
CREATE TRIGGER trg_dashboards_updated_at
  BEFORE UPDATE ON analytics_dashboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_saved_queries_updated_at ON analytics_saved_queries;
CREATE TRIGGER trg_saved_queries_updated_at
  BEFORE UPDATE ON analytics_saved_queries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_analytics_alerts_updated_at ON analytics_alerts;
CREATE TRIGGER trg_analytics_alerts_updated_at
  BEFORE UPDATE ON analytics_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;

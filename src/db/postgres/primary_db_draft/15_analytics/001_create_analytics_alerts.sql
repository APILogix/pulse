-- Normalized final definition for analytics_alerts.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/15_analytics/006_create_analytics_config_tables.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

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

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org
  ON analytics_alerts(organization_id)
  WHERE deleted_at IS NULL;

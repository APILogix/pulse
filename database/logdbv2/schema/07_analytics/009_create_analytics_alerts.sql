-- Analytics threshold alert rules and evaluation metadata
CREATE TABLE IF NOT EXISTS analytics_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  operator analytics_alert_operator NOT NULL,
  threshold NUMERIC(20,6) NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  last_evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org ON analytics_alerts(organization_id, project_id);

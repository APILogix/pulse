-- Alert Rules & Conditions Schema
-- File: 09_alerting/001_alert_rules_conditions.sql

CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  severity alert_severity NOT NULL DEFAULT 'warning',
  status alert_status NOT NULL DEFAULT 'pending',
  evaluation_window_seconds INT NOT NULL DEFAULT 300,
  retrigger_interval_seconds INT NOT NULL DEFAULT 3600,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  scope_type alert_scope_type NOT NULL DEFAULT 'project',
  scope_target VARCHAR(255),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  metric_name VARCHAR(128) NOT NULL,
  condition_type alert_condition_type NOT NULL DEFAULT 'threshold',
  operator alert_condition_operator NOT NULL DEFAULT 'gt',
  threshold_value NUMERIC NOT NULL,
  granularity metric_granularity NOT NULL DEFAULT '1m',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

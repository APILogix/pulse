BEGIN;

CREATE TABLE IF NOT EXISTS alerting_settings (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  default_evaluation_window_seconds INTEGER NOT NULL DEFAULT 300 CHECK (default_evaluation_window_seconds > 0),
  default_cooldown_seconds INTEGER NOT NULL DEFAULT 900 CHECK (default_cooldown_seconds >= 0),
  retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days > 0),
  default_severity alert_severity NOT NULL DEFAULT 'warning',
  default_routing_key VARCHAR(100) NOT NULL DEFAULT 'severity_default',
  default_escalation_policy_id UUID REFERENCES alerting_escalation_policies_v2(id) ON DELETE SET NULL,
  maximum_incident_age_seconds INTEGER NOT NULL DEFAULT 604800 CHECK (maximum_incident_age_seconds > 0),
  digest_defaults JSONB NOT NULL DEFAULT '{"enabled":true,"frequency":"daily"}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_settings_digest_defaults CHECK (jsonb_typeof(digest_defaults) = 'object')
);

CREATE TABLE IF NOT EXISTS alerting_maintenance_config (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  suppression_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recurring_support_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_suppression_settings JSONB NOT NULL DEFAULT '{"suppressNotifications":true,"suppressEvaluation":false}'::jsonb,
  calendar_metadata JSONB NOT NULL DEFAULT '{"windows":[]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_maintenance_suppression CHECK (jsonb_typeof(default_suppression_settings) = 'object'),
  CONSTRAINT ck_alerting_maintenance_calendar CHECK (jsonb_typeof(calendar_metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS alerting_notification_defaults (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  business_hours JSONB NOT NULL DEFAULT '{"enabled":true,"start":"09:00","end":"17:00","days":[1,2,3,4,5]}'::jsonb,
  quiet_hours JSONB NOT NULL DEFAULT '{"enabled":false,"start":"22:00","end":"07:00"}'::jsonb,
  fallback_behavior VARCHAR(30) NOT NULL DEFAULT 'dashboard'
    CHECK (fallback_behavior IN ('dashboard', 'email', 'drop')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_notification_business_hours CHECK (jsonb_typeof(business_hours) = 'object'),
  CONSTRAINT ck_alerting_notification_quiet_hours CHECK (jsonb_typeof(quiet_hours) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_settings_escalation
  ON alerting_settings(default_escalation_policy_id)
  WHERE default_escalation_policy_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alerting_settings_updated_at ON alerting_settings;
CREATE TRIGGER trg_alerting_settings_updated_at
  BEFORE UPDATE ON alerting_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_maintenance_config_updated_at ON alerting_maintenance_config;
CREATE TRIGGER trg_alerting_maintenance_config_updated_at
  BEFORE UPDATE ON alerting_maintenance_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_notification_defaults_updated_at ON alerting_notification_defaults;
CREATE TRIGGER trg_alerting_notification_defaults_updated_at
  BEFORE UPDATE ON alerting_notification_defaults
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE alerting_maintenance_config IS
  'Maintenance configuration metadata only. No maintenance windows are created at workspace provisioning.';

COMMIT;

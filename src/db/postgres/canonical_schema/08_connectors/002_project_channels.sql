-- Project Alert Channels & Subscriptions Schema
-- File: 08_connectors/002_project_channels.sql

CREATE TABLE IF NOT EXISTS project_alert_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_config_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  target_destination TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  min_severity alert_severity NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_connector_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  alert_channel_id UUID NOT NULL REFERENCES project_alert_channels(id) ON DELETE CASCADE,
  event_type VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_member_alert_channel_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_channel_id UUID NOT NULL REFERENCES project_alert_channels(id) ON DELETE CASCADE,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_proj_user_channel UNIQUE (project_id, user_id, alert_channel_id)
);

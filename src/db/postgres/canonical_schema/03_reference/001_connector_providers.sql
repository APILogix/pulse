-- Reference Table: Connector Providers
-- File: 03_reference/001_connector_providers.sql

CREATE TABLE IF NOT EXISTS connector_providers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT 'notification',
  auth_type VARCHAR(64) NOT NULL DEFAULT 'webhook',
  is_active BOOLEAN NOT NULL DEFAULT true,
  config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  icon_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the 7 active runtime connector providers
INSERT INTO connector_providers (id, name, category, auth_type, is_active, config_schema)
VALUES
  ('slack', 'Slack', 'chat', 'oauth2', true, '{"required":["webhook_url"]}'::jsonb),
  ('pagerduty', 'PagerDuty', 'incident', 'api_key', true, '{"required":["routing_key"]}'::jsonb),
  ('webhook', 'Custom Webhook', 'webhook', 'custom', true, '{"required":["url"]}'::jsonb),
  ('email', 'Email Outbox', 'email', 'smtp', true, '{"required":["recipients"]}'::jsonb),
  ('teams', 'Microsoft Teams', 'chat', 'webhook', true, '{"required":["webhook_url"]}'::jsonb),
  ('opsgenie', 'OpsGenie', 'incident', 'api_key', true, '{"required":["api_key"]}'::jsonb),
  ('discord', 'Discord', 'chat', 'webhook', true, '{"required":["webhook_url"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  auth_type = EXCLUDED.auth_type,
  config_schema = EXCLUDED.config_schema,
  updated_at = NOW();

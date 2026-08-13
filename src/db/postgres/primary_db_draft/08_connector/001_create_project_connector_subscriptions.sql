-- Normalized final definition for project_connector_subscriptions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
-- - migrations/003_project_module_refactor.sql
-- - canonical_migrations_draft/06_connectors/014_link_project_routing.up.sql

CREATE TABLE IF NOT EXISTS project_connector_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  alert_categories alert_category[] NOT NULL DEFAULT ARRAY['error','performance','security']::alert_category[],
  severity_threshold severity_threshold NOT NULL DEFAULT 'error',
  member_ids UUID[] NOT NULL DEFAULT '{}',
  channel_overrides JSONB NOT NULL DEFAULT '{}',
  quiet_hours JSONB,
  digest_mode JSONB,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (project_id, connector_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_connector_subscription ON project_connector_subscriptions(project_id,connector_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_connector_subscriptions_route ON project_connector_subscriptions(organization_id,project_id,enabled,severity_threshold) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_connector_subs_project
  ON project_connector_subscriptions(project_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_connector_subs_connector
  ON project_connector_subscriptions(connector_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_connector_subs_enabled
  ON project_connector_subscriptions(project_id, enabled)
  WHERE enabled = TRUE AND deleted_at IS NULL;

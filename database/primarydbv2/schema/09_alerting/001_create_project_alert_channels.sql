-- Normalized final definition for project_alert_channels.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
-- - canonical_migrations_draft/06_connectors/014_link_project_routing.up.sql

CREATE TABLE IF NOT EXISTS project_alert_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connector_id UUID,
  channel_type VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  destination TEXT,
  destination_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_project_alert_channels_active ON project_alert_channels(organization_id,project_id,channel_type) WHERE enabled AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_alert_channel_default ON project_alert_channels(project_id,channel_type) WHERE is_default AND enabled AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_alert_channels_org_proj_enabled
  ON project_alert_channels (organization_id, project_id, enabled)
  WHERE deleted_at IS NULL;


-- Normalized final definition for alerting_audit_events.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql

CREATE TABLE IF NOT EXISTS alerting_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  actor_type VARCHAR(30) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provisioning_version VARCHAR(100),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_audit_payload CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_audit_events_workspace_time
  ON alerting_audit_events(workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_alerting_audit_events_org_entity
  ON alerting_audit_events(organization_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerting_audit_events_type
  ON alerting_audit_events(organization_id, event_type, created_at DESC);

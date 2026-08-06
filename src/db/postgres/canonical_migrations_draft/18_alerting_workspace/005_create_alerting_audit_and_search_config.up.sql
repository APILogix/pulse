BEGIN;

CREATE TABLE IF NOT EXISTS alerting_audit_roots (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  root_version INTEGER NOT NULL DEFAULT 1 CHECK (root_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS alerting_search_index_metadata (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  enabled_entities JSONB NOT NULL DEFAULT '{"policies":true,"incidents":false,"events":false}'::jsonb,
  last_rebuild_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_search_entities CHECK (jsonb_typeof(enabled_entities) = 'object')
);

DROP TRIGGER IF EXISTS trg_alerting_audit_roots_updated_at ON alerting_audit_roots;
CREATE TRIGGER trg_alerting_audit_roots_updated_at
  BEFORE UPDATE ON alerting_audit_roots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_search_index_metadata_updated_at ON alerting_search_index_metadata;
CREATE TRIGGER trg_alerting_search_index_metadata_updated_at
  BEFORE UPDATE ON alerting_search_index_metadata
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE alerting_search_index_metadata IS
  'Search configuration only. No incident or event documents are indexed during provisioning.';

COMMIT;

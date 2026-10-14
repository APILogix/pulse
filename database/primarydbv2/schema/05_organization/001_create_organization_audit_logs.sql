-- Normalized final definition for organization_audit_logs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/006_create_organization_audit_logs.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email VARCHAR(255),
  actor_ip INET,
  actor_user_agent TEXT,
  actor_session_id UUID,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  entity_name VARCHAR(255),
  request_id UUID,
  correlation_id UUID,
  http_method VARCHAR(10),
  endpoint TEXT,
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failure')),
  failure_reason TEXT,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project_id UUID
);

CREATE INDEX IF NOT EXISTS idx_org_audit_org_created
  ON organization_audit_logs(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_audit_project_created
  ON organization_audit_logs(org_id, project_id, created_at DESC, id DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_audit_actor
  ON organization_audit_logs(actor_user_id);

CREATE INDEX IF NOT EXISTS idx_org_audit_entity
  ON organization_audit_logs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_org_audit_action
  ON organization_audit_logs(org_id, action);

CREATE INDEX IF NOT EXISTS idx_org_audit_sensitive
  ON organization_audit_logs(org_id, is_sensitive)
  WHERE is_sensitive = TRUE;

CREATE INDEX IF NOT EXISTS idx_org_audit_metadata_gin
  ON organization_audit_logs USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_org_audit_logs_purge
  ON organization_audit_logs (org_id, is_sensitive, created_at)
  WHERE is_sensitive = FALSE;


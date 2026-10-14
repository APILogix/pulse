-- Normalized final definition for connector_audit_logs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_type VARCHAR(50),
  previous_state JSONB,
  new_state JSONB,
  changes_summary JSONB,
  ip_address INET,
  user_agent TEXT,
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_audit_org_created
ON connector_audit_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_connector_created
ON connector_audit_logs (connector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor
ON connector_audit_logs (actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_changes_gin
ON connector_audit_logs
USING GIN (changes_summary);

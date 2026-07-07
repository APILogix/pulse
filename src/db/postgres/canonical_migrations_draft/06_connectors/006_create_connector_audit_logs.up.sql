BEGIN;

CREATE TABLE IF NOT EXISTS connector_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(50) NOT NULL DEFAULT 'user',
  previous_state JSONB,
  new_state JSONB,
  changes_summary JSONB,
  ip_address INET,
  user_agent TEXT,
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_org
  ON connector_audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_connector
  ON connector_audit_logs(connector_id, created_at DESC);

COMMIT;

BEGIN;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(32) DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_audit_logs_org
  ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project
  ON audit_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_type_id_time
  ON audit_logs(actor_type, actor_id, created_at DESC)
  WHERE actor_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_time_brin
  ON audit_logs USING BRIN (created_at);

COMMIT;

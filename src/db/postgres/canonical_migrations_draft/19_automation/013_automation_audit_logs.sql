-- =============================================================================
-- Module      : Automation
-- Migration   : 013_automation_audit_logs.sql
-- Description : Immutable automation audit trail
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS automation_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  workflow_id UUID NULL REFERENCES automation_workflows(id) ON DELETE SET NULL,
  run_id UUID NULL REFERENCES automation_runs(id) ON DELETE SET NULL,
  step_id UUID NULL REFERENCES automation_run_steps(id) ON DELETE SET NULL,
  approval_id UUID NULL REFERENCES automation_approvals(id) ON DELETE SET NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(40) NOT NULL DEFAULT 'user',
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id UUID,
  request_id VARCHAR(100),
  ip_address INET,
  user_agent TEXT,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_audit_org
  ON automation_audit_logs(organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_workflow
  ON automation_audit_logs(workflow_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_run
  ON automation_audit_logs(run_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_action
  ON automation_audit_logs(action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_actor
  ON automation_audit_logs(actor_user_id, occurred_at DESC);

-- BRIN on occurred_at for range scans on append-heavy table
CREATE INDEX IF NOT EXISTS idx_automation_audit_occurred_brin
  ON automation_audit_logs USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_automation_audit_metadata
  ON automation_audit_logs USING GIN (metadata);

-- Immutability: prevent updates and deletes on audit logs
CREATE OR REPLACE FUNCTION automation_audit_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'automation_audit_logs rows are immutable and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_automation_audit_logs_no_update ON automation_audit_logs;
CREATE TRIGGER trg_automation_audit_logs_no_update
  BEFORE UPDATE ON automation_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION automation_audit_logs_immutable();

DROP TRIGGER IF EXISTS trg_automation_audit_logs_no_delete ON automation_audit_logs;
CREATE TRIGGER trg_automation_audit_logs_no_delete
  BEFORE DELETE ON automation_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION automation_audit_logs_immutable();

COMMIT;

-- Normalized final definition for automation_approvals.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/009_automation_approvals.sql

CREATE TABLE IF NOT EXISTS automation_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  step_id UUID NULL,
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  rejected_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  status automation_approval_status NOT NULL DEFAULT 'pending',
  risk_level automation_action_risk NOT NULL DEFAULT 'high',
  approval_reason TEXT,
  rejection_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_approval_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT chk_approval_approved CHECK (
  status != 'approved' OR (approved_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT chk_approval_rejected CHECK (
  status != 'rejected' OR (rejected_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_automation_approvals_org_status
  ON automation_approvals(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_approvals_run
  ON automation_approvals(run_id);

CREATE INDEX IF NOT EXISTS idx_automation_approvals_step
  ON automation_approvals(step_id);

CREATE INDEX IF NOT EXISTS idx_automation_approvals_pending_expiry
  ON automation_approvals(expires_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_approvals_step_pending_unique
  ON automation_approvals(step_id)
  WHERE status = 'pending' AND step_id IS NOT NULL;

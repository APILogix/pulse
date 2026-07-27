-- =============================================================================
-- Module      : Automation
-- Migration   : 008_automation_run_steps.sql
-- Description : Step-level execution history for workflow runs
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS automation_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  action_id UUID NULL REFERENCES automation_actions(id) ON DELETE SET NULL,
  step_key VARCHAR(100) NOT NULL,
  action_type VARCHAR(120) NOT NULL,
  status automation_step_status NOT NULL DEFAULT 'queued',
  sort_order INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approval_id UUID NULL,  -- FK added in 009 after approvals table exists
  idempotency_key VARCHAR(300),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(120),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_steps_run_order
  ON automation_run_steps(run_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_automation_steps_workflow_created
  ON automation_run_steps(workflow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_steps_status_retry
  ON automation_run_steps(status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_automation_steps_approval
  ON automation_run_steps(approval_id);

-- Unique partial index on idempotency_key (non-null only) — required for
-- ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL predicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_steps_idempotency_key_unique
  ON automation_run_steps(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Composite partial index for run retry ordering: ensures claimNextStep
-- only claims lowest sort_order eligible step.
CREATE INDEX IF NOT EXISTS idx_automation_steps_claim
  ON automation_run_steps(run_id, sort_order, status, next_retry_at)
  WHERE status IN ('queued', 'running', 'waiting_approval', 'failed');

-- Updated-at trigger
DROP TRIGGER IF EXISTS trg_automation_run_steps_updated_at ON automation_run_steps;
CREATE TRIGGER trg_automation_run_steps_updated_at
  BEFORE UPDATE ON automation_run_steps
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

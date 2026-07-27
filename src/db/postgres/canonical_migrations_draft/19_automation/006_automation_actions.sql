-- =============================================================================
-- Module      : Automation
-- Migration   : 006_automation_actions.sql
-- Description : Ordered actions for workflow execution
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS automation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE CASCADE,
  action_key VARCHAR(100) NOT NULL,
  action_type VARCHAR(120) NOT NULL,
  integration_key VARCHAR(80),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  risk_level automation_action_risk NOT NULL DEFAULT 'low',
  timeout_seconds INTEGER NOT NULL DEFAULT 60,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  retry_backoff_seconds INTEGER NOT NULL DEFAULT 30,
  idempotency_key_template VARCHAR(500),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT chk_action_timeout_positive CHECK (timeout_seconds > 0),
  CONSTRAINT chk_action_max_attempts_positive CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_automation_actions_workflow_order
  ON automation_actions(workflow_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_actions_version_order
  ON automation_actions(workflow_version_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_actions_type
  ON automation_actions(action_type, is_enabled)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_actions_risk
  ON automation_actions(risk_level)
  WHERE deleted_at IS NULL;

-- Updated-at trigger
DROP TRIGGER IF EXISTS trg_automation_actions_updated_at ON automation_actions;
CREATE TRIGGER trg_automation_actions_updated_at
  BEFORE UPDATE ON automation_actions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

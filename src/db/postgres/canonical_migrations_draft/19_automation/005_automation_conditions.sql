-- =============================================================================
-- Module      : Automation
-- Migration   : 005_automation_conditions.sql
-- Description : Ordered condition groups for workflow evaluation
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS automation_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE CASCADE,
  condition_group VARCHAR(80) NOT NULL DEFAULT 'default',
  sort_order INTEGER NOT NULL DEFAULT 0,
  left_path VARCHAR(300) NOT NULL,
  operator automation_condition_operator NOT NULL,
  right_value JSONB,
  value_type VARCHAR(30) NOT NULL DEFAULT 'json',
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_conditions_workflow_group
  ON automation_conditions(workflow_id, condition_group, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_conditions_version
  ON automation_conditions(workflow_version_id, sort_order)
  WHERE deleted_at IS NULL;

-- Updated-at trigger
DROP TRIGGER IF EXISTS trg_automation_conditions_updated_at ON automation_conditions;
CREATE TRIGGER trg_automation_conditions_updated_at
  BEFORE UPDATE ON automation_conditions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

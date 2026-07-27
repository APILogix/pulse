-- =============================================================================
-- Module      : Automation
-- Migration   : 003_automation_workflow_versions.sql
-- Description : Immutable workflow version snapshots
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS automation_workflow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  trigger_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  condition_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  checksum VARCHAR(128) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_workflow_versions UNIQUE (workflow_id, version),
  CONSTRAINT chk_workflow_version_definition CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT chk_workflow_version_trigger_summary CHECK (jsonb_typeof(trigger_summary) = 'array'),
  CONSTRAINT chk_workflow_version_condition_summary CHECK (jsonb_typeof(condition_summary) = 'array'),
  CONSTRAINT chk_workflow_version_action_summary CHECK (jsonb_typeof(action_summary) = 'array'),
  CONSTRAINT chk_workflow_version_published CHECK (
    (status != 'published') OR (status = 'published' AND published_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_automation_wv_workflow_version
  ON automation_workflow_versions(workflow_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_automation_wv_workflow_status
  ON automation_workflow_versions(workflow_id, status);

CREATE INDEX IF NOT EXISTS idx_automation_wv_checksum
  ON automation_workflow_versions(checksum);

-- HARDENED (defect 13): Immutability trigger — prohibit UPDATE of already-published rows.
-- INSERT is always allowed. DELETE must remain possible (FK CASCADE).
CREATE OR REPLACE FUNCTION trg_fn_immutable_published_version() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'Cannot update an already-published workflow version (id=%)', OLD.id
      USING ERRCODE = '25000'; -- invalid_transaction_state
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_published_version ON automation_workflow_versions;
CREATE TRIGGER trg_immutable_published_version
  BEFORE UPDATE ON automation_workflow_versions
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_immutable_published_version();

COMMIT;

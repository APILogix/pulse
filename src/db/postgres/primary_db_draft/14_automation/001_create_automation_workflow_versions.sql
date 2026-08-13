-- Normalized final definition for automation_workflow_versions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/003_automation_workflow_versions.sql

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

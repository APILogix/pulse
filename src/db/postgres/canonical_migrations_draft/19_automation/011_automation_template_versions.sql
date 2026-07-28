-- =============================================================================
-- Module      : Automation
-- Migration   : 011_automation_template_versions.sql
-- Description : Immutable template version definitions
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS automation_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES automation_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  definition JSONB NOT NULL,
  trigger_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  condition_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum VARCHAR(128) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_template_versions UNIQUE (template_id, version),
  CONSTRAINT chk_template_version_definition CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT chk_template_version_trigger_summary CHECK (jsonb_typeof(trigger_summary) = 'array'),
  CONSTRAINT chk_template_version_condition_summary CHECK (jsonb_typeof(condition_summary) = 'array'),
  CONSTRAINT chk_template_version_action_summary CHECK (jsonb_typeof(action_summary) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_automation_tv_template_version
  ON automation_template_versions(template_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_automation_tv_current
  ON automation_template_versions(template_id)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_automation_tv_checksum
  ON automation_template_versions(checksum);

-- Partial unique index: only one current version per template
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_tv_one_current
  ON automation_template_versions(template_id)
  WHERE is_current = TRUE;

COMMIT;

-- Normalized final definition for automation_template_versions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/011_automation_template_versions.sql

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_tv_one_current
  ON automation_template_versions(template_id)
  WHERE is_current = TRUE;

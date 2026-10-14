-- Normalized final definition for automation_templates.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/010_automation_templates.sql

CREATE TABLE IF NOT EXISTS automation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key VARCHAR(120) NOT NULL,
  scope automation_template_scope NOT NULL DEFAULT 'platform',
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  workflow_type VARCHAR(80) NOT NULL,
  category VARCHAR(80) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  minimum_plan_tier billing_plan_tier NULL,
  required_feature_key VARCHAR(100),
  tags TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_templates_platform_key
  ON automation_templates(template_key)
  WHERE deleted_at IS NULL AND scope = 'platform';

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_templates_org_key
  ON automation_templates(organization_id, template_key)
  WHERE deleted_at IS NULL AND scope = 'organization';

CREATE INDEX IF NOT EXISTS idx_automation_templates_scope_category
  ON automation_templates(scope, category, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_templates_org_category
  ON automation_templates(organization_id, category)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_templates_feature_key
  ON automation_templates(required_feature_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_templates_tags
  ON automation_templates USING GIN (tags)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_templates_metadata
  ON automation_templates USING GIN (metadata);

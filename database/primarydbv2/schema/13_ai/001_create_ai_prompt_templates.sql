-- Normalized final definition for ai_prompt_templates.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/010_ai_prompt_templates.up.sql

CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_mode TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  template_body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
  CHECK (status IN ('active', 'draft', 'deprecated')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ai_mode, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_active
  ON ai_prompt_templates (ai_mode)
  WHERE status = 'active';

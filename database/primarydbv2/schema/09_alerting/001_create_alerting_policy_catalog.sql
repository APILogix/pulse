-- Normalized final definition for alerting_policy_catalog.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_policy_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug VARCHAR(150) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES alerting_policy_categories(id) ON DELETE RESTRICT,
  severity alert_severity NOT NULL,
  default_threshold JSONB NOT NULL DEFAULT '{}'::jsonb,
  recovery_threshold JSONB NOT NULL DEFAULT '{}'::jsonb,
  cooldown_seconds INTEGER NOT NULL CHECK (cooldown_seconds >= 0),
  evaluation_window_seconds INTEGER NOT NULL CHECK (evaluation_window_seconds > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_policy_catalog_org_slug UNIQUE (organization_id, slug),
  CONSTRAINT ck_alerting_policy_catalog_threshold_object CHECK (jsonb_typeof(default_threshold) = 'object'),
  CONSTRAINT ck_alerting_policy_catalog_recovery_object CHECK (jsonb_typeof(recovery_threshold) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_catalog_org_category
  ON alerting_policy_catalog(organization_id, category_id, enabled);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_catalog_org_severity
  ON alerting_policy_catalog(organization_id, severity, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerting_policy_catalog_id_org
  ON alerting_policy_catalog(id, organization_id);

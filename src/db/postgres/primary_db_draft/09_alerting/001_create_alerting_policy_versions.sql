-- Normalized final definition for alerting_policy_versions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
-- - migrations/002_create_all_ordered.sql
-- - canonical_migrations_draft/18_alerting_workspace/010_add_subscription_tenant_keys.up.sql

CREATE TABLE IF NOT EXISTS alerting_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES alerting_policy_catalog(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  definition JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_policy_version UNIQUE (policy_id, version),
  CONSTRAINT ck_alerting_policy_version_definition CHECK (jsonb_typeof(definition) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_versions_org_created
  ON alerting_policy_versions(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_versions_policy
  ON alerting_policy_versions(policy_id, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerting_policy_versions_policy_org
  ON alerting_policy_versions(policy_id, organization_id);

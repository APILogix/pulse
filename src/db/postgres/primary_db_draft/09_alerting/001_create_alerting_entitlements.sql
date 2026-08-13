-- Normalized final definition for alerting_entitlements.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_entitlements (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
  plan_key VARCHAR(100) NOT NULL,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_version INTEGER NOT NULL DEFAULT 1 CHECK (source_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_entitlements_limits CHECK (jsonb_typeof(limits) = 'object'),
  CONSTRAINT ck_alerting_entitlements_features CHECK (jsonb_typeof(features) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_entitlements_org
  ON alerting_entitlements(organization_id);

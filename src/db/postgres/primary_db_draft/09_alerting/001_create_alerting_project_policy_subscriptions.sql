-- Normalized final definition for alerting_project_policy_subscriptions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_project_policy_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES alerting_policy_catalog(id) ON DELETE CASCADE,
  state VARCHAR(20) NOT NULL DEFAULT 'subscribed'
  CHECK (state IN ('subscribed', 'paused', 'muted', 'disabled', 'archived')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_alerting_project_policy_subscription_id_org UNIQUE (id, organization_id),
  CONSTRAINT fk_alerting_policy_subscription_policy_tenant
  FOREIGN KEY (policy_id, organization_id) REFERENCES alerting_policy_catalog(id, organization_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerting_project_policy_subscription_live
  ON alerting_project_policy_subscriptions(project_id, policy_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerting_project_policy_subscriptions_org_project
  ON alerting_project_policy_subscriptions(organization_id, project_id, state)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerting_project_policy_subscriptions_policy
  ON alerting_project_policy_subscriptions(organization_id, policy_id)
  WHERE deleted_at IS NULL;

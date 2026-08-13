-- Normalized final definition for alerting_project_policy_overrides.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_project_policy_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES alerting_project_policy_subscriptions(id) ON DELETE CASCADE,
  threshold JSONB,
  cooldown_seconds INTEGER CHECK (cooldown_seconds IS NULL OR cooldown_seconds >= 0),
  channels JSONB,
  severity alert_severity,
  maintenance_windows JSONB,
  evaluation_window_seconds INTEGER CHECK (evaluation_window_seconds IS NULL OR evaluation_window_seconds > 0),
  environment VARCHAR(100),
  escalation_policy_id UUID REFERENCES alerting_escalation_policies_v2(id) ON DELETE SET NULL,
  mute_schedule JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_project_policy_override UNIQUE (subscription_id),
  CONSTRAINT ck_alerting_override_channels CHECK (channels IS NULL OR jsonb_typeof(channels) = 'array'),
  CONSTRAINT ck_alerting_override_maintenance CHECK (maintenance_windows IS NULL OR jsonb_typeof(maintenance_windows) = 'array'),
  CONSTRAINT ck_alerting_override_mute CHECK (mute_schedule IS NULL OR jsonb_typeof(mute_schedule) = 'object'),
  CONSTRAINT fk_alerting_override_subscription_tenant
  FOREIGN KEY (subscription_id, organization_id) REFERENCES alerting_project_policy_subscriptions(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alerting_project_policy_overrides_org_subscription
  ON alerting_project_policy_overrides(organization_id, subscription_id);

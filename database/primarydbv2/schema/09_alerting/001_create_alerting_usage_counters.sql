-- Normalized final definition for alerting_usage_counters.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_usage_counters (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  policies_count BIGINT NOT NULL DEFAULT 0 CHECK (policies_count >= 0),
  custom_policies_count BIGINT NOT NULL DEFAULT 0 CHECK (custom_policies_count >= 0),
  project_subscriptions_count BIGINT NOT NULL DEFAULT 0 CHECK (project_subscriptions_count >= 0),
  notifications_count BIGINT NOT NULL DEFAULT 0 CHECK (notifications_count >= 0),
  sms_count BIGINT NOT NULL DEFAULT 0 CHECK (sms_count >= 0),
  connector_deliveries_count BIGINT NOT NULL DEFAULT 0 CHECK (connector_deliveries_count >= 0),
  incidents_count BIGINT NOT NULL DEFAULT 0 CHECK (incidents_count >= 0),
  maintenance_windows_count BIGINT NOT NULL DEFAULT 0 CHECK (maintenance_windows_count >= 0),
  escalations_count BIGINT NOT NULL DEFAULT 0 CHECK (escalations_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerting_usage_counters_org
  ON alerting_usage_counters(organization_id);

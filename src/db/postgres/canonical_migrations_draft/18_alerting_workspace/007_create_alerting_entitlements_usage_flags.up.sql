BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_alerting_entitlements_org
  ON alerting_entitlements(organization_id);
CREATE INDEX IF NOT EXISTS idx_alerting_usage_counters_org
  ON alerting_usage_counters(organization_id);

DROP TRIGGER IF EXISTS trg_alerting_entitlements_updated_at ON alerting_entitlements;
CREATE TRIGGER trg_alerting_entitlements_updated_at
  BEFORE UPDATE ON alerting_entitlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_usage_counters_updated_at ON alerting_usage_counters;
CREATE TRIGGER trg_alerting_usage_counters_updated_at
  BEFORE UPDATE ON alerting_usage_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

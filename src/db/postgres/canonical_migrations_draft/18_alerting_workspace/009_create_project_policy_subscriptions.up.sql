BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_id_org
  ON projects(id, org_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerting_policy_catalog_id_org
  ON alerting_policy_catalog(id, organization_id);

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
  CONSTRAINT fk_alerting_project_policy_subscription_tenant
    FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, org_id) ON DELETE CASCADE,
  CONSTRAINT fk_alerting_policy_subscription_policy_tenant
    FOREIGN KEY (policy_id, organization_id) REFERENCES alerting_policy_catalog(id, organization_id) ON DELETE CASCADE
);

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerting_project_policy_subscription_live
  ON alerting_project_policy_subscriptions(project_id, policy_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerting_project_policy_subscriptions_org_project
  ON alerting_project_policy_subscriptions(organization_id, project_id, state)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerting_project_policy_subscriptions_policy
  ON alerting_project_policy_subscriptions(organization_id, policy_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerting_project_policy_overrides_org_subscription
  ON alerting_project_policy_overrides(organization_id, subscription_id);

DROP TRIGGER IF EXISTS trg_alerting_project_policy_subscriptions_updated_at ON alerting_project_policy_subscriptions;
CREATE TRIGGER trg_alerting_project_policy_subscriptions_updated_at
  BEFORE UPDATE ON alerting_project_policy_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_project_policy_overrides_updated_at ON alerting_project_policy_overrides;
CREATE TRIGGER trg_alerting_project_policy_overrides_updated_at
  BEFORE UPDATE ON alerting_project_policy_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

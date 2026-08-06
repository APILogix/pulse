BEGIN;

CREATE TABLE IF NOT EXISTS alerting_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  initialized_by VARCHAR(100) NOT NULL,
  initialization_version VARCHAR(100) NOT NULL,
  provisioning_status VARCHAR(20) NOT NULL DEFAULT 'initializing'
    CHECK (provisioning_status IN ('initializing', 'ready', 'failed')),
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alerting_workspace_ready_completion CHECK (
    provisioning_status <> 'ready' OR completed_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_alerting_workspaces_status
  ON alerting_workspaces(provisioning_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS alerting_policy_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_policy_category_org_slug UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_categories_org_order
  ON alerting_policy_categories(organization_id, sort_order, slug);

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

DROP TRIGGER IF EXISTS trg_alerting_workspaces_updated_at ON alerting_workspaces;
CREATE TRIGGER trg_alerting_workspaces_updated_at
  BEFORE UPDATE ON alerting_workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_policy_categories_updated_at ON alerting_policy_categories;
CREATE TRIGGER trg_alerting_policy_categories_updated_at
  BEFORE UPDATE ON alerting_policy_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_policy_catalog_updated_at ON alerting_policy_catalog;
CREATE TRIGGER trg_alerting_policy_catalog_updated_at
  BEFORE UPDATE ON alerting_policy_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE alerting_workspaces IS
  'Alerting V2 organization root. Configuration only; runtime state is stored separately.';
COMMENT ON TABLE alerting_policy_catalog IS
  'Organization-owned policy definitions. Projects subscribe without copying definitions.';
COMMENT ON TABLE alerting_policy_versions IS
  'Immutable snapshots of organization policy definitions.';

COMMIT;

-- Normalized final definition for alert_rules.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/002_create_alert_rules.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/08_alerting/021_create_alert_rule_revisions.down.sql
-- - canonical_migrations_draft/08_alerting/021_create_alert_rule_revisions.up.sql
-- - canonical_migrations_draft/17_enterprise_ingestion/002_alerting_project_scope.up.sql
-- - migrations/004_enterprise_database_integrity.sql

CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  severity alert_severity NOT NULL DEFAULT 'warning',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  evaluation_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (evaluation_interval_seconds > 0),
  cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
  auto_resolve_after_minutes INTEGER,
  deduplication_window_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (deduplication_window_seconds >= 0),
  deduplication_key_template VARCHAR(500) DEFAULT '{{rule_id}}:{{source}}:{{fingerprint}}',
  grouping_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  grouping_key_template VARCHAR(500),
  grouping_wait_seconds INTEGER NOT NULL DEFAULT 300,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  enabled_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  current_revision INTEGER NOT NULL DEFAULT 1,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  preset_key VARCHAR(64),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  last_evaluated_at TIMESTAMPTZ,
  evaluation_category VARCHAR(32) NOT NULL DEFAULT 'analytics' CHECK (evaluation_category IN ('fast', 'analytics'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rule_name_per_org
  ON alert_rules(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_org
  ON alert_rules(organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_org_eval_cat
  ON alert_rules(organization_id, evaluation_category)
  WHERE deleted_at IS NULL AND enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled
  ON alert_rules(organization_id, enabled)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_severity
  ON alert_rules(severity)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_org_project
  ON alert_rules(organization_id, project_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_eval_due
  ON alert_rules(enabled, last_evaluated_at)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rules_preset_scope
  ON alert_rules(organization_id, project_id, preset_key) NULLS NOT DISTINCT
  WHERE preset_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_org_project_active
    ON alert_rules(organization_id, project_id)
    WHERE deleted_at IS NULL;

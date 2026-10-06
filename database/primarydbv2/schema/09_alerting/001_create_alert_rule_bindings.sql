-- Normalized final definition for alert_rule_bindings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/020_create_alert_rule_bindings.up.sql

CREATE TABLE IF NOT EXISTS alert_rule_bindings (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id                       UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  scope_type                    alert_scope_type NOT NULL,
  scope_level                   SMALLINT NOT NULL,
  project_id                    UUID REFERENCES projects(id) ON DELETE CASCADE,
  environment                   VARCHAR(64),
  service                       VARCHAR(255),
  endpoint                      VARCHAR(500),
  mode                          alert_binding_mode NOT NULL DEFAULT 'inherit',
  enabled                       BOOLEAN NOT NULL DEFAULT TRUE,
  priority                      INTEGER NOT NULL DEFAULT 100,
  severity                      alert_severity,
  cooldown_seconds              INTEGER CHECK (cooldown_seconds IS NULL OR cooldown_seconds >= 0),
  deduplication_window_seconds  INTEGER CHECK (deduplication_window_seconds IS NULL OR deduplication_window_seconds >= 0),
  auto_resolve_after_minutes    INTEGER CHECK (auto_resolve_after_minutes IS NULL OR auto_resolve_after_minutes > 0),
  evaluation_interval_seconds   INTEGER CHECK (evaluation_interval_seconds IS NULL OR evaluation_interval_seconds > 0),
  consecutive_breaches          INTEGER CHECK (consecutive_breaches IS NULL OR consecutive_breaches >= 1),
  threshold_overrides           JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_mode                   alert_action_merge_mode NOT NULL DEFAULT 'inherit',
  requested_channels            JSONB,
  recipient_overrides           JSONB,
  escalation_policy_id          UUID REFERENCES alert_escalation_policies(id) ON DELETE SET NULL,
  notes                         TEXT,
  created_by                    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by                    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ,
  CONSTRAINT ck_alert_rule_binding_scope_shape CHECK (
  (scope_type = 'organization' AND scope_level = 0
  AND project_id IS NULL AND environment IS NULL AND service IS NULL AND endpoint IS NULL) OR
  (scope_type = 'project' AND scope_level = 1
  AND project_id IS NOT NULL AND environment IS NULL AND service IS NULL AND endpoint IS NULL) OR
  (scope_type = 'environment' AND scope_level = 2
  AND project_id IS NOT NULL AND environment IS NOT NULL AND service IS NULL AND endpoint IS NULL) OR
  (scope_type = 'service' AND scope_level = 3
  AND project_id IS NOT NULL AND service IS NOT NULL AND endpoint IS NULL) OR
  (scope_type = 'endpoint' AND scope_level = 4
  AND project_id IS NOT NULL AND endpoint IS NOT NULL)
  ),
  CONSTRAINT ck_alert_rule_binding_environment CHECK (
  environment IS NULL OR (
  char_length(environment) BETWEEN 1 AND 64
  AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
  ),
  CONSTRAINT ck_alert_rule_binding_threshold_overrides CHECK (
  jsonb_typeof(threshold_overrides) = 'object'
  ),
  CONSTRAINT ck_alert_rule_binding_requested_channels CHECK (
  requested_channels IS NULL OR jsonb_typeof(requested_channels) = 'array'
  ),
  CONSTRAINT ck_alert_rule_binding_recipient_overrides CHECK (
  recipient_overrides IS NULL OR jsonb_typeof(recipient_overrides) = 'object'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rule_binding_scope
  ON alert_rule_bindings (rule_id, scope_type, project_id, environment, service, endpoint)
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rule_bindings_resolve
  ON alert_rule_bindings (organization_id, rule_id, scope_level DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rule_bindings_project
  ON alert_rule_bindings (project_id, scope_level DESC)
  WHERE deleted_at IS NULL AND project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rule_bindings_escalation
  ON alert_rule_bindings (escalation_policy_id)
  WHERE deleted_at IS NULL AND escalation_policy_id IS NOT NULL;

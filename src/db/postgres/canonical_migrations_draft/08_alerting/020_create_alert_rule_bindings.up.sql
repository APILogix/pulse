-- =============================================================================
-- Primary DB : P2 — alert_rule_bindings (enterprise rule inheritance)
-- Architecture : docs/alerting-redesign/02-data-model.md §1
--                docs/alerting-redesign/adr/0004-rule-inheritance-model.md
-- Increment    : 2 (rule bindings + effective rule resolution)
-- Deviation    : file number corrected 019 -> 020, see DEVIATIONS.md DEV-001
--
-- ADR-0004: the rule DEFINITION stays in alert_rules / alert_rule_conditions /
-- alert_rule_actions. Scope BEHAVIOUR moves here, so one rule can serve many scopes
-- without duplicating the definition. An organization binding enables a subscribable
-- catalog rule; a project opts in by adding a project-or-deeper binding, usually
-- mode='inherit' with no overrides. `alert_rules.project_id` is deliberately left in
-- place and untouched — it is only deprecated (comment) in P15.
--
-- Sparse overrides: a NULL column means "inherit from the parent scope", so a binding
-- states only what it changes. That is what makes the fold in
-- modules/alerting/policy/resolve-rule.ts deterministic.
--
-- Additive only. No evaluator reads this table in Increment 2.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS alert_rule_bindings (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id                       UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,

  scope_type                    alert_scope_type NOT NULL,
  -- Precedence ladder: organization=0, project=1, environment=2, service=3, endpoint=4.
  -- Stored (not derived) so resolution can ORDER BY it without a CASE expression.
  scope_level                   SMALLINT NOT NULL,
  project_id                    UUID REFERENCES projects(id) ON DELETE CASCADE,
  environment                   VARCHAR(64),
  service                       VARCHAR(255),
  endpoint                      VARCHAR(500),

  mode                          alert_binding_mode NOT NULL DEFAULT 'inherit',
  enabled                       BOOLEAN NOT NULL DEFAULT TRUE,
  priority                      INTEGER NOT NULL DEFAULT 100,

  -- Scalar overrides. NULL = inherit.
  severity                      alert_severity,
  cooldown_seconds              INTEGER CHECK (cooldown_seconds IS NULL OR cooldown_seconds >= 0),
  deduplication_window_seconds  INTEGER CHECK (deduplication_window_seconds IS NULL OR deduplication_window_seconds >= 0),
  auto_resolve_after_minutes    INTEGER CHECK (auto_resolve_after_minutes IS NULL OR auto_resolve_after_minutes > 0),
  evaluation_interval_seconds   INTEGER CHECK (evaluation_interval_seconds IS NULL OR evaluation_interval_seconds > 0),
  consecutive_breaches          INTEGER CHECK (consecutive_breaches IS NULL OR consecutive_breaches >= 1),

  -- Per-condition threshold overrides keyed by condition field_path, e.g. {"errors.rate": 2}
  threshold_overrides           JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Action / recipient / channel overrides. Rules request CHANNELS, never connector ids.
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

  -- A scope tuple must be shaped correctly for its level; this makes an inconsistent
  -- binding (e.g. an 'endpoint' scope with no project) impossible to insert.
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

-- Exactly ONE live binding per (rule, scope tuple). NULLS NOT DISTINCT is required so
-- two organization-scope bindings (all scope columns NULL) cannot both exist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rule_binding_scope
  ON alert_rule_bindings (rule_id, scope_type, project_id, environment, service, endpoint)
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

-- Resolution reads every live binding for a rule, deepest scope first.
CREATE INDEX IF NOT EXISTS idx_alert_rule_bindings_resolve
  ON alert_rule_bindings (organization_id, rule_id, scope_level DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rule_bindings_project
  ON alert_rule_bindings (project_id, scope_level DESC)
  WHERE deleted_at IS NULL AND project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rule_bindings_escalation
  ON alert_rule_bindings (escalation_policy_id)
  WHERE deleted_at IS NULL AND escalation_policy_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alert_rule_bindings_updated_at ON alert_rule_bindings;
CREATE TRIGGER trg_alert_rule_bindings_updated_at
  BEFORE UPDATE ON alert_rule_bindings
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMENT ON TABLE alert_rule_bindings IS
  'Scope behaviour for an alert rule (ADR-0004). One rule + many bindings = one effective '
  'rule per evaluation context, resolved deepest-scope-wins. NULL columns mean inherit.';
COMMENT ON COLUMN alert_rule_bindings.mode IS
  'disable stops the rule at this scope; a DEEPER binding with mode=override and '
  'enabled=true re-enables it (that is what makes "disable at project, override at '
  'endpoint" behave correctly).';
COMMENT ON COLUMN alert_rule_bindings.threshold_overrides IS
  'Per-condition overrides keyed by alert_rule_conditions.field_path.';
COMMENT ON COLUMN alert_rule_bindings.requested_channels IS
  'Channel KINDS requested by this scope, e.g. ["slack","email"]. Never connector ids.';

COMMIT;

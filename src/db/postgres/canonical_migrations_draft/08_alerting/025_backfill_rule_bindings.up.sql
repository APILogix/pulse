-- =============================================================================
-- Primary DB : P12 — Backfill alert_rule_bindings from existing rules
-- Architecture : docs/alerting-redesign/07-migration-plan.md §3
--                docs/alerting-redesign/adr/0004-rule-inheritance-model.md
-- Increment    : 2 (rule bindings + effective rule resolution)
-- Deviation    : file number corrected 024 -> 025, see DEVIATIONS.md DEV-001
--
-- BEHAVIOUR-PRESERVING BY DESIGN. This is the property that makes the redesign safe to
-- ship: an org-wide rule gets one `organization/inherit` binding and a project-scoped rule
-- gets one `project/override` binding, which resolve to EXACTLY the semantics those rules
-- have today. Inheritance only takes effect when someone creates a NEW binding.
--
-- Proven by test: `test/unit/alerting-effective-rule.test.ts` asserts that a rule with no
-- bindings, and a rule with a single inherit binding, resolve to the rule's own values.
--
-- Idempotent: re-running inserts nothing new (ON CONFLICT DO NOTHING against the partial
-- unique index `uq_alert_rule_binding_scope`).
--
-- Rollback: DELETE FROM alert_rule_bindings WHERE notes = 'backfill:v2';
--           (see 025_backfill_rule_bindings.down.sql)
--
-- Note on `created_by`: alert_rule_bindings.created_by is nullable with ON DELETE SET NULL,
-- while alert_rules.created_by is NOT NULL, so copying it across is always valid.
-- =============================================================================

BEGIN;

-- ── 1. Organization-wide rules → one organization/inherit binding ────────────
-- `inherit` (not `override`) is deliberate: the binding asserts no values of its own, so
-- resolution falls through to the rule's columns. Copying the scalars here instead would
-- freeze today's values and silently ignore later edits to the rule.
INSERT INTO alert_rule_bindings (
  organization_id, rule_id, scope_type, scope_level,
  mode, enabled, priority, created_by, updated_by, notes
)
SELECT
  r.organization_id, r.id, 'organization', 0,
  'inherit', r.enabled, 100, r.created_by, r.created_by, 'backfill:v2'
FROM alert_rules r
WHERE r.deleted_at IS NULL
  AND r.project_id IS NULL
ON CONFLICT DO NOTHING;

-- ── 2. Project-scoped rules → one project/override binding ───────────────────
-- `override` is correct here: the rule is genuinely scoped to one project today, so the
-- binding must reproduce that restriction. Scalars stay NULL (inherit) so the rule remains
-- the single source of truth for its thresholds and timings.
INSERT INTO alert_rule_bindings (
  organization_id, rule_id, scope_type, scope_level, project_id,
  mode, enabled, priority, created_by, updated_by, notes
)
SELECT
  r.organization_id, r.id, 'project', 1, r.project_id,
  'override', r.enabled, 100, r.created_by, r.created_by, 'backfill:v2'
FROM alert_rules r
JOIN projects p ON p.id = r.project_id AND p.org_id = r.organization_id
WHERE r.deleted_at IS NULL
  AND r.project_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 3. Integrity guard ───────────────────────────────────────────────────────
-- A project-scoped rule whose project is missing or belongs to another organization would
-- be skipped silently by the JOIN above. Fail loudly instead: that is cross-tenant or
-- orphaned data which must be repaired before inheritance is relied upon.
DO $$
DECLARE
  orphaned INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned
  FROM alert_rules r
  LEFT JOIN projects p ON p.id = r.project_id AND p.org_id = r.organization_id
  WHERE r.deleted_at IS NULL
    AND r.project_id IS NOT NULL
    AND p.id IS NULL;

  IF orphaned > 0 THEN
    RAISE EXCEPTION
      'alert_rules contains % project-scoped rule(s) whose project is missing or '
      'cross-tenant; repair before backfilling bindings', orphaned;
  END IF;
END $$;

-- ── 4. Seed revision 1 for every rule that has no history yet ────────────────
-- alert_rules.current_revision defaults to 1 (P3), so the matching revision row makes the
-- history complete from the first edit onward rather than starting at 2.
INSERT INTO alert_rule_revisions
  (organization_id, rule_id, revision, change_kind, snapshot, actor_user_id)
SELECT
  r.organization_id, r.id, 1, 'rule',
  jsonb_build_object(
    'rule', to_jsonb(r) - 'created_at' - 'updated_at',
    'conditions', COALESCE(
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.order_index, c.id)
         FROM alert_rule_conditions c WHERE c.rule_id = r.id), '[]'::jsonb),
    'actions', COALESCE(
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.order_index, a.id)
         FROM alert_rule_actions a WHERE a.rule_id = r.id), '[]'::jsonb),
    'bindings', COALESCE(
      (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.scope_level, b.id)
         FROM alert_rule_bindings b WHERE b.rule_id = r.id AND b.deleted_at IS NULL), '[]'::jsonb),
    'backfill', TRUE
  ),
  r.created_by
FROM alert_rules r
WHERE r.deleted_at IS NULL
ON CONFLICT (rule_id, revision) DO NOTHING;

COMMIT;

-- Source: canonical_migrations_draft/08_alerting/025_backfill_rule_bindings.up.sql
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

-- Source: canonical_migrations_draft/08_alerting/025_backfill_rule_bindings.up.sql
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

-- Source: canonical_migrations_draft/08_alerting/025_backfill_rule_bindings.up.sql
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

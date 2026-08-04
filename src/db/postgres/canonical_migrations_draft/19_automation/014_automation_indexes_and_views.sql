BEGIN;

DROP VIEW IF EXISTS v_automation_workflow_summaries;
CREATE VIEW v_automation_workflow_summaries AS
SELECT
  w.id,
  w.organization_id,
  w.project_id,
  w.created_by,
  w.updated_by,
  w.template_id,
  w.name,
  w.slug,
  w.description,
  w.workflow_type,
  w.scope,
  w.status,
  w.is_enabled,
  w.current_version,
  w.last_run_at,
  w.next_run_at,
  w.timezone,
  w.tags,
  w.metadata,
  w.created_at,
  w.updated_at,
  w.deleted_at,
  COALESCE(tc.trigger_count, 0) AS trigger_count,
  tc.trigger_type,
  COALESCE(ac.action_count, 0) AS action_count,
  COALESCE(ac.action_types, ARRAY[]::text[]) AS action_types,
  COALESCE(ac.action_requires_approval, ARRAY[]::boolean[]) AS action_requires_approval
FROM automation_workflows w
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS trigger_count, MIN(t.trigger_type) AS trigger_type
  FROM automation_triggers t
  WHERE t.workflow_id = w.id
    AND t.workflow_version_id IS NULL
    AND t.deleted_at IS NULL
) tc ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS action_count,
    ARRAY_AGG(a.action_type ORDER BY a.sort_order) AS action_types,
    ARRAY_AGG(a.requires_approval ORDER BY a.sort_order) AS action_requires_approval
  FROM automation_actions a
  WHERE a.workflow_id = w.id
    AND a.workflow_version_id IS NULL
    AND a.deleted_at IS NULL
    AND a.is_enabled = TRUE
) ac ON TRUE
WHERE w.deleted_at IS NULL;

-- Run and run-step summary views moved to Log DB runtime ownership.

COMMIT;

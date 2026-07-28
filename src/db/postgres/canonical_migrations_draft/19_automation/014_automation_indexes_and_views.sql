-- =============================================================================
-- Module      : Automation
-- Migration   : 014_automation_indexes_and_views.sql
-- Description : Summary views for efficient frontend/internal reads
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

-- =============================================================================
-- View: v_automation_workflow_summaries
-- =============================================================================
-- Recreate the view so this draft migration remains idempotent even when its
-- response contract gains columns during development.
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
  COALESCE(ac.action_requires_approval, ARRAY[]::boolean[]) AS action_requires_approval,
  lr.status AS last_run_status,
  lr.created_at AS last_run_created_at
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
LEFT JOIN LATERAL (
  SELECT r.status, r.created_at
  FROM automation_runs r
  WHERE r.workflow_id = w.id AND r.organization_id = w.organization_id
  ORDER BY r.created_at DESC
  LIMIT 1
) lr ON TRUE
WHERE w.deleted_at IS NULL;

-- =============================================================================
-- View: v_automation_run_summaries
-- =============================================================================
CREATE OR REPLACE VIEW v_automation_run_summaries AS
SELECT
  r.id AS run_id,
  r.workflow_id,
  w.name AS workflow_name,
  r.organization_id,
  r.status,
  r.trigger_type,
  r.source_module,
  r.priority,
  r.queued_at,
  r.started_at,
  r.completed_at,
  r.created_at,
  COALESCE(sc.step_count, 0) AS step_count,
  COALESCE(sc.failed_step_count, 0) AS failed_step_count,
  COALESCE(pa.pending_approval_count, 0) AS pending_approval_count
FROM automation_runs r
JOIN automation_workflows w ON w.id = r.workflow_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS step_count,
    COUNT(*) FILTER (WHERE s.status = 'failed')::int AS failed_step_count
  FROM automation_run_steps s
  WHERE s.run_id = r.id
) sc ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS pending_approval_count
  FROM automation_approvals a
  WHERE a.run_id = r.id AND a.status = 'pending'
) pa ON TRUE;

-- =============================================================================
-- View: v_automation_pending_approvals
-- =============================================================================
CREATE OR REPLACE VIEW v_automation_pending_approvals AS
SELECT
  a.id AS approval_id,
  a.organization_id,
  a.workflow_id,
  a.run_id,
  a.step_id,
  a.risk_level,
  a.status,
  a.expires_at,
  a.created_at,
  w.name AS workflow_name,
  s.action_type
FROM automation_approvals a
JOIN automation_workflows w ON w.id = a.workflow_id
LEFT JOIN automation_run_steps s ON s.id = a.step_id
WHERE a.status = 'pending';

COMMIT;

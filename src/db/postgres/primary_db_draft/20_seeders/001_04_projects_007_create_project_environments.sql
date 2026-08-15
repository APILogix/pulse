-- Source: canonical_migrations_draft/04_projects/007_create_project_environments.up.sql
-- Backfill the single default Production environment for any project lacking an active environment.
INSERT INTO project_environments (project_id, organization_id, name, slug, type, description, is_default, is_active, color)
SELECT p.id, p.org_id, 'Production', 'production', 'production'::project_environment_type, 'Production telemetry', TRUE, TRUE, '#16A34A'
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_environments e
  WHERE e.project_id = p.id AND e.slug = 'production' AND e.deleted_at IS NULL
)
AND p.deleted_at IS NULL;


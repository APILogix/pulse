-- Source: canonical_migrations_draft/04_projects/007_create_project_environments.up.sql
INSERT INTO project_environments (project_id, organization_id, name, slug, type, description, is_default, color)
SELECT p.id, p.org_id, v.name, v.slug, v.type::project_environment_type, v.description, v.is_default, v.color
FROM projects p CROSS JOIN (VALUES
  ('Production','production','production','Production telemetry',true,'#16A34A'),
  ('Staging','staging','staging','Pre-production telemetry',false,'#D97706'),
  ('Development','development','development','Development telemetry',false,'#2563EB'),
  ('Testing','testing','testing','Quality assurance and automated testing telemetry',false,'#7C3AED'),
  ('Preview','preview','preview','Short-lived preview deployment telemetry',false,'#DB2777')
) AS v(name,slug,type,description,is_default,color)
WHERE NOT EXISTS (SELECT 1 FROM project_environments e WHERE e.project_id=p.id AND e.slug=v.slug AND e.deleted_at IS NULL);

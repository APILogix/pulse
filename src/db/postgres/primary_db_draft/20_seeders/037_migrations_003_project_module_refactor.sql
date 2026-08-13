-- Source: migrations/003_project_module_refactor.sql
INSERT INTO project_roles (organization_id, name, slug, description, is_system, permissions)
SELECT o.id,
       'Owner',
       'owner',
       'Full project ownership and destructive access',
       TRUE,
       ARRAY[
         'project:view','project:edit','project:delete','project:transfer_ownership',
         'api_key:view','api_key:create','api_key:rotate','api_key:delete',
         'alert:view','alert:manage','connector:manage','member:manage','role:manage',
         'audit_log:view','release:manage','sdk_config:manage','environment:manage',
         'integration:manage','settings:manage','usage:view','billing:view'
       ]
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM project_roles r WHERE r.organization_id = o.id AND r.slug = 'owner'
);

-- Source: migrations/003_project_module_refactor.sql
INSERT INTO project_roles (organization_id, name, slug, description, is_system, permissions)
SELECT o.id,
       'Admin',
       'admin',
       'Administrative access without ownership transfer',
       TRUE,
       ARRAY[
         'project:view','project:edit','api_key:view','api_key:create','api_key:rotate','api_key:delete',
         'alert:view','alert:manage','connector:manage','member:manage','role:manage',
         'audit_log:view','release:manage','sdk_config:manage','environment:manage',
         'integration:manage','settings:manage','usage:view'
       ]
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM project_roles r WHERE r.organization_id = o.id AND r.slug = 'admin'
);

-- Source: migrations/003_project_module_refactor.sql
INSERT INTO project_roles (organization_id, name, slug, description, is_system, permissions)
SELECT o.id,
       'Developer',
       'developer',
       'Can create keys and manage SDK config',
       TRUE,
       ARRAY[
         'project:view','api_key:view','api_key:create','api_key:rotate','alert:view',
         'release:manage','sdk_config:manage','environment:view','usage:view'
       ]
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM project_roles r WHERE r.organization_id = o.id AND r.slug = 'developer'
);

-- Source: migrations/003_project_module_refactor.sql
INSERT INTO project_roles (organization_id, name, slug, description, is_system, permissions)
SELECT o.id,
       'QA',
       'qa',
       'Can view and manage alerts, releases, and environments',
       TRUE,
       ARRAY[
         'project:view','alert:view','alert:manage','release:manage','environment:view','usage:view'
       ]
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM project_roles r WHERE r.organization_id = o.id AND r.slug = 'qa'
);

-- Source: migrations/003_project_module_refactor.sql
INSERT INTO project_roles (organization_id, name, slug, description, is_system, permissions)
SELECT o.id,
       'Viewer',
       'viewer',
       'Read-only access',
       TRUE,
       ARRAY['project:view','api_key:view','alert:view','usage:view','environment:view']
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM project_roles r WHERE r.organization_id = o.id AND r.slug = 'viewer'
);

-- Source: migrations/003_project_module_refactor.sql
INSERT INTO project_notification_preferences (project_id, organization_id, category, enabled)
SELECT p.id, p.org_id, cat, TRUE
FROM projects p
CROSS JOIN (VALUES
  ('error'::alert_category),
  ('performance'::alert_category),
  ('deployment'::alert_category),
  ('cron'::alert_category),
  ('release'::alert_category),
  ('usage'::alert_category),
  ('billing'::alert_category),
  ('security'::alert_category),
  ('ai'::alert_category)
) AS v(cat)
WHERE p.deleted_at IS NULL
ON CONFLICT (project_id, category) DO NOTHING;

-- Source: migrations/003_project_module_refactor.sql
INSERT INTO project_environments (project_id, organization_id, name, slug, is_default)
SELECT p.id, p.org_id, 'Production', 'production', TRUE
FROM projects p
LEFT JOIN project_environments e ON e.project_id = p.id
WHERE e.id IS NULL AND p.deleted_at IS NULL
ON CONFLICT (project_id, slug) DO NOTHING;

-- Source: migrations/003_project_module_refactor.sql
INSERT INTO project_settings (
  project_id, organization_id, data_retention_days, sampling_rate, allowed_domains, blocked_domains,
  pii_scrubbing_enabled, ip_collection_enabled, release_tracking_enabled, session_replay_enabled,
  performance_monitoring_enabled, error_monitoring_enabled, log_ingestion_enabled, metric_ingestion_enabled,
  trace_ingestion_enabled, profile_ingestion_enabled, version
)
SELECT p.id, p.org_id
  , 10, 1.00000, '{}'::text[], '{}'::text[]
  , true, true, true, false
  , true, true, true, true
  , true, true, 1
FROM projects p
LEFT JOIN project_settings s ON s.project_id = p.id
WHERE s.id IS NULL
ON CONFLICT (project_id) DO NOTHING;

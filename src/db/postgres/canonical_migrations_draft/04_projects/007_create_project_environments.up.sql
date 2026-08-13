BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility project_visibility,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tags TEXT[],
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version INTEGER;

UPDATE projects SET visibility = 'private' WHERE visibility IS NULL;
UPDATE projects SET timezone = 'UTC' WHERE timezone IS NULL;
UPDATE projects SET tags = '{}'::text[] WHERE tags IS NULL;
UPDATE projects SET metadata = '{}'::jsonb WHERE metadata IS NULL;
UPDATE projects SET version = 1 WHERE version IS NULL;
ALTER TABLE projects
  ALTER COLUMN visibility SET DEFAULT 'private', ALTER COLUMN visibility SET NOT NULL,
  ALTER COLUMN timezone SET DEFAULT 'UTC', ALTER COLUMN timezone SET NOT NULL,
  ALTER COLUMN tags SET DEFAULT '{}'::text[], ALTER COLUMN tags SET NOT NULL,
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb, ALTER COLUMN metadata SET NOT NULL,
  ALTER COLUMN version SET DEFAULT 1, ALTER COLUMN version SET NOT NULL;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_org_id_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_id_org ON projects(id, org_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_active_slug
  ON projects(org_id, lower(slug)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_org_active
  ON projects(org_id, status, created_at DESC) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_settings' AND column_name='retention_days')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_settings' AND column_name='data_retention_days') THEN
    ALTER TABLE project_settings RENAME COLUMN retention_days TO data_retention_days;
  END IF;
END $$;

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS data_retention_days INTEGER,
  ADD COLUMN IF NOT EXISTS sampling_rate NUMERIC(6,5),
  ADD COLUMN IF NOT EXISTS allowed_domains TEXT[],
  ADD COLUMN IF NOT EXISTS blocked_domains TEXT[],
  ADD COLUMN IF NOT EXISTS pii_scrubbing_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS ip_collection_enabled BOOLEAN;
ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS release_tracking_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS session_replay_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS performance_monitoring_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS error_monitoring_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS log_ingestion_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS metric_ingestion_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS trace_ingestion_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS profile_ingestion_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS version INTEGER;
UPDATE project_settings SET
  organization_id = p.org_id,
  data_retention_days = COALESCE(data_retention_days, 30),
  sampling_rate = COALESCE(sampling_rate, 1),
  allowed_domains = COALESCE(allowed_domains, '{}'::text[]),
  blocked_domains = COALESCE(blocked_domains, '{}'::text[]),
  pii_scrubbing_enabled = COALESCE(pii_scrubbing_enabled, true),
  ip_collection_enabled = COALESCE(ip_collection_enabled, true),
  release_tracking_enabled = COALESCE(release_tracking_enabled, true),
  session_replay_enabled = COALESCE(session_replay_enabled, false),
  performance_monitoring_enabled = COALESCE(performance_monitoring_enabled, true),
  error_monitoring_enabled = COALESCE(error_monitoring_enabled, true),
  log_ingestion_enabled = COALESCE(log_ingestion_enabled, true),
  metric_ingestion_enabled = COALESCE(metric_ingestion_enabled, true),
  trace_ingestion_enabled = COALESCE(trace_ingestion_enabled, true),
  profile_ingestion_enabled = COALESCE(profile_ingestion_enabled, true),
  created_at = COALESCE(project_settings.created_at, NOW()),
  updated_at = COALESCE(project_settings.updated_at, NOW()),
  version = COALESCE(project_settings.version, 1)
FROM projects p WHERE p.id = project_settings.project_id;
ALTER TABLE project_settings
  ALTER COLUMN data_retention_days SET DEFAULT 10, ALTER COLUMN data_retention_days SET NOT NULL,
  ALTER COLUMN sampling_rate SET DEFAULT 1, ALTER COLUMN sampling_rate SET NOT NULL,
  ALTER COLUMN allowed_domains SET DEFAULT '{}'::text[], ALTER COLUMN allowed_domains SET NOT NULL,
  ALTER COLUMN blocked_domains SET DEFAULT '{}'::text[], ALTER COLUMN blocked_domains SET NOT NULL,
  ALTER COLUMN pii_scrubbing_enabled SET DEFAULT true, ALTER COLUMN pii_scrubbing_enabled SET NOT NULL,
  ALTER COLUMN ip_collection_enabled SET DEFAULT true, ALTER COLUMN ip_collection_enabled SET NOT NULL,
  ALTER COLUMN release_tracking_enabled SET DEFAULT true, ALTER COLUMN release_tracking_enabled SET NOT NULL,
  ALTER COLUMN session_replay_enabled SET DEFAULT false, ALTER COLUMN session_replay_enabled SET NOT NULL,
  ALTER COLUMN performance_monitoring_enabled SET DEFAULT true, ALTER COLUMN performance_monitoring_enabled SET NOT NULL,
  ALTER COLUMN error_monitoring_enabled SET DEFAULT true, ALTER COLUMN error_monitoring_enabled SET NOT NULL,
  ALTER COLUMN log_ingestion_enabled SET DEFAULT true, ALTER COLUMN log_ingestion_enabled SET NOT NULL,
  ALTER COLUMN metric_ingestion_enabled SET DEFAULT true, ALTER COLUMN metric_ingestion_enabled SET NOT NULL,
  ALTER COLUMN trace_ingestion_enabled SET DEFAULT true, ALTER COLUMN trace_ingestion_enabled SET NOT NULL,
  ALTER COLUMN profile_ingestion_enabled SET DEFAULT true, ALTER COLUMN profile_ingestion_enabled SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(), ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(), ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN version SET DEFAULT 1, ALTER COLUMN version SET NOT NULL;
ALTER TABLE project_settings DROP CONSTRAINT IF EXISTS project_settings_sampling_rate_check;
ALTER TABLE project_settings ADD CONSTRAINT project_settings_sampling_rate_check CHECK (sampling_rate >= 0 AND sampling_rate <= 1);
ALTER TABLE project_settings DROP CONSTRAINT IF EXISTS project_settings_data_retention_days_check;
ALTER TABLE project_settings ADD CONSTRAINT project_settings_data_retention_days_check CHECK (data_retention_days > 0);
ALTER TABLE project_settings
  DROP COLUMN IF EXISTS max_events_per_second,
  DROP COLUMN IF EXISTS auto_archive,
  DROP COLUMN IF EXISTS alerting_enabled,
  DROP COLUMN IF EXISTS ingestion_enabled,
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS retention_days;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_environment_type') THEN
    CREATE TYPE project_environment_type AS ENUM (
      'production', 'pre_production', 'staging', 'pre_staging', 'development',
      'testing', 'preview', 'pre_deployment', 'custom'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  type project_environment_type NOT NULL DEFAULT 'custom',
  description TEXT,
  color VARCHAR(7) NOT NULL DEFAULT '#64748B',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT project_environments_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT project_environments_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT project_environments_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT project_environments_default_active_check CHECK (NOT is_default OR is_active)
);
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_environments_active_slug
  ON project_environments(project_id, slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_environments_default
  ON project_environments(project_id) WHERE is_default AND is_active AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_environments_tenant_id
  ON project_environments(id, project_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_project_environments_org_type
  ON project_environments(organization_id, type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_environments_project_list
  ON project_environments(project_id, is_active, type, name) WHERE deleted_at IS NULL;

ALTER TABLE project_releases
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS environment_id UUID REFERENCES project_environments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_releases' AND column_name='environment') THEN
    EXECUTE $sql$
      UPDATE project_releases r SET organization_id=p.org_id, environment_id=e.id
      FROM projects p, project_environments e
      WHERE p.id=r.project_id AND e.project_id=p.id
        AND e.slug=r.environment::text AND e.deleted_at IS NULL
    $sql$;
  END IF;
END $$;
UPDATE project_releases r SET
  organization_id=p.org_id,
  environment_id=COALESCE(r.environment_id,e.id),
  created_at=COALESCE(r.created_at,r.released_at,NOW()),
  updated_at=COALESCE(r.updated_at,r.released_at,NOW())
FROM projects p JOIN project_environments e
  ON e.project_id=p.id AND e.slug='production' AND e.deleted_at IS NULL
WHERE p.id=r.project_id;
ALTER TABLE project_releases
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN environment_id SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(), ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(), ALTER COLUMN updated_at SET NOT NULL;
DROP INDEX IF EXISTS idx_project_releases_environment;
DROP INDEX IF EXISTS idx_project_releases_project_env_time;
ALTER TABLE project_releases DROP COLUMN IF EXISTS environment;
CREATE INDEX IF NOT EXISTS idx_project_releases_environment ON project_releases(environment_id);
CREATE INDEX IF NOT EXISTS idx_project_releases_project_env_time ON project_releases(project_id,environment_id,released_at DESC);

ALTER TABLE projects DROP COLUMN IF EXISTS default_environment;
COMMENT ON TABLE projects IS 'Lightweight tenant-scoped application containers; operational configuration is normalized into project tables.';
COMMENT ON TABLE project_settings IS 'Exact operational settings for one project.';
COMMENT ON TABLE project_environments IS 'Server-slugged first-class project environments.';
COMMENT ON COLUMN project_releases.environment_id IS 'First-class environment scope; replaces the legacy project_environment enum.';
COMMIT;

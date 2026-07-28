BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_environment_type') THEN
    CREATE TYPE project_environment_type AS ENUM (
      'production', 'pre_production', 'staging', 'pre_staging', 'development',
      'testing', 'preview', 'pre_deployment', 'custom'
    );
  END IF;
END $$;

-- Commit enum labels before the data transaction. PostgreSQL does not allow a
-- newly added label to be used until the transaction that added it commits.
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'production';
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'pre_production';
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'staging';
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'pre_staging';
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'development';
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'testing';
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'preview';
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'pre_deployment';
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'custom';

COMMIT;

BEGIN;

ALTER TABLE project_environments
  ADD COLUMN IF NOT EXISTS type project_environment_type;

UPDATE project_environments
SET type = CASE
  WHEN lower(replace(slug, '_', '-')) = 'production' THEN 'production'::project_environment_type
  WHEN lower(replace(slug, '_', '-')) IN ('pre-production','preproduction') THEN 'pre_production'::project_environment_type
  WHEN lower(replace(slug, '_', '-')) = 'staging' THEN 'staging'::project_environment_type
  WHEN lower(replace(slug, '_', '-')) IN ('pre-staging','prestaging') THEN 'pre_staging'::project_environment_type
  WHEN lower(replace(slug, '_', '-')) = 'development' THEN 'development'::project_environment_type
  WHEN lower(replace(slug, '_', '-')) IN ('testing','test','qa') THEN 'testing'::project_environment_type
  WHEN lower(replace(slug, '_', '-')) = 'preview' THEN 'preview'::project_environment_type
  WHEN lower(replace(slug, '_', '-')) IN ('pre-deployment','predeployment') THEN 'pre_deployment'::project_environment_type
  ELSE 'custom'::project_environment_type
END
WHERE type IS NULL;

UPDATE project_environments SET color = '#64748B' WHERE color IS NULL OR color !~ '^#[0-9A-Fa-f]{6}$';
UPDATE project_environments SET is_default = FALSE WHERE is_default AND (NOT is_active OR deleted_at IS NOT NULL);

ALTER TABLE project_environments
  ALTER COLUMN type SET DEFAULT 'custom',
  ALTER COLUMN type SET NOT NULL,
  ALTER COLUMN color TYPE VARCHAR(7),
  ALTER COLUMN color SET DEFAULT '#64748B',
  ALTER COLUMN color SET NOT NULL;

ALTER TABLE project_environments
  DROP CONSTRAINT IF EXISTS project_environments_runtime_limits_check,
  DROP CONSTRAINT IF EXISTS project_environments_name_check,
  DROP CONSTRAINT IF EXISTS project_environments_slug_check,
  DROP CONSTRAINT IF EXISTS project_environments_color_check,
  DROP CONSTRAINT IF EXISTS project_environments_default_active_check;
ALTER TABLE project_environments
  ADD CONSTRAINT project_environments_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  ADD CONSTRAINT project_environments_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  ADD CONSTRAINT project_environments_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT project_environments_default_active_check CHECK (NOT is_default OR is_active);

ALTER TABLE project_environments
  DROP COLUMN IF EXISTS icon,
  DROP COLUMN IF EXISTS created_by_user_id,
  DROP COLUMN IF EXISTS created_by_api_key_id,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS rate_limit_per_second,
  DROP COLUMN IF EXISTS rate_limit_per_minute,
  DROP COLUMN IF EXISTS rate_limit_per_hour,
  DROP COLUMN IF EXISTS burst_limit,
  DROP COLUMN IF EXISTS allowed_event_types,
  DROP COLUMN IF EXISTS max_event_size_bytes,
  DROP COLUMN IF EXISTS max_batch_size,
  DROP COLUMN IF EXISTS require_https,
  DROP COLUMN IF EXISTS ip_allowlist,
  DROP COLUMN IF EXISTS ip_blocklist,
  DROP COLUMN IF EXISTS alert_email,
  DROP COLUMN IF EXISTS alert_webhook_url;

DROP INDEX IF EXISTS idx_project_environments_tenant;
DROP INDEX IF EXISTS idx_project_environments_org_type;
DROP INDEX IF EXISTS idx_project_environments_project_list;
DROP INDEX IF EXISTS uq_project_environments_default;

CREATE UNIQUE INDEX uq_project_environments_default
  ON project_environments(project_id)
  WHERE is_default AND is_active AND deleted_at IS NULL;
CREATE INDEX idx_project_environments_org_type
  ON project_environments(organization_id, type)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_project_environments_project_list
  ON project_environments(project_id, is_active, type, name)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION provision_environment_sdk_config() RETURNS trigger AS $$
DECLARE
  head_id UUID := gen_random_uuid();
  revision_id UUID := gen_random_uuid();
  empty_hash TEXT := encode(digest(('{}'::jsonb)::text, 'sha256'), 'hex');
BEGIN
  INSERT INTO project_environment_sdk_configs(
    id, organization_id, project_id, environment_id, published_revision_id,
    current_revision, current_hash
  ) VALUES(
    head_id, NEW.organization_id, NEW.project_id, NEW.id, revision_id,
    1, empty_hash
  );

  INSERT INTO project_environment_sdk_config_revisions(
    id, config_id, organization_id, project_id, environment_id, revision_number,
    config_value, config_hash, change_type, change_summary
  ) VALUES(
    revision_id, head_id, NEW.organization_id, NEW.project_id, NEW.id, 1,
    '{}'::jsonb, empty_hash, 'initial', 'Initial environment SDK configuration'
  );
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

COMMENT ON TYPE project_environment_type IS
  'Stable environment business classification; slugs remain editable SDK-facing identifiers.';
COMMENT ON TABLE project_environments IS
  'Tenant-scoped deployment environments with user-facing identity and lifecycle only.';
COMMENT ON INDEX uq_project_environments_active_slug IS
  'Prevents duplicate non-deleted SDK-facing slugs within a project.';
COMMENT ON INDEX uq_project_environments_default IS
  'Guarantees at most one active default environment per project.';
COMMENT ON INDEX uq_project_environments_tenant_id IS
  'Supports composite tenant-safe foreign keys from API keys, releases, usage, and SDK configuration.';
COMMENT ON INDEX idx_project_environments_org_type IS
  'Supports organization entitlement counts and type filtering without scanning all environments.';
COMMENT ON INDEX idx_project_environments_project_list IS
  'Supports project environment lists filtered by status/type and ordered by name.';

COMMIT;
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_api_keys' AND column_name='key_hash')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_api_keys' AND column_name='secret_hash') THEN
    ALTER TABLE project_api_keys RENAME COLUMN key_hash TO secret_hash;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_api_keys' AND column_name='key_prefix')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_api_keys' AND column_name='public_key') THEN
    ALTER TABLE project_api_keys RENAME COLUMN key_prefix TO public_key;
  END IF;
END $$;

ALTER TABLE project_api_keys
  ADD COLUMN IF NOT EXISTS environment_id UUID REFERENCES project_environments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS public_key VARCHAR(128),
  ADD COLUMN IF NOT EXISTS secret_hash TEXT,
  ADD COLUMN IF NOT EXISTS key_type api_key_type,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS rotated_from_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rotated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotation_reason TEXT,
  ADD COLUMN IF NOT EXISTS rotation_state api_key_rotation_state,
  ADD COLUMN IF NOT EXISTS rotation_version INTEGER,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
  ADD COLUMN IF NOT EXISTS auto_rotate_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS auto_rotate_days INTEGER,
  ADD COLUMN IF NOT EXISTS last_used_ip INET,
  ADD COLUMN IF NOT EXISTS usage_count BIGINT,
  ADD COLUMN IF NOT EXISTS error_count BIGINT,
  ADD COLUMN IF NOT EXISTS rate_limit_per_second INTEGER,
  ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS rate_limit_per_hour INTEGER,
  ADD COLUMN IF NOT EXISTS permissions JSONB,
  ADD COLUMN IF NOT EXISTS allowed_endpoints TEXT[],
  ADD COLUMN IF NOT EXISTS blocked_endpoints TEXT[],
  ADD COLUMN IF NOT EXISTS allowed_sdks TEXT[],
  ADD COLUMN IF NOT EXISTS allowed_origins TEXT[],
  ADD COLUMN IF NOT EXISTS allowed_ips INET[],
  ADD COLUMN IF NOT EXISTS allowed_domains TEXT[],
  ADD COLUMN IF NOT EXISTS allowed_event_types TEXT[],
  ADD COLUMN IF NOT EXISTS sampling_rules JSONB,
  ADD COLUMN IF NOT EXISTS feature_flags JSONB,
  ADD COLUMN IF NOT EXISTS sdk_config JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS version INTEGER;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_api_keys' AND column_name='environment') THEN
    EXECUTE $sql$
      UPDATE project_api_keys k SET environment_id=e.id
      FROM project_environments e
      WHERE e.project_id=k.project_id AND e.organization_id=k.organization_id
        AND e.slug=CASE k.environment::text WHEN 'development' THEN 'development' ELSE 'production' END
        AND e.deleted_at IS NULL AND k.environment_id IS NULL
    $sql$;
    EXECUTE $sql$
      UPDATE project_api_keys SET
        public_key=public_key||'_'||left(replace(id::text,'-',''),12),
        status='rotated', is_active=false,
        rotation_state='completed', rotated_at=COALESCE(rotated_at,NOW()),
        rotation_reason=COALESCE(rotation_reason,'Legacy key format requires rotation; raw key material was not retained')
    $sql$;
  END IF;
END $$;
UPDATE project_api_keys k SET
  organization_id=p.org_id,
  environment_id=COALESCE(k.environment_id,e.id),
  key_type=COALESCE(k.key_type,'read_write'),
  is_active=COALESCE(k.is_active,k.status='active'),
  rotation_state=COALESCE(k.rotation_state,'none'),
  rotation_version=COALESCE(k.rotation_version,1),
  auto_rotate_enabled=COALESCE(k.auto_rotate_enabled,false),
  usage_count=COALESCE(k.usage_count,0), error_count=COALESCE(k.error_count,0),
  rate_limit_per_second=COALESCE(k.rate_limit_per_second,100),
  rate_limit_per_minute=COALESCE(k.rate_limit_per_minute,3000),
  rate_limit_per_hour=COALESCE(k.rate_limit_per_hour,100000),
  permissions=COALESCE(k.permissions,'[]'::jsonb),
  allowed_endpoints=COALESCE(k.allowed_endpoints,'{}'::text[]), blocked_endpoints=COALESCE(k.blocked_endpoints,'{}'::text[]),
  allowed_sdks=COALESCE(k.allowed_sdks,'{}'::text[]), allowed_origins=COALESCE(k.allowed_origins,'{}'::text[]),
  allowed_ips=COALESCE(k.allowed_ips,'{}'::inet[]), allowed_domains=COALESCE(k.allowed_domains,'{}'::text[]),
  allowed_event_types=COALESCE(k.allowed_event_types,'{}'::text[]), sampling_rules=COALESCE(k.sampling_rules,'{}'::jsonb),
  feature_flags=COALESCE(k.feature_flags,'{}'::jsonb), sdk_config=COALESCE(k.sdk_config,'{}'::jsonb),
  metadata=COALESCE(k.metadata,'{}'::jsonb), version=COALESCE(k.version,1)
FROM projects p
JOIN project_environments e ON e.project_id=p.id AND e.slug='production' AND e.deleted_at IS NULL
WHERE p.id=k.project_id;
ALTER TABLE project_api_keys
  ALTER COLUMN public_key TYPE VARCHAR(128),
  ALTER COLUMN environment_id SET NOT NULL,
  ALTER COLUMN public_key SET NOT NULL,
  ALTER COLUMN secret_hash SET NOT NULL,
  ALTER COLUMN key_type SET DEFAULT 'read_write', ALTER COLUMN key_type SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT true, ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN rotation_state SET DEFAULT 'none', ALTER COLUMN rotation_state SET NOT NULL,
  ALTER COLUMN rotation_version SET DEFAULT 1, ALTER COLUMN rotation_version SET NOT NULL,
  ALTER COLUMN auto_rotate_enabled SET DEFAULT false, ALTER COLUMN auto_rotate_enabled SET NOT NULL,
  ALTER COLUMN usage_count SET DEFAULT 0, ALTER COLUMN usage_count SET NOT NULL,
  ALTER COLUMN error_count SET DEFAULT 0, ALTER COLUMN error_count SET NOT NULL,
  ALTER COLUMN rate_limit_per_second SET DEFAULT 100, ALTER COLUMN rate_limit_per_second SET NOT NULL,
  ALTER COLUMN rate_limit_per_minute SET DEFAULT 3000, ALTER COLUMN rate_limit_per_minute SET NOT NULL,
  ALTER COLUMN rate_limit_per_hour SET DEFAULT 100000, ALTER COLUMN rate_limit_per_hour SET NOT NULL,
  ALTER COLUMN permissions SET DEFAULT '[]'::jsonb, ALTER COLUMN permissions SET NOT NULL,
  ALTER COLUMN allowed_endpoints SET DEFAULT '{}'::text[], ALTER COLUMN allowed_endpoints SET NOT NULL,
  ALTER COLUMN blocked_endpoints SET DEFAULT '{}'::text[], ALTER COLUMN blocked_endpoints SET NOT NULL,
  ALTER COLUMN allowed_sdks SET DEFAULT '{}'::text[], ALTER COLUMN allowed_sdks SET NOT NULL,
  ALTER COLUMN allowed_origins SET DEFAULT '{}'::text[], ALTER COLUMN allowed_origins SET NOT NULL,
  ALTER COLUMN allowed_ips SET DEFAULT '{}'::inet[], ALTER COLUMN allowed_ips SET NOT NULL,
  ALTER COLUMN allowed_domains SET DEFAULT '{}'::text[], ALTER COLUMN allowed_domains SET NOT NULL,
  ALTER COLUMN allowed_event_types SET DEFAULT '{}'::text[], ALTER COLUMN allowed_event_types SET NOT NULL,
  ALTER COLUMN sampling_rules SET DEFAULT '{}'::jsonb, ALTER COLUMN sampling_rules SET NOT NULL,
  ALTER COLUMN feature_flags SET DEFAULT '{}'::jsonb, ALTER COLUMN feature_flags SET NOT NULL,
  ALTER COLUMN sdk_config SET DEFAULT '{}'::jsonb, ALTER COLUMN sdk_config SET NOT NULL,
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb, ALTER COLUMN metadata SET NOT NULL,
  ALTER COLUMN version SET DEFAULT 1, ALTER COLUMN version SET NOT NULL;
ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_usage_count_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_usage_count_check CHECK (usage_count >= 0 AND error_count >= 0);
ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_rate_limits_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_rate_limits_check CHECK (rate_limit_per_second > 0 AND rate_limit_per_minute > 0 AND rate_limit_per_hour > 0);
ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_auto_rotate_days_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_auto_rotate_days_check CHECK (auto_rotate_days IS NULL OR auto_rotate_days > 0);
DROP INDEX IF EXISTS idx_api_keys_prefix;
DROP INDEX IF EXISTS idx_api_keys_project_env;
ALTER TABLE project_api_keys DROP COLUMN IF EXISTS environment, DROP COLUMN IF EXISTS key_hash, DROP COLUMN IF EXISTS key_prefix, DROP COLUMN IF EXISTS scopes;
DROP TYPE IF EXISTS project_environment;
DROP INDEX IF EXISTS uq_project_api_keys_active_public_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_api_keys_public_key
  ON project_api_keys(public_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_api_keys_public_key ON project_api_keys(public_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_api_keys_tenant_env ON project_api_keys(organization_id, project_id, environment_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_api_keys_lifecycle ON project_api_keys(status, expires_at, grace_period_ends_at) WHERE deleted_at IS NULL;
COMMENT ON TABLE project_api_keys IS 'Canonical project credentials with server-owned public lookup keys and hash-only secrets.';
COMMENT ON COLUMN project_api_keys.public_key IS 'Server-generated platform-owned public lookup component; never accepted from users.';
COMMENT ON COLUMN project_api_keys.secret_hash IS 'One-way verifier only; raw API-key secrets are never persisted.';
COMMIT;

-- ============================================================================
-- 007_organizations_create_sdk_config_schema.up.sql
-- ----------------------------------------------------------------------------
-- Enterprise SDK remote-config management schema.
--
-- This migration intentionally does not add a foreign key from sdk_configs to
-- projects because migrations2/008 creates projects after this file runs. The
-- FK is attached from 008 once projects exists.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1) SDK CONFIGS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdk_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID,

    config_key VARCHAR(255) NOT NULL,
    config_type VARCHAR(32) NOT NULL DEFAULT 'json'
      CHECK (config_type IN ('json','yaml','env','feature_flag')),

    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    version_hash VARCHAR(128) NOT NULL,
    is_latest BOOLEAN NOT NULL DEFAULT TRUE,

    config_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    schema_version VARCHAR(50),
    environment VARCHAR(50) NOT NULL DEFAULT 'all',
    target_sdk_versions TEXT[],
    target_platforms TEXT[],
    rollout_percentage INTEGER NOT NULL DEFAULT 100
      CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (config_key ~ '^[A-Za-z0-9._:-]+$')
);

ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS config_type VARCHAR(32) NOT NULL DEFAULT 'json';
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS version_hash VARCHAR(128);
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS is_latest BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS config_value JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS schema_version VARCHAR(50);
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS environment VARCHAR(50) NOT NULL DEFAULT 'all';
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS target_sdk_versions TEXT[];
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS target_platforms TEXT[];
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS rollout_percentage INTEGER NOT NULL DEFAULT 100;
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE sdk_configs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE sdk_configs
   SET version_hash = encode(digest(config_value::text, 'sha256'), 'hex')
 WHERE version_hash IS NULL;

ALTER TABLE sdk_configs ALTER COLUMN version_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sdk_configs_live_scope
  ON sdk_configs(
    org_id,
    (COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    config_key,
    environment
  )
  WHERE is_latest = TRUE;

CREATE INDEX IF NOT EXISTS idx_sdk_configs_org_active
  ON sdk_configs(org_id, is_active, environment)
  WHERE is_latest = TRUE;
CREATE INDEX IF NOT EXISTS idx_sdk_configs_project_active
  ON sdk_configs(project_id, environment, config_key)
  WHERE project_id IS NOT NULL AND is_latest = TRUE AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_sdk_configs_value_gin
  ON sdk_configs USING GIN (config_value);

DROP TRIGGER IF EXISTS trg_sdk_configs_updated_at ON sdk_configs;
CREATE TRIGGER trg_sdk_configs_updated_at BEFORE UPDATE ON sdk_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sdk_configs IS
  'Authoritative SDK remote configuration rows scoped to organization and optionally project/environment.';

-- ----------------------------------------------------------------------------
-- 2) IMMUTABLE VERSION HISTORY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdk_config_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES sdk_configs(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version > 0),
    version_hash VARCHAR(128) NOT NULL,
    config_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    config_value_encrypted TEXT,

    change_type VARCHAR(32) NOT NULL DEFAULT 'create'
      CHECK (change_type IN ('create','update','rollback','delete')),
    change_summary TEXT,
    change_diff JSONB,
    rolled_back_at TIMESTAMPTZ,
    rolled_back_by UUID REFERENCES users(id) ON DELETE SET NULL,
    rolled_back_to_version INTEGER,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (config_id, version)
);

CREATE INDEX IF NOT EXISTS idx_sdk_config_versions_config
  ON sdk_config_versions(config_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_sdk_config_versions_created_at
  ON sdk_config_versions(created_at DESC);

-- ----------------------------------------------------------------------------
-- 3) DEPLOYMENT TRACKING
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdk_config_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES sdk_configs(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version > 0),
    status VARCHAR(32) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','deploying','deployed','failed','rolled_back')),
    rollout_percentage INTEGER NOT NULL DEFAULT 100
      CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    target_count INTEGER CHECK (target_count IS NULL OR target_count >= 0),
    reached_count INTEGER NOT NULL DEFAULT 0 CHECK (reached_count >= 0),
    error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    last_error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (config_id, version)
);

CREATE INDEX IF NOT EXISTS idx_sdk_config_deployments_config
  ON sdk_config_deployments(config_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_sdk_config_deployments_status
  ON sdk_config_deployments(status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_sdk_config_deployments_updated_at ON sdk_config_deployments;
CREATE TRIGGER trg_sdk_config_deployments_updated_at BEFORE UPDATE ON sdk_config_deployments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) PLAN-GATED FIELD POLICIES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdk_config_field_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_key VARCHAR(64) NOT NULL,
    config_path VARCHAR(255) NOT NULL,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    is_editable BOOLEAN NOT NULL DEFAULT FALSE,
    min_numeric NUMERIC,
    max_numeric NUMERIC,
    allowed_values JSONB,
    default_value JSONB,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (plan_key, config_path)
);

CREATE INDEX IF NOT EXISTS idx_sdk_config_field_policies_plan
  ON sdk_config_field_policies(plan_key, config_path);

DROP TRIGGER IF EXISTS trg_sdk_config_field_policies_updated_at ON sdk_config_field_policies;
CREATE TRIGGER trg_sdk_config_field_policies_updated_at BEFORE UPDATE ON sdk_config_field_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 5) DEFAULT CONFIG TEMPLATES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sdk_config_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_key VARCHAR(64) NOT NULL,
    environment VARCHAR(50) NOT NULL,
    config_key VARCHAR(255) NOT NULL,
    config_type VARCHAR(32) NOT NULL DEFAULT 'json'
      CHECK (config_type IN ('json','yaml','env','feature_flag')),
    config_value JSONB NOT NULL,
    schema_version VARCHAR(50) NOT NULL DEFAULT '1',
    target_sdk_versions TEXT[],
    target_platforms TEXT[],
    rollout_percentage INTEGER NOT NULL DEFAULT 100
      CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (plan_key, environment, config_key)
);

CREATE INDEX IF NOT EXISTS idx_sdk_config_templates_plan_env
  ON sdk_config_templates(plan_key, environment)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_sdk_config_templates_value_gin
  ON sdk_config_templates USING GIN (config_value);

DROP TRIGGER IF EXISTS trg_sdk_config_templates_updated_at ON sdk_config_templates;
CREATE TRIGGER trg_sdk_config_templates_updated_at BEFORE UPDATE ON sdk_config_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 6) CLIENT-SAFE VIEW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW sdk_config_client_view AS
SELECT
  c.id,
  c.org_id,
  c.project_id,
  c.config_key,
  c.version,
  c.version_hash,
  c.schema_version,
  c.environment,
  jsonb_build_object(
    'schemaVersion', COALESCE((c.config_value #>> '{schemaVersion}')::integer, 1),
    'sdk', COALESCE(c.config_value -> 'sdk', '{}'::jsonb),
    'features', COALESCE(c.config_value -> 'features', '{}'::jsonb),
    'sampling', COALESCE(c.config_value -> 'sampling', '{}'::jsonb),
    'instrumentation', COALESCE(c.config_value -> 'instrumentation', '{}'::jsonb),
    'privacy', COALESCE(c.config_value -> 'privacy', '{}'::jsonb),
    'limits', COALESCE(c.config_value -> 'limits', '{}'::jsonb),
    'killswitches', COALESCE(c.config_value -> 'killswitches', '{}'::jsonb),
    'routes', COALESCE(c.config_value -> 'routes', '{}'::jsonb),
    'ingestBaseUrl', c.config_value -> 'ingestBaseUrl'
  ) AS client_config,
  c.target_sdk_versions,
  c.target_platforms,
  c.rollout_percentage,
  c.is_active,
  c.created_at,
  c.updated_at
FROM sdk_configs c
WHERE c.is_latest = TRUE
  AND c.is_active = TRUE;

COMMENT ON VIEW sdk_config_client_view IS
  'Client-safe SDK configuration projection. Backend-only transport, runtime, meta and security fields are intentionally omitted.';

-- ----------------------------------------------------------------------------
-- 7) SEED FIELD POLICIES AND DEFAULT TEMPLATES
-- ----------------------------------------------------------------------------
INSERT INTO sdk_config_field_policies
  (plan_key, config_path, is_visible, is_editable, min_numeric, max_numeric, default_value, description)
VALUES
  ('free','features.metrics',FALSE,FALSE,NULL,NULL,'false'::jsonb,'Custom metrics collection'),
  ('pro','features.metrics',TRUE,TRUE,NULL,NULL,'false'::jsonb,'Custom metrics collection'),
  ('enterprise','features.metrics',TRUE,TRUE,NULL,NULL,'false'::jsonb,'Custom metrics collection'),
  ('free','features.logging',FALSE,FALSE,NULL,NULL,'false'::jsonb,'Log ingestion'),
  ('pro','features.logging',TRUE,TRUE,NULL,NULL,'false'::jsonb,'Log ingestion'),
  ('enterprise','features.logging',TRUE,TRUE,NULL,NULL,'false'::jsonb,'Log ingestion'),
  ('free','features.profiling',FALSE,FALSE,NULL,NULL,'false'::jsonb,'CPU and memory profiling'),
  ('pro','features.profiling',FALSE,FALSE,NULL,NULL,'false'::jsonb,'CPU and memory profiling'),
  ('enterprise','features.profiling',TRUE,TRUE,NULL,NULL,'false'::jsonb,'CPU and memory profiling'),
  ('free','features.sessionReplay',FALSE,FALSE,NULL,NULL,'false'::jsonb,'Session replay capture'),
  ('pro','features.sessionReplay',FALSE,FALSE,NULL,NULL,'false'::jsonb,'Session replay capture'),
  ('enterprise','features.sessionReplay',TRUE,TRUE,NULL,NULL,'false'::jsonb,'Session replay capture'),
  ('free','sampling.traces',TRUE,TRUE,0,0.1,'0.1'::jsonb,'Trace sampling rate'),
  ('pro','sampling.traces',TRUE,TRUE,0,1.0,'0.1'::jsonb,'Trace sampling rate'),
  ('enterprise','sampling.traces',TRUE,TRUE,0,1.0,'0.1'::jsonb,'Trace sampling rate'),
  ('free','sampling.requests',TRUE,TRUE,0,0.1,'0.1'::jsonb,'Request sampling rate'),
  ('pro','sampling.requests',TRUE,TRUE,0,1.0,'0.1'::jsonb,'Request sampling rate'),
  ('enterprise','sampling.requests',TRUE,TRUE,0,1.0,'0.1'::jsonb,'Request sampling rate'),
  ('free','sampling.profiles',TRUE,FALSE,0,0,'0.0'::jsonb,'Profile sampling rate'),
  ('pro','sampling.profiles',TRUE,FALSE,0,0,'0.0'::jsonb,'Profile sampling rate'),
  ('enterprise','sampling.profiles',TRUE,TRUE,0,0.1,'0.0'::jsonb,'Profile sampling rate'),
  ('free','sampling.replays',TRUE,FALSE,0,0,'0.0'::jsonb,'Replay sampling rate'),
  ('pro','sampling.replays',TRUE,FALSE,0,0,'0.0'::jsonb,'Replay sampling rate'),
  ('enterprise','sampling.replays',TRUE,TRUE,0,0.1,'0.0'::jsonb,'Replay sampling rate'),
  ('free','limits.maxSpansPerTrace',TRUE,FALSE,100,100,'100'::jsonb,'Max spans in a trace'),
  ('pro','limits.maxSpansPerTrace',TRUE,TRUE,100,2000,'100'::jsonb,'Max spans in a trace'),
  ('enterprise','limits.maxSpansPerTrace',TRUE,TRUE,100,10000,'100'::jsonb,'Max spans in a trace'),
  ('free','limits.maxSpanAttributes',TRUE,FALSE,50,50,'50'::jsonb,'Max attributes per span'),
  ('pro','limits.maxSpanAttributes',TRUE,TRUE,50,250,'50'::jsonb,'Max attributes per span'),
  ('enterprise','limits.maxSpanAttributes',TRUE,TRUE,50,1000,'50'::jsonb,'Max attributes per span'),
  ('free','limits.maxAttributeLength',TRUE,FALSE,4096,4096,'4096'::jsonb,'Max string length per attribute'),
  ('pro','limits.maxAttributeLength',TRUE,TRUE,4096,8192,'4096'::jsonb,'Max string length per attribute'),
  ('enterprise','limits.maxAttributeLength',TRUE,TRUE,4096,16384,'4096'::jsonb,'Max string length per attribute'),
  ('free','instrumentation.mongodb',FALSE,FALSE,NULL,NULL,'false'::jsonb,'MongoDB driver instrumentation'),
  ('pro','instrumentation.mongodb',TRUE,TRUE,NULL,NULL,'false'::jsonb,'MongoDB driver instrumentation'),
  ('enterprise','instrumentation.mongodb',TRUE,TRUE,NULL,NULL,'false'::jsonb,'MongoDB driver instrumentation'),
  ('free','instrumentation.redis',FALSE,FALSE,NULL,NULL,'false'::jsonb,'Redis driver instrumentation'),
  ('pro','instrumentation.redis',FALSE,FALSE,NULL,NULL,'false'::jsonb,'Redis driver instrumentation'),
  ('enterprise','instrumentation.redis',TRUE,TRUE,NULL,NULL,'false'::jsonb,'Redis driver instrumentation')
ON CONFLICT (plan_key, config_path) DO UPDATE
SET is_visible = EXCLUDED.is_visible,
    is_editable = EXCLUDED.is_editable,
    min_numeric = EXCLUDED.min_numeric,
    max_numeric = EXCLUDED.max_numeric,
    default_value = EXCLUDED.default_value,
    description = EXCLUDED.description;

WITH template_payload AS (
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'sdk', jsonb_build_object('projectId', NULL, 'environment', NULL, 'release', NULL),
    'features', jsonb_build_object(
      'tracing', TRUE, 'requestCapture', TRUE, 'errors', TRUE, 'metrics', FALSE,
      'logging', FALSE, 'profiling', FALSE, 'crons', TRUE, 'sessionReplay', FALSE,
      'runtimeMetrics', TRUE, 'eventLoopMonitoring', TRUE, 'gcMonitoring', FALSE
    ),
    'sampling', jsonb_build_object(
      'traces', 0.1, 'requests', 0.1, 'errors', 1.0, 'profiles', 0.0,
      'replays', 0.0, 'routes', jsonb_build_object()
    ),
    'instrumentation', jsonb_build_object(
      'http', TRUE, 'https', TRUE, 'fetch', TRUE, 'axios', TRUE,
      'fastify', jsonb_build_object('enabled', TRUE, 'captureHooks', TRUE, 'captureValidationErrors', TRUE),
      'express', jsonb_build_object('enabled', TRUE),
      'graphql', jsonb_build_object('enabled', TRUE, 'captureResolvers', FALSE),
      'prisma', jsonb_build_object('enabled', TRUE, 'captureQueries', TRUE, 'captureParams', FALSE),
      'mongodb', FALSE, 'redis', FALSE, 'bullmq', TRUE
    ),
    'privacy', jsonb_build_object(
      'capture', jsonb_build_object('headers', TRUE, 'body', TRUE, 'response', FALSE, 'query', TRUE, 'cookies', FALSE),
      'scrubbing', jsonb_build_object(
        'enabled', TRUE,
        'headers', jsonb_build_array('authorization','cookie','x-api-key','x-auth-token','x-session-token'),
        'fields', jsonb_build_array('password','token','secret','creditCard','ssn')
      ),
      'piiDetection', jsonb_build_object('enabled', TRUE, 'maskEmails', TRUE, 'maskPhones', TRUE, 'maskIPs', FALSE)
    ),
    'limits', jsonb_build_object('maxSpansPerTrace', 100, 'maxSpanAttributes', 50, 'maxAttributeLength', 4096),
    'killswitches', jsonb_build_object(
      'disableSDK', FALSE, 'disableTracing', FALSE, 'disableMetrics', FALSE,
      'disableErrors', FALSE, 'disableLogs', FALSE
    ),
    'routes', jsonb_build_object(
      'traces', jsonb_build_object('path','/v1/traces','batchSize',100,'flushIntervalMs',5000,'compression','gzip','priority','high'),
      'requests', jsonb_build_object('path','/v1/requests','batchSize',200,'flushIntervalMs',2000,'compression','gzip','priority','high'),
      'errors', jsonb_build_object('path','/v1/errors','batchSize',10,'flushIntervalMs',1000,'compression','gzip','priority','critical'),
      'metrics', jsonb_build_object('path','/v1/metrics','batchSize',100,'flushIntervalMs',10000,'compression','gzip','priority','normal'),
      'logs', jsonb_build_object('path','/v1/logs','batchSize',50,'flushIntervalMs',10000,'compression','gzip','priority','normal'),
      'profiles', jsonb_build_object('path','/v1/profiles','batchSize',5,'flushIntervalMs',30000,'compression','gzip','priority','low'),
      'events', jsonb_build_object('path','/v1/events','batchSize',50,'flushIntervalMs',5000,'compression','gzip','priority','normal'),
      'crons', jsonb_build_object('path','/v1/crons','batchSize',1,'flushIntervalMs',0,'compression','none','priority','high'),
      'replays', jsonb_build_object('path','/v1/replays','batchSize',1,'flushIntervalMs',5000,'compression','gzip','priority','low')
    ),
    'ingestBaseUrl', 'https://ingest.pulse.io',
    'transport', jsonb_build_object(
      'retry', jsonb_build_object('maxAttempts', 3, 'baseDelayMs', 250),
      'queue', jsonb_build_object('overflowStrategy', 'drop_oldest'),
      'keepAlive', TRUE,
      'connectionPoolSize', 8,
      'connectionTimeoutMs', 5000
    ),
    'runtime', jsonb_build_object('configTtlSeconds', 300, 'staleWhileRevalidate', TRUE, 'refreshJitterMs', 30000),
    'meta', jsonb_build_object('generatedBy', 'pulse-backend'),
    'security', jsonb_build_object('allowedOrigins', jsonb_build_array())
  ) AS payload
)
INSERT INTO sdk_config_templates
  (plan_key, environment, config_key, config_type, config_value, schema_version, rollout_percentage)
SELECT plan_key, environment, 'default', 'json', payload, '1', 100
FROM template_payload
CROSS JOIN (VALUES ('free'), ('pro'), ('enterprise')) AS plans(plan_key)
CROSS JOIN (VALUES ('development'), ('staging'), ('production')) AS envs(environment)
ON CONFLICT (plan_key, environment, config_key) DO UPDATE
SET config_value = EXCLUDED.config_value,
    schema_version = EXCLUDED.schema_version,
    rollout_percentage = EXCLUDED.rollout_percentage,
    is_active = TRUE;

COMMIT;

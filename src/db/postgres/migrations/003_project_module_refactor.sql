-- =============================================================================
-- Migration : 003_project_module_refactor.sql
-- Purpose   : Enterprise-grade Project Module refactor (Phases 2-18).
--             - Lightweight projects
--             - First-class project_environments table (owned by API keys)
--             - Redesigned project_api_keys with env_id, rotation, scoping
--             - Project members + invitations + custom roles
--             - Project connector subscriptions
--             - Project audit logs + activity feed
--             - Project notification preferences
--             - Project usage analytics time-series tables
--             - Security/performance indexes and constraints
-- =============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ENUMS
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_visibility') THEN
    CREATE TYPE project_visibility AS ENUM ('private', 'organization', 'public');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_member_status') THEN
    CREATE TYPE project_member_status AS ENUM ('pending', 'active', 'inactive', 'removed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
    CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined', 'expired', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_type') THEN
    CREATE TYPE api_key_type AS ENUM ('read_write', 'read_only', 'write_only', 'temporary');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_rotation_state') THEN
    CREATE TYPE api_key_rotation_state AS ENUM ('none', 'rotating', 'grace_period', 'completed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_audit_action') THEN
    CREATE TYPE project_audit_action AS ENUM (
      'project.created',
      'project.updated',
      'project.deleted',
      'project.restored',
      'project.archived',
      'api_key.created',
      'api_key.rotated',
      'api_key.revoked',
      'api_key.expired',
      'member.added',
      'member.invited',
      'member.removed',
      'member.role_changed',
      'connector.enabled',
      'connector.disabled',
      'alert_rule.changed',
      'sdk_config.changed',
      'environment.created',
      'environment.updated',
      'environment.deleted',
      'notification_preference.changed',
      'settings.changed'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel') THEN
    CREATE TYPE notification_channel AS ENUM ('slack', 'email', 'webhook', 'push', 'sms');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_category') THEN
    CREATE TYPE alert_category AS ENUM (
      'error', 'performance', 'deployment', 'cron', 'release', 'usage', 'billing', 'security', 'ai'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'severity_threshold') THEN
    CREATE TYPE severity_threshold AS ENUM ('info', 'warning', 'error', 'critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_bucket') THEN
    CREATE TYPE analytics_bucket AS ENUM ('minute', 'hour', 'day');
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. PROJECTS — lightweight
-- ═══════════════════════════════════════════════════════════════════════════

-- Remove heavy defaults/config from project creation. Keep only core identity.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility project_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Drop columns that belong to other modules (envs, prefixes, SDK config, etc.)
ALTER TABLE projects
  DROP COLUMN IF EXISTS default_environment;

-- Ensure slug uniqueness and reserved-name guard via partial index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_org_slug_active
  ON projects(org_id, slug)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_projects_org;
CREATE INDEX IF NOT EXISTS idx_projects_org_active
  ON projects(org_id)
  WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. PROJECT ENVIRONMENTS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  color VARCHAR(20),
  icon VARCHAR(255),
  created_by_api_key_id UUID,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (project_id, slug),
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_project_environments_project
  ON project_environments(project_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_environments_default
  ON project_environments(project_id)
  WHERE is_default = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_environments_active
  ON project_environments(project_id, is_active)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_project_environments_updated_at ON project_environments;
CREATE TRIGGER trg_project_environments_updated_at
  BEFORE UPDATE ON project_environments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Seed environments from legacy API keys (environments are owned by keys going forward).
INSERT INTO project_environments (project_id, organization_id, name, slug, is_default, created_by_api_key_id)
SELECT DISTINCT
  k.project_id,
  k.organization_id,
  INITCAP(k.environment::text),
  LOWER(k.environment::text),
  CASE WHEN k.environment = 'production' THEN TRUE ELSE FALSE END,
  k.id
FROM project_api_keys k
WHERE k.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_environments e
    WHERE e.project_id = k.project_id AND e.slug = LOWER(k.environment::text)
  )
ON CONFLICT (project_id, slug) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. PROJECT API KEYS — enterprise redesign
-- ═══════════════════════════════════════════════════════════════════════════

-- Add new columns if not present, then migrate, then drop old columns.
ALTER TABLE project_api_keys
  ADD COLUMN IF NOT EXISTS public_key VARCHAR(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS secret_hash TEXT,
  ADD COLUMN IF NOT EXISTS environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS key_type api_key_type NOT NULL DEFAULT 'read_write',
  ADD COLUMN IF NOT EXISTS rotation_state api_key_rotation_state NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS rotation_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rotated_from_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
  ADD COLUMN IF NOT EXISTS allowed_sdks TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_ips INET[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_event_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sampling_rules JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sdk_config JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Backfill environment_id from the new project_environments table.
UPDATE project_api_keys k
SET environment_id = e.id
FROM project_environments e
WHERE k.environment IS NOT NULL
  AND e.project_id = k.project_id
  AND e.slug = LOWER(k.environment::text)
  AND k.environment_id IS NULL;

-- Migrate legacy status names to enum (already api_key_status).
-- Set deleted_at for any already-revoked keys that are missing it.
UPDATE project_api_keys
SET deleted_at = COALESCE(deleted_at, revoked_at)
WHERE status = 'revoked' AND deleted_at IS NULL;

-- Drop old enum column and environment-dependent naming.
ALTER TABLE project_api_keys
  DROP COLUMN IF EXISTS environment;

-- Ensure not-null constraints on the new shape.
ALTER TABLE project_api_keys
  ALTER COLUMN public_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_env
  ON project_api_keys(environment_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_public_key
  ON project_api_keys(public_key)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_active_env
  ON project_api_keys(project_id, environment_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_rotation
  ON project_api_keys(rotated_from_key_id)
  WHERE rotated_from_key_id IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_project_api_keys_updated_at ON project_api_keys;
CREATE TRIGGER trg_project_api_keys_updated_at
  BEFORE UPDATE ON project_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. PROJECT MEMBERS — enhanced
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE project_members
  DROP COLUMN IF EXISTS invited_by,
  DROP COLUMN IF EXISTS invited_at,
  DROP COLUMN IF EXISTS joined_at;

ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS status project_member_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS removed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_project_members_active
  ON project_members(project_id, user_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_project_members_project_status
  ON project_members(project_id, status);

DROP TRIGGER IF EXISTS trg_project_members_updated_at ON project_members;
CREATE TRIGGER trg_project_members_updated_at
  BEFORE UPDATE ON project_members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. PROJECT MEMBER INVITATIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_member_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role project_member_role NOT NULL DEFAULT 'viewer',
  status invitation_status NOT NULL DEFAULT 'pending',
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, email)
);

CREATE INDEX IF NOT EXISTS idx_project_invitations_project
  ON project_member_invitations(project_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_project_invitations_token
  ON project_member_invitations(token_hash)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_project_invitations_user
  ON project_member_invitations(invited_user_id)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_project_member_invitations_updated_at ON project_member_invitations;
CREATE TRIGGER trg_project_member_invitations_updated_at
  BEFORE UPDATE ON project_member_invitations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. PROJECT ROLES & PERMISSIONS (future-proof RBAC)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, slug),
  UNIQUE (project_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_project_roles_org
  ON project_roles(organization_id)
  WHERE is_system = TRUE;
CREATE INDEX IF NOT EXISTS idx_project_roles_project
  ON project_roles(project_id)
  WHERE is_system = FALSE;

DROP TRIGGER IF EXISTS trg_project_roles_updated_at ON project_roles;
CREATE TRIGGER trg_project_roles_updated_at
  BEFORE UPDATE ON project_roles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Seed system roles for the organization.
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

-- Backfill project_members role mapping to role_id (future use).
ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES project_roles(id) ON DELETE SET NULL;

UPDATE project_members m
SET role_id = r.id
FROM project_roles r
JOIN organizations o ON r.organization_id = o.id
JOIN projects p ON p.org_id = o.id AND p.id = m.project_id
WHERE m.role_id IS NULL
  AND r.slug = m.role::text;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. PROJECT CONNECTOR SUBSCRIPTIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_connector_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  alert_categories alert_category[] NOT NULL DEFAULT ARRAY['error','performance','security'],
  severity_threshold severity_threshold NOT NULL DEFAULT 'error',
  member_ids UUID[] NOT NULL DEFAULT '{}',
  channel_overrides JSONB NOT NULL DEFAULT '{}',
  quiet_hours JSONB,
  digest_mode JSONB,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (project_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_project_connector_subs_project
  ON project_connector_subscriptions(project_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_connector_subs_connector
  ON project_connector_subscriptions(connector_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_connector_subs_enabled
  ON project_connector_subscriptions(project_id, enabled)
  WHERE enabled = TRUE AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_project_connector_subs_updated_at ON project_connector_subscriptions;
CREATE TRIGGER trg_project_connector_subs_updated_at
  BEFORE UPDATE ON project_connector_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Migrate legacy connector_configs.project_id into subscriptions.
INSERT INTO project_connector_subscriptions (
  project_id, organization_id, connector_id, enabled, alert_categories, created_by_user_id, updated_by_user_id
)
SELECT c.project_id, c.organization_id, c.id, TRUE, ARRAY['error','performance','security'], c.created_by, c.updated_by
FROM connector_configs c
WHERE c.project_id IS NOT NULL
  AND c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_connector_subscriptions s
    WHERE s.project_id = c.project_id AND s.connector_id = c.id
  )
ON CONFLICT (project_id, connector_id) DO NOTHING;

-- Remove project ownership from connectors; they are org resources now.
ALTER TABLE connector_configs
  DROP COLUMN IF EXISTS project_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. PROJECT AUDIT LOGS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action project_audit_action NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(50) NOT NULL DEFAULT 'user',
  actor_email VARCHAR(255),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  entity_name VARCHAR(255),
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  correlation_id VARCHAR(64),
  request_id VARCHAR(64),
  ip_address INET,
  user_agent TEXT,
  severity INTEGER NOT NULL DEFAULT 0,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Default partition for current month; operational runbooks create future partitions.
CREATE TABLE IF NOT EXISTS project_audit_logs_default
  PARTITION OF project_audit_logs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_project_audit_logs_project_time
  ON project_audit_logs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_audit_logs_action
  ON project_audit_logs (project_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_audit_logs_actor
  ON project_audit_logs (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_audit_logs_entity
  ON project_audit_logs (project_id, entity_type, entity_id)
  WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_audit_logs_request
  ON project_audit_logs (request_id)
  WHERE request_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. PROJECT ACTIVITY FEED
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  entity_name VARCHAR(255),
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_activity_project_time
  ON project_activity (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_activity_actor
  ON project_activity (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_activity_action
  ON project_activity (project_id, action, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. PROJECT NOTIFICATION PREFERENCES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category alert_category NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  severity_threshold severity_threshold NOT NULL DEFAULT 'error',
  connector_ids UUID[] NOT NULL DEFAULT '{}',
  member_ids UUID[] NOT NULL DEFAULT '{}',
  quiet_hours JSONB,
  digest_mode VARCHAR(30) NOT NULL DEFAULT 'immediate',
  escalation_policy_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, category)
);

CREATE INDEX IF NOT EXISTS idx_project_notif_prefs_project
  ON project_notification_preferences(project_id);

DROP TRIGGER IF EXISTS trg_project_notif_prefs_updated_at ON project_notification_preferences;
CREATE TRIGGER trg_project_notif_prefs_updated_at
  BEFORE UPDATE ON project_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Seed defaults for each project.
INSERT INTO project_notification_preferences (project_id, organization_id, category, enabled)
SELECT p.id, p.org_id, cat, TRUE
FROM projects p
CROSS JOIN (VALUES ('error'), ('performance'), ('deployment'), ('cron'), ('release'), ('usage'), ('billing'), ('security'), ('ai')) AS v(cat)
WHERE p.deleted_at IS NULL
ON CONFLICT (project_id, category) DO NOTHING;

-- Per-member notification preferences.
CREATE TABLE IF NOT EXISTS project_member_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  category alert_category NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  severity_threshold severity_threshold NOT NULL DEFAULT 'error',
  digest_mode VARCHAR(30) NOT NULL DEFAULT 'immediate',
  quiet_hours JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id, channel, category)
);

CREATE INDEX IF NOT EXISTS idx_project_member_notif_prefs_user
  ON project_member_notification_preferences(project_id, user_id);

DROP TRIGGER IF EXISTS trg_project_member_notif_prefs_updated_at ON project_member_notification_preferences;
CREATE TRIGGER trg_project_member_notif_prefs_updated_at
  BEFORE UPDATE ON project_member_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. PROJECT USAGE ANALYTICS — time-series aggregates
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_usage_minute (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  total_events BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  requests BIGINT NOT NULL DEFAULT 0,
  transactions BIGINT NOT NULL DEFAULT 0,
  traces BIGINT NOT NULL DEFAULT 0,
  spans BIGINT NOT NULL DEFAULT 0,
  logs BIGINT NOT NULL DEFAULT 0,
  metrics BIGINT NOT NULL DEFAULT 0,
  profiles BIGINT NOT NULL DEFAULT 0,
  ai_events BIGINT NOT NULL DEFAULT 0,
  sdk_requests BIGINT NOT NULL DEFAULT 0,
  active_api_keys INTEGER NOT NULL DEFAULT 0,
  active_environments INTEGER NOT NULL DEFAULT 0,
  active_users BIGINT NOT NULL DEFAULT 0,
  active_members INTEGER NOT NULL DEFAULT 0,
  alert_count INTEGER NOT NULL DEFAULT 0,
  connector_deliveries INTEGER NOT NULL DEFAULT 0,
  failed_notifications INTEGER NOT NULL DEFAULT 0,
  top_endpoints JSONB NOT NULL DEFAULT '{}',
  top_services JSONB NOT NULL DEFAULT '{}',
  top_error_groups JSONB NOT NULL DEFAULT '{}',
  top_sdk_versions JSONB NOT NULL DEFAULT '{}',
  top_countries JSONB NOT NULL DEFAULT '{}',
  top_browsers JSONB NOT NULL DEFAULT '{}',
  top_os JSONB NOT NULL DEFAULT '{}',
  top_devices JSONB NOT NULL DEFAULT '{}',
  top_releases JSONB NOT NULL DEFAULT '{}',
  rate_limit_usage BIGINT NOT NULL DEFAULT 0,
  latency_ms_p50 NUMERIC,
  latency_ms_p95 NUMERIC,
  latency_ms_p99 NUMERIC,
  PRIMARY KEY (project_id, bucket)
);

CREATE TABLE IF NOT EXISTS project_usage_hourly (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  total_events BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  requests BIGINT NOT NULL DEFAULT 0,
  transactions BIGINT NOT NULL DEFAULT 0,
  traces BIGINT NOT NULL DEFAULT 0,
  spans BIGINT NOT NULL DEFAULT 0,
  logs BIGINT NOT NULL DEFAULT 0,
  metrics BIGINT NOT NULL DEFAULT 0,
  profiles BIGINT NOT NULL DEFAULT 0,
  ai_events BIGINT NOT NULL DEFAULT 0,
  sdk_requests BIGINT NOT NULL DEFAULT 0,
  active_api_keys INTEGER NOT NULL DEFAULT 0,
  active_environments INTEGER NOT NULL DEFAULT 0,
  active_users BIGINT NOT NULL DEFAULT 0,
  active_members INTEGER NOT NULL DEFAULT 0,
  alert_count INTEGER NOT NULL DEFAULT 0,
  connector_deliveries INTEGER NOT NULL DEFAULT 0,
  failed_notifications INTEGER NOT NULL DEFAULT 0,
  top_endpoints JSONB NOT NULL DEFAULT '{}',
  top_services JSONB NOT NULL DEFAULT '{}',
  top_error_groups JSONB NOT NULL DEFAULT '{}',
  top_sdk_versions JSONB NOT NULL DEFAULT '{}',
  top_countries JSONB NOT NULL DEFAULT '{}',
  top_browsers JSONB NOT NULL DEFAULT '{}',
  top_os JSONB NOT NULL DEFAULT '{}',
  top_devices JSONB NOT NULL DEFAULT '{}',
  top_releases JSONB NOT NULL DEFAULT '{}',
  rate_limit_usage BIGINT NOT NULL DEFAULT 0,
  latency_ms_p50 NUMERIC,
  latency_ms_p95 NUMERIC,
  latency_ms_p99 NUMERIC,
  PRIMARY KEY (project_id, bucket)
);

CREATE TABLE IF NOT EXISTS project_usage_daily (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  total_events BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  requests BIGINT NOT NULL DEFAULT 0,
  transactions BIGINT NOT NULL DEFAULT 0,
  traces BIGINT NOT NULL DEFAULT 0,
  spans BIGINT NOT NULL DEFAULT 0,
  logs BIGINT NOT NULL DEFAULT 0,
  metrics BIGINT NOT NULL DEFAULT 0,
  profiles BIGINT NOT NULL DEFAULT 0,
  ai_events BIGINT NOT NULL DEFAULT 0,
  sdk_requests BIGINT NOT NULL DEFAULT 0,
  active_api_keys INTEGER NOT NULL DEFAULT 0,
  active_environments INTEGER NOT NULL DEFAULT 0,
  active_users BIGINT NOT NULL DEFAULT 0,
  active_members INTEGER NOT NULL DEFAULT 0,
  alert_count INTEGER NOT NULL DEFAULT 0,
  connector_deliveries INTEGER NOT NULL DEFAULT 0,
  failed_notifications INTEGER NOT NULL DEFAULT 0,
  top_endpoints JSONB NOT NULL DEFAULT '{}',
  top_services JSONB NOT NULL DEFAULT '{}',
  top_error_groups JSONB NOT NULL DEFAULT '{}',
  top_sdk_versions JSONB NOT NULL DEFAULT '{}',
  top_countries JSONB NOT NULL DEFAULT '{}',
  top_browsers JSONB NOT NULL DEFAULT '{}',
  top_os JSONB NOT NULL DEFAULT '{}',
  top_devices JSONB NOT NULL DEFAULT '{}',
  top_releases JSONB NOT NULL DEFAULT '{}',
  rate_limit_usage BIGINT NOT NULL DEFAULT 0,
  latency_ms_p50 NUMERIC,
  latency_ms_p95 NUMERIC,
  latency_ms_p99 NUMERIC,
  PRIMARY KEY (project_id, bucket)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_minute_project_bucket
  ON project_usage_minute(project_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_project_usage_minute_org_bucket
  ON project_usage_minute(organization_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_project_usage_hourly_project_bucket
  ON project_usage_hourly(project_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_project_usage_hourly_org_bucket
  ON project_usage_hourly(organization_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_project_usage_daily_project_bucket
  ON project_usage_daily(project_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_project_usage_daily_org_bucket
  ON project_usage_daily(organization_id, bucket DESC);

-- Materialized monthly usage rollup for plan-limit comparisons.
CREATE TABLE IF NOT EXISTS project_usage_monthly (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  year_month VARCHAR(7) NOT NULL,
  total_events BIGINT NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  api_key_requests BIGINT NOT NULL DEFAULT 0,
  rate_limited_events BIGINT NOT NULL DEFAULT 0,
  alert_notifications BIGINT NOT NULL DEFAULT 0,
  active_users BIGINT NOT NULL DEFAULT 0,
  UNIQUE (project_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_monthly_org
  ON project_usage_monthly(organization_id, year_month);

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. API KEY USAGE & EVENT ROUTING LOOKUP
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS api_key_usage_minute (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  event_type VARCHAR(50) NOT NULL DEFAULT '__all__',
  requests BIGINT NOT NULL DEFAULT 0,
  events BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  latency_ms_p50 NUMERIC,
  latency_ms_p95 NUMERIC,
  latency_ms_p99 NUMERIC,
  rate_limited BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, bucket, event_type)
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_minute_project
  ON api_key_usage_minute(project_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_minute_env
  ON api_key_usage_minute(environment_id, bucket DESC)
  WHERE environment_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 14. MIGRATE LEGACY DATA
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure every project has at least one environment if none was seeded above.
INSERT INTO project_environments (project_id, organization_id, name, slug, is_default)
SELECT p.id, p.org_id, 'Production', 'production', TRUE
FROM projects p
LEFT JOIN project_environments e ON e.project_id = p.id
WHERE e.id IS NULL AND p.deleted_at IS NULL
ON CONFLICT (project_id, slug) DO NOTHING;

-- Create a default project_settings row if missing.
INSERT INTO project_settings (project_id, organization_id)
SELECT p.id, p.org_id
FROM projects p
LEFT JOIN project_settings s ON s.project_id = p.id
WHERE s.id IS NULL
ON CONFLICT (project_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 15. OPTIMISTIC LOCKING & VERSION TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bump_project_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = COALESCE(OLD.version, 1) + 1;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_version ON projects;
CREATE TRIGGER trg_projects_version
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION bump_project_version();

DROP TRIGGER IF EXISTS trg_project_api_keys_version ON project_api_keys;
CREATE TRIGGER trg_project_api_keys_version
  BEFORE UPDATE ON project_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION bump_project_version();

DROP TRIGGER IF EXISTS trg_project_members_version ON project_members;
CREATE TRIGGER trg_project_members_version
  BEFORE UPDATE ON project_members
  FOR EACH ROW
  EXECUTE FUNCTION bump_project_version();

-- ═══════════════════════════════════════════════════════════════════════════
-- 16. COMMENTS
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE projects IS 'Lightweight application identity. Operational config lives in project_settings, environments, API keys, and connectors.';
COMMENT ON TABLE project_environments IS 'First-class environments created/owned by API keys. API keys reference an environment_id.';
COMMENT ON TABLE project_api_keys IS 'Scoped, rotatable, expirable API keys. Secrets are never returned after creation.';
COMMENT ON TABLE project_connector_subscriptions IS 'Project-level subscriptions to organization-owned connectors. No connector duplication.';
COMMENT ON TABLE project_audit_logs IS 'Immutable project-level audit trail, partitioned by created_at.';
COMMENT ON TABLE project_activity IS 'Project activity timeline for dashboards.';
COMMENT ON TABLE project_notification_preferences IS 'Project defaults for alert categories.';
COMMENT ON TABLE project_member_notification_preferences IS 'Member overrides for project notification defaults.';

COMMIT;

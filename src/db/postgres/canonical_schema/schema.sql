-- Master Consolidated PostgreSQL Canonical Schema
-- Generated deterministically from folder-by-folder canonical definitions.


-- ============================================================
-- Source: 00_extensions/001_extensions.sql
-- ============================================================

-- Canonical PostgreSQL Extension Definitions
-- File: 00_extensions/001_extensions.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============================================================
-- Source: 01_schemas/001_schemas.sql
-- ============================================================

-- Canonical PostgreSQL Schema Definitions
-- File: 01_schemas/001_schemas.sql

CREATE SCHEMA IF NOT EXISTS public;

-- ============================================================
-- Source: 02_types/001_enums_and_domains.sql
-- ============================================================

-- Canonical PostgreSQL Enum and Type Definitions
-- File: 02_types/001_enums_and_domains.sql

-- Helper DO block to define ENUM types idempotently
DO $$
BEGIN
  -- 1. Auth & User Enums
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM ('active', 'expired', 'revoked');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mfa_type') THEN
    CREATE TYPE mfa_type AS ENUM ('totp', 'webauthn', 'backup_code', 'email_otp');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_event_type') THEN
    CREATE TYPE security_event_type AS ENUM (
      'login_success', 'login_failed', 'password_changed', 'mfa_enabled',
      'mfa_disabled', 'session_revoked', 'api_key_created', 'api_key_revoked',
      'sso_login_success', 'sso_login_failed'
    );
  END IF;

  -- 2. Organization Enums
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_status') THEN
    CREATE TYPE org_status AS ENUM ('active', 'suspended', 'archived', 'pending_deletion');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE member_status AS ENUM ('active', 'invited', 'suspended');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'joined_method') THEN
    CREATE TYPE joined_method AS ENUM ('invitation', 'sso', 'scim', 'manual', 'signup');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE org_role AS ENUM ('owner', 'admin', 'member', 'viewer', 'billing_admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
    CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined', 'expired', 'canceled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quota_request_status') THEN
    CREATE TYPE quota_request_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;

  -- 3. Project Enums
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_status') THEN
    CREATE TYPE project_status AS ENUM ('active', 'archived', 'deleted');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_visibility') THEN
    CREATE TYPE project_visibility AS ENUM ('private', 'public', 'internal');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_member_role') THEN
    CREATE TYPE project_member_role AS ENUM ('admin', 'editor', 'viewer', 'contributor');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_member_status') THEN
    CREATE TYPE project_member_status AS ENUM ('active', 'invited', 'suspended');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_environment_type') THEN
    CREATE TYPE project_environment_type AS ENUM ('development', 'staging', 'production', 'preview');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_status') THEN
    CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired', 'rotating');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_type') THEN
    CREATE TYPE api_key_type AS ENUM ('publishable', 'secret', 'admin', 'ingestion');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_rotation_state') THEN
    CREATE TYPE api_key_rotation_state AS ENUM ('active', 'grace_period', 'retired');
  END IF;

  -- 4. Billing Enums
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_plan_tier') THEN
    CREATE TYPE billing_plan_tier AS ENUM ('free', 'starter', 'pro', 'growth', 'enterprise', 'custom');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_interval_type') THEN
    CREATE TYPE billing_interval_type AS ENUM ('monthly', 'yearly', 'one_time');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_feature_value_type') THEN
    CREATE TYPE billing_feature_value_type AS ENUM ('boolean', 'numeric', 'text', 'json');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_feature_category') THEN
    CREATE TYPE billing_feature_category AS ENUM (
      'core', 'observability', 'alerting', 'connectors', 'ai', 'automation', 'security', 'support'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_subscription_status') THEN
    CREATE TYPE billing_subscription_status AS ENUM (
      'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_event_type') THEN
    CREATE TYPE subscription_event_type AS ENUM (
      'created', 'updated', 'renewed', 'canceled', 'upgraded', 'downgraded', 'paused', 'resumed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_event_actor') THEN
    CREATE TYPE subscription_event_actor AS ENUM ('user', 'admin', 'system', 'stripe');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_invoice_status') THEN
    CREATE TYPE billing_invoice_status AS ENUM ('draft', 'open', 'paid', 'uncollectible', 'void');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_payment_status') THEN
    CREATE TYPE billing_payment_status AS ENUM ('succeeded', 'pending', 'failed', 'refunded');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_coupon_discount_type') THEN
    CREATE TYPE billing_coupon_discount_type AS ENUM ('percentage', 'fixed_amount');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_provider_type') THEN
    CREATE TYPE billing_provider_type AS ENUM ('stripe', 'paddle', 'manual', 'custom');
  END IF;

  -- 5. Alerting & Notification Enums
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_severity') THEN
    CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical', 'fatal');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_status') THEN
    CREATE TYPE alert_status AS ENUM ('pending', 'firing', 'resolved', 'silenced', 'acknowledged');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_status') THEN
    CREATE TYPE alert_event_status AS ENUM ('triggered', 'evaluated', 'resolved', 'suppressed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_condition_type') THEN
    CREATE TYPE alert_condition_type AS ENUM ('threshold', 'anomaly', 'absence', 'rate_of_change');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_condition_operator') THEN
    CREATE TYPE alert_condition_operator AS ENUM ('gt', 'gte', 'lt', 'lte', 'eq', 'neq');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'metric_granularity') THEN
    CREATE TYPE metric_granularity AS ENUM ('1m', '5m', '15m', '1h', '1d');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_attempt_status') THEN
    CREATE TYPE delivery_attempt_status AS ENUM ('pending', 'success', 'failed', 'retrying', 'dead_letter');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status') THEN
    CREATE TYPE delivery_status AS ENUM ('queued', 'delivering', 'delivered', 'failed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_severity') THEN
    CREATE TYPE notification_severity AS ENUM ('info', 'warning', 'critical');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_scope_type') THEN
    CREATE TYPE alert_scope_type AS ENUM ('organization', 'project', 'environment', 'service', 'endpoint');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_action_type') THEN
    CREATE TYPE alert_action_type AS ENUM (
      'connector', 'email', 'webhook', 'pagerduty', 'slack', 'auto_scale', 'run_workflow'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_action_merge_mode') THEN
    CREATE TYPE alert_action_merge_mode AS ENUM ('atomic', 'batched', 'debounced');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_binding_mode') THEN
    CREATE TYPE alert_binding_mode AS ENUM ('all', 'any', 'selected');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel_kind') THEN
    CREATE TYPE notification_channel_kind AS ENUM (
      'email', 'slack', 'pagerduty', 'webhook', 'opsgenie', 'discord', 'teams'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'history_action') THEN
    CREATE TYPE history_action AS ENUM ('created', 'updated', 'deleted', 'state_change');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_status') THEN
    CREATE TYPE batch_status AS ENUM ('open', 'closed', 'processing', 'sent');
  END IF;

  -- 6. Automation Enums
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_workflow_status') THEN
    CREATE TYPE automation_workflow_status AS ENUM ('draft', 'active', 'paused', 'archived');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_workflow_scope') THEN
    CREATE TYPE automation_workflow_scope AS ENUM ('organization', 'project');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_trigger_kind') THEN
    CREATE TYPE automation_trigger_kind AS ENUM (
      'alert_fired', 'event_received', 'metric_threshold', 'schedule', 'manual', 'webhook'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_condition_operator') THEN
    CREATE TYPE automation_condition_operator AS ENUM (
      'equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'in', 'regex'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_action_risk') THEN
    CREATE TYPE automation_action_risk AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_run_status') THEN
    CREATE TYPE automation_run_status AS ENUM (
      'pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'canceled', 'timed_out'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_step_status') THEN
    CREATE TYPE automation_step_status AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_approval_status') THEN
    CREATE TYPE automation_approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_template_scope') THEN
    CREATE TYPE automation_template_scope AS ENUM ('system', 'organization', 'public');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_audit_action') THEN
    CREATE TYPE automation_audit_action AS ENUM ('create', 'update', 'delete', 'execute', 'approve', 'reject');
  END IF;
END $$;

-- ============================================================
-- Source: 03_reference/001_connector_providers.sql
-- ============================================================

-- Reference Table: Connector Providers
-- File: 03_reference/001_connector_providers.sql

CREATE TABLE IF NOT EXISTS connector_providers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT 'notification',
  auth_type VARCHAR(64) NOT NULL DEFAULT 'webhook',
  is_active BOOLEAN NOT NULL DEFAULT true,
  config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  icon_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the 7 active runtime connector providers
INSERT INTO connector_providers (id, name, category, auth_type, is_active, config_schema)
VALUES
  ('slack', 'Slack', 'chat', 'oauth2', true, '{"required":["webhook_url"]}'::jsonb),
  ('pagerduty', 'PagerDuty', 'incident', 'api_key', true, '{"required":["routing_key"]}'::jsonb),
  ('webhook', 'Custom Webhook', 'webhook', 'custom', true, '{"required":["url"]}'::jsonb),
  ('email', 'Email Outbox', 'email', 'smtp', true, '{"required":["recipients"]}'::jsonb),
  ('teams', 'Microsoft Teams', 'chat', 'webhook', true, '{"required":["webhook_url"]}'::jsonb),
  ('opsgenie', 'OpsGenie', 'incident', 'api_key', true, '{"required":["api_key"]}'::jsonb),
  ('discord', 'Discord', 'chat', 'webhook', true, '{"required":["webhook_url"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  auth_type = EXCLUDED.auth_type,
  config_schema = EXCLUDED.config_schema,
  updated_at = NOW();

-- ============================================================
-- Source: 04_identity/001_users_and_auth.sql
-- ============================================================

-- Identity & User Authentication Schema
-- File: 04_identity/001_users_and_auth.sql

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  full_name TEXT,
  avatar_url TEXT,
  status user_status NOT NULL DEFAULT 'active',
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  email_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status session_status NOT NULL DEFAULT 'active',
  user_agent TEXT,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type mfa_type NOT NULL,
  secret TEXT NOT NULL,
  name VARCHAR(128) NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  device_name VARCHAR(128),
  last_ip TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_linked_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  provider_user_id TEXT NOT NULL,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_provider UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS user_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type security_event_type NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme VARCHAR(32) NOT NULL DEFAULT 'system',
  locale VARCHAR(16) NOT NULL DEFAULT 'en',
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  notification_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 05_organizations/001_organizations_core.sql
-- ============================================================

-- Organization Core Schema
-- File: 05_organizations/001_organizations_core.sql

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  logo_url TEXT,
  status org_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  default_timezone VARCHAR(64) DEFAULT 'UTC',
  allowed_auth_methods JSONB DEFAULT '["password", "sso"]'::jsonb,
  security_policies JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 05_organizations/002_organization_members_invites.sql
-- ============================================================

-- Organization Members & Invitations Schema
-- File: 05_organizations/002_organization_members_invites.sql

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'member',
  status member_status NOT NULL DEFAULT 'active',
  joined_method joined_method NOT NULL DEFAULT 'invitation',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_org_user UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role org_role NOT NULL DEFAULT 'member',
  status invitation_status NOT NULL DEFAULT 'pending',
  token_hash TEXT UNIQUE NOT NULL,
  invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quota_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  feature_key VARCHAR(128) NOT NULL,
  requested_value NUMERIC NOT NULL,
  status quota_request_status NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 05_organizations/003_organization_sso_scim.sql
-- ============================================================

-- Organization SSO & SCIM Directory Integration Schema
-- File: 05_organizations/003_organization_sso_scim.sql

CREATE TABLE IF NOT EXISTS organization_sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_type VARCHAR(64) NOT NULL DEFAULT 'saml',
  issuer TEXT NOT NULL,
  sso_url TEXT NOT NULL,
  certificate TEXT,
  metadata_url TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_verified_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  verification_token TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_org_domain UNIQUE (organization_id, domain)
);

CREATE TABLE IF NOT EXISTS organization_scim_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  description VARCHAR(255),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_scim_token_ips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
  ip_cidr TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_scim_token_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
  scope VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saml_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sso_provider_id UUID NOT NULL REFERENCES organization_sso_providers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name_id TEXT NOT NULL,
  session_index TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scim_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  external_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scim_group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_scim_group_user UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS scim_user_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_scim_user_ext UNIQUE (organization_id, external_id)
);

-- ============================================================
-- Source: 05_organizations/004_organization_security_audit.sql
-- ============================================================

-- Organization Audit & Security Schema
-- File: 05_organizations/004_organization_security_audit.sql

CREATE TABLE IF NOT EXISTS organization_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(128) NOT NULL,
  target_type VARCHAR(64),
  target_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type security_event_type NOT NULL,
  severity alert_severity NOT NULL DEFAULT 'info',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  status delivery_status NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS org_webhook_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url_pattern TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 06_projects/001_projects_and_environments.sql
-- ============================================================

-- Projects & Environments Schema
-- File: 06_projects/001_projects_and_environments.sql

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT,
  status project_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_org_project_slug UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS project_settings (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  retention_days INT NOT NULL DEFAULT 30,
  error_grouping_rules JSONB DEFAULT '{}'::jsonb,
  default_environment VARCHAR(64) DEFAULT 'production',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL,
  env_type project_environment_type NOT NULL DEFAULT 'development',
  is_production BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_proj_env_name UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS project_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version VARCHAR(128) NOT NULL,
  commit_sha VARCHAR(64),
  ref_name VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_proj_release UNIQUE (project_id, version)
);

-- ============================================================
-- Source: 06_projects/002_project_members_roles.sql
-- ============================================================

-- Project Members & Roles Schema
-- File: 06_projects/002_project_members_roles.sql

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role project_member_role NOT NULL DEFAULT 'editor',
  status project_member_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_proj_user UNIQUE (project_id, user_id)
);

-- ============================================================
-- Source: 06_projects/003_project_api_keys.sql
-- ============================================================

-- Project API Keys & Rotation Schema
-- File: 06_projects/003_project_api_keys.sql

CREATE TABLE IF NOT EXISTS project_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(32) NOT NULL,
  key_hash VARCHAR(128) UNIQUE NOT NULL,
  type api_key_type NOT NULL DEFAULT 'ingestion',
  status api_key_status NOT NULL DEFAULT 'active',
  environment project_environment NOT NULL DEFAULT 'production',
  allowed_origins TEXT[] DEFAULT '{}'::text[],
  rate_limit_rps INT DEFAULT 1000,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_api_key_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  old_key_hash VARCHAR(128) NOT NULL,
  new_key_hash VARCHAR(128) NOT NULL,
  state api_key_rotation_state NOT NULL DEFAULT 'grace_period',
  grace_period_ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 06_projects/004_sdk_configurations.sql
-- ============================================================

-- SDK Configurations Schema
-- File: 06_projects/004_sdk_configurations.sql

CREATE TABLE IF NOT EXISTS project_environment_sdk_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_proj_env_sdk UNIQUE (project_id, environment_id)
);

CREATE TABLE IF NOT EXISTS project_environment_sdk_config_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sdk_config_id UUID NOT NULL REFERENCES project_environment_sdk_configs(id) ON DELETE CASCADE,
  revision_number INT NOT NULL,
  config JSONB NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sdk_config_rev UNIQUE (sdk_config_id, revision_number)
);

-- ============================================================
-- Source: 07_billing/001_plans_and_features.sql
-- ============================================================

-- Billing Plans & Features Core Schema
-- File: 07_billing/001_plans_and_features.sql

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL,
  code VARCHAR(64) UNIQUE NOT NULL,
  tier billing_plan_tier NOT NULL DEFAULT 'free',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_public BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(128) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  category billing_feature_category NOT NULL DEFAULT 'core',
  value_type billing_feature_value_type NOT NULL DEFAULT 'boolean',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  default_value JSONB DEFAULT 'false'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 07_billing/002_entitlements_and_pricing.sql
-- ============================================================

-- Billing Entitlements & Pricing Schema
-- File: 07_billing/002_entitlements_and_pricing.sql

CREATE TABLE IF NOT EXISTS plan_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  interval_type billing_interval_type NOT NULL DEFAULT 'monthly',
  interval_count INT NOT NULL DEFAULT 1,
  stripe_price_id VARCHAR(128),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_feature_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  value_limit JSONB DEFAULT 'true'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_plan_feature UNIQUE (plan_id, feature_id)
);

-- ============================================================
-- Source: 07_billing/003_subscriptions_and_overrides.sql
-- ============================================================

-- Billing Subscriptions & Feature Overrides Schema
-- File: 07_billing/003_subscriptions_and_overrides.sql

CREATE TABLE IF NOT EXISTS organization_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  plan_price_id UUID REFERENCES plan_prices(id) ON DELETE SET NULL,
  status billing_subscription_status NOT NULL DEFAULT 'active',
  stripe_customer_id VARCHAR(128),
  stripe_subscription_id VARCHAR(128) UNIQUE,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_feature_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  value_override JSONB NOT NULL,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_org_feature_override UNIQUE (organization_id, feature_id)
);

CREATE TABLE IF NOT EXISTS subscription_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  code VARCHAR(64) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
  event_type subscription_event_type NOT NULL,
  actor subscription_event_actor NOT NULL DEFAULT 'system',
  previous_plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  new_plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 07_billing/004_invoices_and_payments.sql
-- ============================================================

-- Billing Invoices, Payments & Coupons Schema
-- File: 07_billing/004_invoices_and_payments.sql

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
  invoice_number VARCHAR(64) UNIQUE NOT NULL,
  status billing_invoice_status NOT NULL DEFAULT 'draft',
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  amount_due NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  stripe_invoice_id VARCHAR(128),
  pdf_url TEXT,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  quantity INT NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  status billing_payment_status NOT NULL DEFAULT 'pending',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  payment_method_type VARCHAR(64) DEFAULT 'card',
  provider_payment_id VARCHAR(128),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL DEFAULT 'card',
  provider_payment_method_id VARCHAR(128) UNIQUE NOT NULL,
  brand VARCHAR(64),
  last4 VARCHAR(4),
  exp_month INT,
  exp_year INT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  discount_type billing_coupon_discount_type NOT NULL DEFAULT 'percentage',
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  max_redemptions INT,
  redemptions_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES billing_coupons(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_org_coupon UNIQUE (organization_id, coupon_id)
);

-- ============================================================
-- Source: 07_billing/005_usage_metering_views.sql
-- ============================================================

-- Billing Usage Metering Table Schema
-- File: 07_billing/005_usage_metering_views.sql

CREATE TABLE IF NOT EXISTS organization_usage_current_period (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  events_count BIGINT NOT NULL DEFAULT 0,
  errors_count BIGINT NOT NULL DEFAULT 0,
  logs_bytes BIGINT NOT NULL DEFAULT 0,
  ai_tokens_count BIGINT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 08_connectors/001_connector_configs.sql
-- ============================================================

-- Connectors Configuration Schema
-- File: 08_connectors/001_connector_configs.sql

CREATE TABLE IF NOT EXISTS connector_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id VARCHAR(64) NOT NULL REFERENCES connector_providers(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  rate_limit_requests INT DEFAULT 60,
  rate_limit_window_seconds INT DEFAULT 60,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 08_connectors/002_project_channels.sql
-- ============================================================

-- Project Alert Channels & Subscriptions Schema
-- File: 08_connectors/002_project_channels.sql

CREATE TABLE IF NOT EXISTS project_alert_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_config_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  target_destination TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  min_severity alert_severity NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_connector_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  alert_channel_id UUID NOT NULL REFERENCES project_alert_channels(id) ON DELETE CASCADE,
  event_type VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_member_alert_channel_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_channel_id UUID NOT NULL REFERENCES project_alert_channels(id) ON DELETE CASCADE,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_proj_user_channel UNIQUE (project_id, user_id, alert_channel_id)
);

-- ============================================================
-- Source: 09_alerting/001_alert_rules_conditions.sql
-- ============================================================

-- Alert Rules & Conditions Schema
-- File: 09_alerting/001_alert_rules_conditions.sql

CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  severity alert_severity NOT NULL DEFAULT 'warning',
  status alert_status NOT NULL DEFAULT 'pending',
  evaluation_window_seconds INT NOT NULL DEFAULT 300,
  retrigger_interval_seconds INT NOT NULL DEFAULT 3600,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  scope_type alert_scope_type NOT NULL DEFAULT 'project',
  scope_target VARCHAR(255),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  metric_name VARCHAR(128) NOT NULL,
  condition_type alert_condition_type NOT NULL DEFAULT 'threshold',
  operator alert_condition_operator NOT NULL DEFAULT 'gt',
  threshold_value NUMERIC NOT NULL,
  granularity metric_granularity NOT NULL DEFAULT '1m',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 09_alerting/002_alert_incidents_notifications.sql
-- ============================================================

-- Alert Incidents & Notifications Schema
-- File: 09_alerting/002_alert_incidents_notifications.sql

CREATE TABLE IF NOT EXISTS alert_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  severity alert_severity NOT NULL,
  status alert_status NOT NULL DEFAULT 'firing',
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS alert_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
  alert_channel_id UUID REFERENCES project_alert_channels(id) ON DELETE SET NULL,
  channel_kind notification_channel_kind NOT NULL DEFAULT 'webhook',
  status delivery_attempt_status NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  min_severity alert_severity NOT NULL DEFAULT 'warning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_proj_user_pref UNIQUE (project_id, user_id)
);

-- ============================================================
-- Source: 09_alerting/003_escalations_and_silences.sql
-- ============================================================

-- Alert Escalations & Silences Schema
-- File: 09_alerting/003_escalations_and_silences.sql

CREATE TABLE IF NOT EXISTS alert_escalation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_silences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  alert_rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 10_observability/001_events_and_requests.sql
-- ============================================================

-- Observability Events & Request Telemetry Schema
-- File: 10_observability/001_events_and_requests.sql

CREATE TABLE IF NOT EXISTS events_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  api_key_name VARCHAR(255),
  event_id VARCHAR(128),
  request_id VARCHAR(128),
  trace_id VARCHAR(128),
  span_id VARCHAR(128),
  parent_span_id VARCHAR(128),
  session_id VARCHAR(128),
  user_id VARCHAR(128),
  tenant_id VARCHAR(128),
  endpoint TEXT,
  name VARCHAR(255),
  method VARCHAR(16),
  status_code INT,
  duration_ms NUMERIC(10,3),
  body_size INT,
  response_size INT,
  span_count INT DEFAULT 0,
  root_span_status VARCHAR(64),
  is_partial BOOLEAN DEFAULT false,
  client_ip_hash VARCHAR(64),
  user_agent TEXT,
  referer TEXT,
  geo_country_code VARCHAR(8),
  geo_region VARCHAR(64),
  geo_asn VARCHAR(64),
  browser_family VARCHAR(64),
  browser_version_major VARCHAR(16),
  os_name VARCHAR(64),
  os_version_major VARCHAR(16),
  device_type VARCHAR(64),
  is_bot BOOLEAN DEFAULT false,
  service VARCHAR(128),
  framework VARCHAR(64),
  environment VARCHAR(64) DEFAULT 'production',
  release VARCHAR(128),
  server_name VARCHAR(128),
  sdk_name VARCHAR(64),
  sdk_version VARCHAR(32),
  severity alert_severity DEFAULT 'info',
  attributes JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  payload JSONB DEFAULT '{}'::jsonb,
  ai_response JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 11_usage/001_usage_counters_staging.sql
-- ============================================================

-- Usage Metering Daily Counters & Staging Schema
-- File: 11_usage/001_usage_counters_staging.sql

CREATE TABLE IF NOT EXISTS usage_daily_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  metric_key VARCHAR(128) NOT NULL,
  date_bucket DATE NOT NULL,
  count_value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_org_proj_metric_date UNIQUE (organization_id, project_id, metric_key, date_bucket)
);

CREATE TABLE IF NOT EXISTS usage_counter_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  metric_key VARCHAR(128) NOT NULL,
  increment_value BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 10_observability/002_errors_and_logs.sql
-- ============================================================

-- Observability Error Groups, Errors & Logs Schema
-- File: 10_observability/002_errors_and_logs.sql

CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint VARCHAR(128) NOT NULL,
  title TEXT NOT NULL,
  error_type VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unresolved',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_count BIGINT NOT NULL DEFAULT 1,
  user_count BIGINT NOT NULL DEFAULT 1,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT uq_proj_fingerprint UNIQUE (project_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS events_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id UUID REFERENCES error_groups(id) ON DELETE SET NULL,
  error_type VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT,
  severity alert_severity DEFAULT 'warning',
  environment VARCHAR(64) DEFAULT 'production',
  release VARCHAR(128),
  user_id VARCHAR(128),
  request_id VARCHAR(128),
  trace_id VARCHAR(128),
  payload JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level VARCHAR(16) NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  service VARCHAR(128),
  environment VARCHAR(64) DEFAULT 'production',
  trace_id VARCHAR(128),
  span_id VARCHAR(128),
  attributes JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 10_observability/003_metrics_and_spans.sql
-- ============================================================

-- Observability Metrics & Spans Schema
-- File: 10_observability/003_metrics_and_spans.sql

CREATE TABLE IF NOT EXISTS events_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric_name VARCHAR(128) NOT NULL,
  value NUMERIC NOT NULL,
  unit VARCHAR(32),
  tags JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trace_id VARCHAR(128) NOT NULL,
  span_id VARCHAR(128) NOT NULL,
  parent_span_id VARCHAR(128),
  name VARCHAR(255) NOT NULL,
  kind VARCHAR(32) DEFAULT 'internal',
  duration_ms NUMERIC(10,3) NOT NULL,
  status_code VARCHAR(32) DEFAULT 'ok',
  attributes JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 10_observability/004_ingestion_queues_outbox.sql
-- ============================================================

-- Observability Ingestion Queues & Transactional Outbox Schema
-- File: 10_observability/004_ingestion_queues_outbox.sql

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  event_type VARCHAR(128) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ingestion_dead_letter_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  event_type VARCHAR(128) NOT NULL,
  payload JSONB NOT NULL,
  error_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telemetry_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_family VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ============================================================
-- Source: 12_ai/001_ai_credit_system.sql
-- ============================================================

-- AI Credit System & Ledger Schema
-- File: 12_ai/001_ai_credit_system.sql

CREATE TABLE IF NOT EXISTS credit_balances (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  balance NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
  reserved NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount NUMERIC(14,4) NOT NULL,
  balance_after NUMERIC(14,4) NOT NULL,
  transaction_type VARCHAR(64) NOT NULL,
  reference_id TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(128) NOT NULL,
  prompt_token_cost NUMERIC(12,6) NOT NULL DEFAULT 0.000000,
  completion_token_cost NUMERIC(12,6) NOT NULL DEFAULT 0.000000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 12_ai/002_ai_requests_responses.sql
-- ============================================================

-- AI Requests, Responses, Feedback & Jobs Schema
-- File: 12_ai/002_ai_requests_responses.sql

CREATE TABLE IF NOT EXISTS ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  model VARCHAR(128) NOT NULL,
  prompt TEXT NOT NULL,
  parameters JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ai_requests(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  cost_credits NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
  latency_ms INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES ai_responses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  feedback_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- Source: 12_ai/003_ai_cache_prompts_routes.sql
-- ============================================================

-- AI Cache, Prompt Templates & Model Routing Schema
-- File: 12_ai/003_ai_cache_prompts_routes.sql

CREATE TABLE IF NOT EXISTS ai_cache (
  prompt_hash VARCHAR(128) PRIMARY KEY,
  model VARCHAR(128) NOT NULL,
  response_json JSONB NOT NULL,
  ttl_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  template_text TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_model_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type VARCHAR(64) NOT NULL,
  primary_model VARCHAR(128) NOT NULL,
  fallback_model VARCHAR(128),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 13_automation/001_automation_workflows.sql
-- ============================================================

-- Automation Workflows, Triggers & Actions Schema
-- File: 13_automation/001_automation_workflows.sql

CREATE TABLE IF NOT EXISTS automation_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status automation_workflow_status NOT NULL DEFAULT 'draft',
  scope automation_workflow_scope NOT NULL DEFAULT 'organization',
  version INT NOT NULL DEFAULT 1,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_workflow_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  trigger_kind automation_trigger_kind NOT NULL,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_workflow_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  action_type VARCHAR(128) NOT NULL,
  risk_level automation_action_risk NOT NULL DEFAULT 'low',
  step_order INT NOT NULL DEFAULT 0,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 13_automation/002_automation_runs_steps.sql
-- ============================================================

-- Automation Runs, Steps & Execution Logs Schema
-- File: 13_automation/002_automation_runs_steps.sql

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status automation_run_status NOT NULL DEFAULT 'pending',
  trigger_payload JSONB DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS automation_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  action_id UUID REFERENCES automation_workflow_actions(id) ON DELETE SET NULL,
  status automation_step_status NOT NULL DEFAULT 'pending',
  step_order INT NOT NULL DEFAULT 0,
  input JSONB DEFAULT '{}'::jsonb,
  output JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS automation_run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES automation_run_steps(id) ON DELETE CASCADE,
  level VARCHAR(16) NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 14_indexes/001_tenant_isolation_indexes.sql
-- ============================================================

-- Tenant Isolation & Primary Composite Indexes
-- File: 14_indexes/001_tenant_isolation_indexes.sql

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_email ON organization_invitations(organization_id, email);

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_org_slug ON projects(organization_id, slug);
CREATE INDEX IF NOT EXISTS idx_proj_env_proj_id ON project_environments(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_members_proj_id ON project_members(project_id);

CREATE INDEX IF NOT EXISTS idx_proj_api_keys_proj_id ON project_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_api_keys_org_id ON project_api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_proj_api_keys_key_hash ON project_api_keys(key_hash);

CREATE INDEX IF NOT EXISTS idx_org_sub_org_id ON organization_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_org_id ON payments(organization_id);

CREATE INDEX IF NOT EXISTS idx_connector_configs_org_id ON connector_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_org_proj ON alert_rules(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_proj ON alert_incidents(organization_id, project_id);

CREATE INDEX IF NOT EXISTS idx_events_requests_org_proj ON events_requests(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_events_errors_org_proj ON events_errors(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_events_logs_org_proj ON events_logs(organization_id, project_id);

-- ============================================================
-- Source: 14_indexes/002_performance_query_indexes.sql
-- ============================================================

-- Performance & High-Velocity Temporal Query Indexes
-- File: 14_indexes/002_performance_query_indexes.sql

CREATE INDEX IF NOT EXISTS idx_events_req_occurred_at ON events_requests(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_req_org_occurred ON events_requests(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_req_proj_occurred ON events_requests(project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_err_group_id ON events_errors(group_id);
CREATE INDEX IF NOT EXISTS idx_events_err_org_occurred ON events_errors(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_err_proj_occurred ON events_errors(project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_occurred ON events_logs(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_logs_proj_occurred ON events_logs(project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_incidents_status ON alert_incidents(status, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notifications_incident ON alert_notifications(incident_id);

CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_status ON telemetry_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_requests_org_id ON ai_requests(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_workflow_id ON automation_runs(workflow_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_daily_counters_lookup ON usage_daily_counters(organization_id, metric_key, date_bucket);

-- ============================================================
-- Source: 15_functions/001_helper_functions.sql
-- ============================================================

-- Database Helper Functions & Trigger Routines
-- File: 15_functions/001_helper_functions.sql

-- 1. Generic updated_at timestamp trigger function
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Increment usage counter function
CREATE OR REPLACE FUNCTION fn_increment_usage_counter(
  p_org_id UUID,
  p_proj_id UUID,
  p_metric_key VARCHAR,
  p_date_bucket DATE,
  p_increment BIGINT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO usage_daily_counters (
    organization_id,
    project_id,
    metric_key,
    date_bucket,
    count_value,
    updated_at
  )
  VALUES (
    p_org_id,
    p_proj_id,
    p_metric_key,
    p_date_bucket,
    p_increment,
    NOW()
  )
  ON CONFLICT (organization_id, project_id, metric_key, date_bucket)
  DO UPDATE SET
    count_value = usage_daily_counters.count_value + EXCLUDED.count_value,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Source: 16_triggers/001_updated_at_and_audit_triggers.sql
-- ============================================================

-- Automatic Timestamp Triggers
-- File: 16_triggers/001_updated_at_and_audit_triggers.sql

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_user_sessions_updated_at ON user_sessions;
CREATE TRIGGER trg_user_sessions_updated_at
  BEFORE UPDATE ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_organization_members_updated_at ON organization_members;
CREATE TRIGGER trg_organization_members_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_project_environments_updated_at ON project_environments;
CREATE TRIGGER trg_project_environments_updated_at
  BEFORE UPDATE ON project_environments
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_project_api_keys_updated_at ON project_api_keys;
CREATE TRIGGER trg_project_api_keys_updated_at
  BEFORE UPDATE ON project_api_keys
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_features_updated_at ON features;
CREATE TRIGGER trg_features_updated_at
  BEFORE UPDATE ON features
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_organization_subscriptions_updated_at ON organization_subscriptions;
CREATE TRIGGER trg_organization_subscriptions_updated_at
  BEFORE UPDATE ON organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_organization_feature_overrides_updated_at ON organization_feature_overrides;
CREATE TRIGGER trg_organization_feature_overrides_updated_at
  BEFORE UPDATE ON organization_feature_overrides
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_connector_configs_updated_at ON connector_configs;
CREATE TRIGGER trg_connector_configs_updated_at
  BEFORE UPDATE ON connector_configs
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trg_alert_rules_updated_at ON alert_rules;
CREATE TRIGGER trg_alert_rules_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ============================================================
-- Source: 17_views/001_entitlement_and_usage_views.sql
-- ============================================================

-- Entitlement & Usage Aggregation Views
-- File: 17_views/001_entitlement_and_usage_views.sql

CREATE OR REPLACE VIEW v_effective_entitlements AS
SELECT
  sub.organization_id,
  f.key AS feature_key,
  f.name AS feature_name,
  f.category AS feature_category,
  COALESCE(ov.is_enabled, pfe.is_enabled, false) AS is_enabled,
  COALESCE(ov.value_override, pfe.value_limit, f.default_value) AS effective_value,
  CASE WHEN ov.id IS NOT NULL THEN 'override' ELSE 'plan' END AS entitlement_source
FROM organization_subscriptions sub
JOIN plans p ON p.id = sub.plan_id
JOIN plan_feature_entitlements pfe ON pfe.plan_id = p.id
JOIN features f ON f.id = pfe.feature_id
LEFT JOIN organization_feature_overrides ov ON ov.organization_id = sub.organization_id
  AND ov.feature_id = f.id
  AND (ov.expires_at IS NULL OR ov.expires_at > NOW())
WHERE sub.status IN ('active', 'trialing');

CREATE OR REPLACE VIEW v_current_usage AS
SELECT
  udc.organization_id,
  udc.metric_key,
  SUM(udc.count_value) AS total_count,
  MIN(udc.date_bucket) AS period_start,
  MAX(udc.date_bucket) AS period_end
FROM usage_daily_counters udc
GROUP BY udc.organization_id, udc.metric_key;

-- ============================================================
-- Source: 18_partitions/001_partition_setup.sql
-- ============================================================

-- Partitioning Strategy Setup
-- File: 18_partitions/001_partition_setup.sql

-- Documented Partitioning Architecture:
-- Telemetry and usage counters utilize range-based partitioning by date_bucket / occurred_at when deployed to enterprise scale.
-- Default partition handlers keep single-node & local development environments fully compatible without requiring pg_partman.

COMMENT ON TABLE usage_daily_counters IS 'Partitioned by date_bucket range in production deployments';
COMMENT ON TABLE events_requests IS 'Partitioned by occurred_at range in production deployments';
COMMENT ON TABLE events_logs IS 'Partitioned by occurred_at range in production deployments';

-- ============================================================
-- Source: 19_seeders/001_billing_and_reference_seeders.sql
-- ============================================================

-- Canonical Billing & Reference Seed Data
-- File: 19_seeders/001_billing_and_reference_seeders.sql

-- 1. Insert Reference Plans
INSERT INTO plans (id, name, code, tier, description, is_active, is_public, sort_order)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Free Developer', 'free', 'free', 'Free tier for personal projects and small prototypes.', true, true, 1),
  ('10000000-0000-4000-8000-000000000002', 'Pro Team', 'pro', 'pro', 'For growing teams requiring enhanced limits and connectors.', true, true, 2),
  ('10000000-0000-4000-8000-000000000003', 'Enterprise', 'enterprise', 'enterprise', 'Custom SLAs, SSO SAML, SCIM, and dedicated support.', true, true, 3)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- 2. Insert Core Features
INSERT INTO features (id, key, name, category, value_type, description, is_active, default_value)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'retention_days', 'Data Retention (Days)', 'core', 'numeric', 'Number of days telemetry data is retained', true, '7'::jsonb),
  ('20000000-0000-4000-8000-000000000002', 'monthly_events_limit', 'Monthly Ingestion Events', 'observability', 'numeric', 'Monthly allowed ingestion events quota', true, '100000'::jsonb),
  ('20000000-0000-4000-8000-000000000003', 'sso_saml', 'SSO / SAML Authentication', 'security', 'boolean', 'Single Sign-On integration support', true, 'false'::jsonb),
  ('20000000-0000-4000-8000-000000000004', 'ai_credits_monthly', 'Monthly AI Intelligence Credits', 'ai', 'numeric', 'Monthly AI prompt & analysis credit quota', true, '50'::jsonb),
  ('20000000-0000-4000-8000-000000000005', 'custom_alert_channels', 'Custom Alert Connectors', 'alerting', 'boolean', 'Ability to create custom webhook/pagerduty alert channels', true, 'false'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- 3. Seed Plan Prices
INSERT INTO plan_prices (plan_id, currency, amount, interval_type, interval_count)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'USD', 0.00, 'monthly', 1),
  ('10000000-0000-4000-8000-000000000002', 'USD', 49.00, 'monthly', 1),
  ('10000000-0000-4000-8000-000000000003', 'USD', 499.00, 'monthly', 1)
ON CONFLICT DO NOTHING;

-- 4. Seed Free Plan Entitlements
INSERT INTO plan_feature_entitlements (plan_id, feature_id, is_enabled, value_limit)
VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', true, '7'::jsonb),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', true, '100000'::jsonb),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', false, 'false'::jsonb),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', true, '50'::jsonb),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005', false, 'false'::jsonb)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  value_limit = EXCLUDED.value_limit,
  updated_at = NOW();

-- 5. Seed Pro Plan Entitlements
INSERT INTO plan_feature_entitlements (plan_id, feature_id, is_enabled, value_limit)
VALUES
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', true, '30'::jsonb),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', true, '2500000'::jsonb),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', false, 'false'::jsonb),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004', true, '1000'::jsonb),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', true, 'true'::jsonb)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  value_limit = EXCLUDED.value_limit,
  updated_at = NOW();

-- 6. Seed Enterprise Plan Entitlements
INSERT INTO plan_feature_entitlements (plan_id, feature_id, is_enabled, value_limit)
VALUES
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', true, '90'::jsonb),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', true, '50000000'::jsonb),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', true, 'true'::jsonb),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004', true, '50000'::jsonb),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000005', true, 'true'::jsonb)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  value_limit = EXCLUDED.value_limit,
  updated_at = NOW();

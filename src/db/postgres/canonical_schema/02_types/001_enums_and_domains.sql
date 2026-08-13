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

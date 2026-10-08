-- Clean PostgreSQL primary database baseline.
-- Generated from modular schema domain sources with latest indexes and migrations.

-- ============================================================
-- Source: 00_extensions/001_extensions.sql
-- ============================================================

-- Source: canonical_migrations_draft/00_shared/001_enable_pgcrypto.up.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Source: canonical_migrations_draft/18_ai/001_extensions.up.sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Optional native C extension for RFC 9562 UUIDv7
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- Safe fallback when compiled pg_uuidv7 library is not present on host OS
END $$;

-- ============================================================
-- Source: 02_types/001_enums_and_domains.sql
-- ============================================================

-- Source: canonical_migrations_draft/01_auth/001_create_users.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'deleted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mfa_type') THEN
    CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'hardware_key', 'backup_codes');
  END IF;
END $$;

-- Source: canonical_migrations_draft/01_auth/002_create_user_sessions.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM ('active', 'expired', 'revoked', 'terminated_by_admin');
  END IF;
END $$;

-- Source: canonical_migrations_draft/01_auth/003_create_user_mfa_devices.up.sql
DO $$ BEGIN
  CREATE TYPE mfa_type AS ENUM ('totp', 'sms', 'email', 'webauthn', 'backup_code');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Source: canonical_migrations_draft/01_auth/006_create_security_events.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_event_type') THEN
    CREATE TYPE security_event_type AS ENUM (
      'brute_force_attempt',
      'suspicious_ip',
      'impossible_travel',
      'credential_stuffing',
      'account_takeover',
      'privilege_escalation',
      'mfa_disable_requested',
      'mfa_recovery_requested',
      'refresh_token_reuse'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/02_organizations/001_create_organizations.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_status') THEN
    CREATE TYPE org_status AS ENUM ('active', 'trialing', 'suspended', 'locked', 'archived', 'delinquent');
  END IF;
END $$;

-- Source: canonical_migrations_draft/02_organizations/003_create_organization_members.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE member_status AS ENUM ('invited', 'active', 'suspended', 'removed', 'locked');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE org_role AS ENUM ('owner', 'admin', 'developer', 'billing', 'security', 'member', 'viewer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'joined_method') THEN
    CREATE TYPE joined_method AS ENUM ('invite', 'admin_add', 'sso_auto_provision', 'scim');
  END IF;
END $$;

-- Source: canonical_migrations_draft/02_organizations/004_create_organization_invitations.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
    CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined', 'revoked', 'expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE org_role AS ENUM ('owner', 'admin', 'developer', 'billing', 'security', 'member', 'viewer');
  END IF;
END $$;

-- Source: canonical_migrations_draft/02_organizations/005_create_quota_requests.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quota_request_status') THEN
    CREATE TYPE quota_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;
END $$;

-- Source: canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_event_actor') THEN
    CREATE TYPE subscription_event_actor AS ENUM ('user', 'system', 'billing_provider', 'admin');
  END IF;
END $$;

-- Source: canonical_migrations_draft/04_projects/001_create_projects.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_status') THEN
    CREATE TYPE project_status AS ENUM ('active', 'archived', 'suspended');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_environment') THEN
    CREATE TYPE project_environment AS ENUM ('development', 'production');
  END IF;
END $$;

-- Source: canonical_migrations_draft/04_projects/002_create_project_members.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_member_role') THEN
    CREATE TYPE project_member_role AS ENUM ('owner', 'admin', 'developer', 'viewer');
  END IF;
END $$;

-- Source: canonical_migrations_draft/04_projects/005_create_project_api_keys.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_status') THEN
    CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_environment') THEN
    CREATE TYPE project_environment AS ENUM ('development', 'production');
  END IF;
END $$;

-- Source: canonical_migrations_draft/04_projects/006_extend_project_enums.up.sql
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'paused';

-- Source: canonical_migrations_draft/04_projects/006_extend_project_enums.up.sql
ALTER TYPE project_member_role ADD VALUE IF NOT EXISTS 'qa';

-- Source: canonical_migrations_draft/04_projects/006_extend_project_enums.up.sql
ALTER TYPE api_key_status ADD VALUE IF NOT EXISTS 'suspended';

-- Source: canonical_migrations_draft/04_projects/006_extend_project_enums.up.sql
ALTER TYPE api_key_status ADD VALUE IF NOT EXISTS 'rotated';

-- Source: canonical_migrations_draft/04_projects/006_extend_project_enums.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_visibility') THEN
    CREATE TYPE project_visibility AS ENUM ('private', 'organization', 'public');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_member_status') THEN
    CREATE TYPE project_member_status AS ENUM ('pending', 'active', 'inactive', 'removed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_type') THEN
    CREATE TYPE api_key_type AS ENUM ('read_write', 'read_only', 'write_only', 'temporary');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_rotation_state') THEN
    CREATE TYPE api_key_rotation_state AS ENUM ('none', 'rotating', 'grace_period', 'completed');
  END IF;
END $$;

-- Source: canonical_migrations_draft/04_projects/007_create_project_environments.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_environment_type') THEN
    CREATE TYPE project_environment_type AS ENUM (
      'production', 'pre_production', 'staging', 'pre_staging', 'development',
      'testing', 'preview', 'pre_deployment', 'custom'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'production';

-- Source: canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'pre_production';

-- Source: canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'staging';

-- Source: canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'pre_staging';

-- Source: canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'development';

-- Source: canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'testing';

-- Source: canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'preview';

-- Source: canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'pre_deployment';

-- Source: canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql
ALTER TYPE project_environment_type ADD VALUE IF NOT EXISTS 'custom';

-- Source: canonical_migrations_draft/07_notifications/001_create_notification_types.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_severity') THEN
    CREATE TYPE notification_severity AS ENUM (
      'info', 'warning', 'error', 'critical'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status') THEN
    CREATE TYPE delivery_status AS ENUM (
      'pending', 'sent', 'delivered', 'failed', 'retrying', 'cancelled'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/08_alerting/001_create_alerting_types.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_severity') THEN
    CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'error', 'critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_status') THEN
    CREATE TYPE alert_status AS ENUM ('firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'pending');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_condition_type') THEN
    CREATE TYPE alert_condition_type AS ENUM ('threshold', 'change', 'anomaly', 'static', 'composite');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_condition_operator') THEN
    CREATE TYPE alert_condition_operator AS ENUM ('gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'regex', 'in', 'exists');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_action_type') THEN
    CREATE TYPE alert_action_type AS ENUM ('notify', 'webhook', 'suppress', 'escalate', 'group');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_status') THEN
    CREATE TYPE alert_event_status AS ENUM ('pending', 'processing', 'firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_attempt_status') THEN
    CREATE TYPE delivery_attempt_status AS ENUM ('pending', 'queued', 'sent', 'delivered', 'failed', 'retrying', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_status') THEN
    CREATE TYPE batch_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'partial');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'history_action') THEN
    CREATE TYPE history_action AS ENUM ('triggered', 'acknowledged', 'resolved', 'escalated', 'suppressed', 'notified', 'silenced', 'grouped', 'auto_resolved', 'rule_modified');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'metric_granularity') THEN
    CREATE TYPE metric_granularity AS ENUM ('hour', 'day', 'week', 'month');
  END IF;
END $$;

-- Source: canonical_migrations_draft/08_alerting/019_create_alert_scope_types.up.sql
DO $$
BEGIN
  -- Precedence ladder for effective rule resolution: organization=0 … endpoint=4.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_scope_type') THEN
    CREATE TYPE alert_scope_type AS ENUM (
      'organization','project','environment','service','endpoint'
    );
  END IF;

  -- inherit  : take the parent scope's value for every field left NULL
  -- override : replace the parent's value for the fields this binding sets
  -- disable   : stop the rule at this scope (a DEEPER override may re-enable it)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_binding_mode') THEN
    CREATE TYPE alert_binding_mode AS ENUM ('inherit','override','disable');
  END IF;

  -- How a binding combines its actions with the parent scope's actions.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_action_merge_mode') THEN
    CREATE TYPE alert_action_merge_mode AS ENUM ('inherit','merge','replace');
  END IF;

  -- Rules request CHANNELS, never connector ids (ADR-0009).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel_kind') THEN
    CREATE TYPE notification_channel_kind AS ENUM (
      'in_app','email','slack','discord','teams','pagerduty','webhook','sms'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_plan_tier'
    ) THEN
        CREATE TYPE billing_plan_tier AS ENUM
        (
            'free',
            'starter',
            'growth',
            'business',
            'enterprise'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_subscription_status'
    ) THEN
        CREATE TYPE billing_subscription_status AS ENUM
        (
            'trialing',
            'active',
            'past_due',
            'paused',
            'cancelled',
            'expired',
            'incomplete'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_provider_type'
    ) THEN
        CREATE TYPE billing_provider_type AS ENUM
        (
            'stripe',
            'razorpay',
            'manual',
            'system'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_interval_type'
    ) THEN
        CREATE TYPE billing_interval_type AS ENUM
        (
            'monthly',
            'annual'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_invoice_status'
    ) THEN
        CREATE TYPE billing_invoice_status AS ENUM
        (
            'draft',
            'open',
            'paid',
            'void',
            'uncollectible',
            'refunded'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_payment_status'
    ) THEN
        CREATE TYPE billing_payment_status AS ENUM
        (
            'pending',
            'processing',
            'succeeded',
            'failed',
            'cancelled',
            'refunded'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_coupon_discount_type'
    ) THEN
        CREATE TYPE billing_coupon_discount_type AS ENUM
        (
            'percentage',
            'fixed_amount'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_feature_value_type'
    ) THEN
        CREATE TYPE billing_feature_value_type AS ENUM
        (
            'boolean',
            'integer',
            'decimal',
            'string'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_feature_category'
    ) THEN
        CREATE TYPE billing_feature_category AS ENUM
        (
            'monitoring',
            'ai',
            'alerts',
            'projects',
            'organization',
            'dashboard',
            'security',
            'limits',
            'integrations'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'subscription_event_type'
    ) THEN
        CREATE TYPE subscription_event_type AS ENUM
        (
            'created',
            'upgraded',
            'downgraded',
            'renewed',
            'trial_started',
            'trial_ended',
            'cancelled',
            'resumed',
            'expired',
            'payment_failed',
            'payment_succeeded',
            'addon_purchased',
            'feature_override_added'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/001_billing_enums.sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'subscription_event_actor'
    ) THEN
        CREATE TYPE subscription_event_actor AS ENUM
        (
            'user',
            'admin',
            'system',
            'billing_provider'
        );
    END IF;
END $$;

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'quota';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'feature';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'sdk';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'transport';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'sampling';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'instrumentation';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'privacy';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'killswitch';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'alerting';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'integration';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_category ADD VALUE IF NOT EXISTS 'support';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
ALTER TYPE billing_feature_value_type ADD VALUE IF NOT EXISTS 'json';

-- Source: canonical_migrations_draft/11_billing/newupdatedfix.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_usage_behavior') THEN
    CREATE TYPE billing_usage_behavior AS ENUM ('none', 'hard_limit', 'soft_limit', 'overage', 'throttle');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_visibility') THEN
    CREATE TYPE billing_visibility AS ENUM ('public', 'internal', 'hidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_tax_behavior') THEN
    CREATE TYPE billing_tax_behavior AS ENUM ('exclusive', 'inclusive', 'unspecified');
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_workflow_status') THEN
    CREATE TYPE automation_workflow_status AS ENUM (
      'draft',
      'active',
      'paused',
      'archived',
      'disabled'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_workflow_scope') THEN
    CREATE TYPE automation_workflow_scope AS ENUM (
      'organization',
      'project',
      'platform'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_template_scope') THEN
    CREATE TYPE automation_template_scope AS ENUM (
      'platform',
      'organization'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_trigger_kind') THEN
    CREATE TYPE automation_trigger_kind AS ENUM (
      'event',
      'schedule',
      'manual',
      'webhook'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_condition_operator') THEN
    CREATE TYPE automation_condition_operator AS ENUM (
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'in',
      'not_in',
      'contains',
      'not_contains',
      'matches',
      'exists',
      'not_exists',
      'between'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_action_risk') THEN
    CREATE TYPE automation_action_risk AS ENUM (
      'low',
      'medium',
      'high',
      'critical'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_run_status') THEN
    CREATE TYPE automation_run_status AS ENUM (
      'queued',
      'running',
      'waiting_approval',
      'succeeded',
      'failed',
      'cancelled',
      'skipped',
      'timed_out'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_step_status') THEN
    CREATE TYPE automation_step_status AS ENUM (
      'queued',
      'running',
      'waiting_approval',
      'succeeded',
      'failed',
      'skipped',
      'cancelled',
      'timed_out'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_approval_status') THEN
    CREATE TYPE automation_approval_status AS ENUM (
      'pending',
      'approved',
      'rejected',
      'expired',
      'cancelled'
    );
  END IF;
END $$;

-- Source: canonical_migrations_draft/19_automation/001_automation_enums.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_audit_action') THEN
    CREATE TYPE automation_audit_action AS ENUM (
      'workflow_created',
      'workflow_updated',
      'workflow_enabled',
      'workflow_disabled',
      'workflow_paused',
      'workflow_archived',
      'workflow_version_published',
      'trigger_received',
      'run_queued',
      'run_started',
      'run_completed',
      'run_failed',
      'run_cancelled',
      'step_started',
      'step_completed',
      'step_failed',
      'approval_requested',
      'approval_approved',
      'approval_rejected',
      'template_created',
      'template_published'
    );
  END IF;
END $$;

-- Source: migrations/002_create_all_ordered.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_key_status') THEN
    CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired');
  END IF;
END $$;

-- Source: migrations/002_create_all_ordered.sql
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'escalation_step';

-- Source: migrations/002_create_all_ordered.sql
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'throttled';

-- Source: migrations/002_create_all_ordered.sql
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'dead_lettered';

-- Source: migrations/002_create_all_ordered.sql
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'requeued';

-- Source: migrations/002_create_all_ordered.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_dead_letter_status') THEN
    CREATE TYPE alert_dead_letter_status AS ENUM ('pending_retry', 'retried', 'exhausted', 'discarded');
  END IF;
END $$;

-- Source: migrations/002_create_all_ordered.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_job_state') THEN
    CREATE TYPE ingestion_job_state AS ENUM (
      'pending',
      'active',
      'completed',
      'failed',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_job_priority') THEN
    CREATE TYPE ingestion_job_priority AS ENUM (
      'critical', 'high', 'normal', 'low', 'background'
    );
  END IF;
END $$;

-- Source: migrations/002_create_all_ordered.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_severity') THEN
    CREATE TYPE event_severity AS ENUM ('debug', 'info', 'warning', 'error', 'fatal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'span_status') THEN
    CREATE TYPE span_status AS ENUM ('ok', 'error', 'unset');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'span_kind') THEN
    CREATE TYPE span_kind AS ENUM ('internal', 'server', 'client', 'producer', 'consumer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_metric_type') THEN
    CREATE TYPE analytics_metric_type AS ENUM ('counter', 'gauge', 'histogram');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'log_level') THEN
    CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cron_status') THEN
    CREATE TYPE cron_status AS ENUM ('ok', 'error', 'in_progress');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_group_status') THEN
    CREATE TYPE error_group_status AS ENUM ('unresolved', 'resolved', 'ignored', 'muted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rollup_granularity') THEN
    CREATE TYPE rollup_granularity AS ENUM ('hour', 'day', 'week', 'month');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_alert_operator') THEN
    CREATE TYPE analytics_alert_operator AS ENUM ('gt', 'lt', 'eq', 'gte', 'lte');
  END IF;
END $$;

-- Source: migrations/003_project_module_refactor.sql
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

-- Generated compatibility type for legacy notification and alerting tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_type') THEN
    CREATE TYPE connector_type AS ENUM ('email', 'slack', 'webhook', 'discord', 'teams', 'pagerduty', 'sms');
  END IF;
END $$;

-- Generated compatibility value for legacy project notification preference seeds.
ALTER TYPE alert_category ADD VALUE IF NOT EXISTS 'all';

-- ============================================================
-- Source: 03_reference/001_create_telemetry_event_types.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS telemetry_event_types (
  id SMALLSERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO telemetry_event_types(name)
VALUES ('__all__'), ('request'), ('error'), ('log'), ('metric'), ('span'), ('trace'), ('message'), ('profile'), ('replay'), ('cron_checkin')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- Source: 04_user/001_create_auth_email_outbox.sql
-- ============================================================

-- Normalized final definition for auth_email_outbox.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/010_create_auth_email_outbox.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS auth_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  template_name VARCHAR(100),
  template_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
  CHECK (
  status IN (
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled'
  )
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  processing_worker_id UUID,
  processing_expires_at TIMESTAMPTZ,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_pending
ON auth_email_outbox(next_attempt_at, created_at)
WHERE status='pending';

CREATE INDEX IF NOT EXISTS idx_email_processing
ON auth_email_outbox(processing_started_at)
WHERE status='processing';

CREATE INDEX IF NOT EXISTS idx_email_sent
ON auth_email_outbox(sent_at)
WHERE status='sent';

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_dedupe
ON auth_email_outbox(dedupe_key)
WHERE dedupe_key IS NOT NULL
AND status IN ('pending','processing');

-- ============================================================
-- Source: 04_user/001_create_users.sql
-- ============================================================

-- Normalized final definition for users.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/001_create_users.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql
-- - canonical_migrations_draft/02_organizations/001_create_organizations.up.sql

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  email_hash VARCHAR(64)
  GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
  original_email VARCHAR(255),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  full_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  password_hash VARCHAR(255),
  last_password_change TIMESTAMPTZ,
  password_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  status user_status NOT NULL DEFAULT 'active',
  status_reason TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_enforced_at TIMESTAMPTZ,
  mfa_backup_codes_generated_at TIMESTAMPTZ,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip INET,
  last_login_user_agent TEXT,
  last_failed_login_at TIMESTAMPTZ,
  last_failed_login_ip INET,
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
  locale VARCHAR(10) NOT NULL DEFAULT 'en',
  preferred_mfa_method mfa_type,
  accepted_terms_at TIMESTAMPTZ,
  accepted_terms_version VARCHAR(32),
  accepted_privacy_at TIMESTAMPTZ,
  accepted_privacy_version VARCHAR(32),
  marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_consent_updated_at TIMESTAMPTZ,
  data_processing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_at TIMESTAMPTZ,
  current_org_id UUID,
  suspended_by UUID,
  deletion_scheduled_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  deletion_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  version INTEGER NOT NULL DEFAULT 1,
  display_name VARCHAR(255),
  marketing_emails BOOLEAN DEFAULT false,
  product_updates BOOLEAN DEFAULT true,
  deletion_requested_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_current_org
ON users(current_org_id)
WHERE current_org_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash
  ON users(email_hash) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_status
  ON users(status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_locked
  ON users(locked_until) WHERE locked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_admin
  ON users(is_admin) WHERE is_admin = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_created_cursor
  ON users(created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_deletion_scheduled
  ON users(deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_deletion_requested
  ON users(deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_lower_email
  ON users(lower(email))
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 04_user/001_create_user_mfa_devices.sql
-- ============================================================

-- Normalized final definition for user_mfa_devices.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/003_create_user_mfa_devices.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql

CREATE TABLE IF NOT EXISTS user_mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type mfa_type NOT NULL,
  device_type VARCHAR(50) NOT NULL DEFAULT 'unknown',
  device_name VARCHAR(255) NOT NULL,
  secret_encrypted TEXT,
  phone_e164 VARCHAR(32),
  email VARCHAR(255),
  credential_id TEXT,
  public_key TEXT,
  sign_count INTEGER NOT NULL DEFAULT 0,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_used_ip INET,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_at TIMESTAMPTZ,
  disabled_reason TEXT,
  device_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_one_primary
  ON user_mfa_devices(user_id)
  WHERE is_primary = TRUE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mfa_devices_user_type
  ON user_mfa_devices(user_id, type)
  WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_devices_credential_id
  ON user_mfa_devices(credential_id)
  WHERE credential_id IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mfa_devices_phone
  ON user_mfa_devices(phone_e164)
  WHERE phone_e164 IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mfa_devices_email
  ON user_mfa_devices(email)
  WHERE email IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_mfa_devices_user_id
  ON user_mfa_devices(user_id);

-- ============================================================
-- Source: 04_user/001_create_email_mfa_otps.sql
-- ============================================================

-- Normalized final definition for email_mfa_otps.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/005_create_email_mfa_otps.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS email_mfa_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES user_mfa_devices(id) ON DELETE CASCADE,
  code_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_mfa_otps_active_device
  ON email_mfa_otps(device_id)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_mfa_otps_user
  ON email_mfa_otps(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_mfa_otps_cleanup
  ON email_mfa_otps(expires_at)
  WHERE used_at IS NULL;

-- ============================================================
-- Source: 04_user/001_create_email_verifications.sql
-- ============================================================

-- Normalized final definition for email_verifications.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/004_create_email_verifications.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'email_verification',
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_active_token_hash
  ON email_verifications(token_hash)
  WHERE verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_verifications_user_purpose_active
  ON email_verifications(user_id, purpose)
  WHERE verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_verifications_cleanup
  ON email_verifications(expires_at)
  WHERE verified_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_verifications_user_email_purpose
  ON email_verifications(user_id, email, purpose);

-- ============================================================
-- Source: 04_user/001_create_security_events.sql
-- ============================================================

-- Normalized final definition for security_events.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/006_create_security_events.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type security_event_type NOT NULL,
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 10),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address INET NOT NULL,
  ip_country VARCHAR(2),
  user_agent TEXT,
  device_fingerprint VARCHAR(64),
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_taken VARCHAR(100),
  blocked_until TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  false_positive BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_user_time
  ON security_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_security_open
  ON security_events(event_type, created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_security_ip_time
  ON security_events(ip_address, created_at DESC);

-- ============================================================
-- Source: 04_user/001_create_user_backup_codes.sql
-- ============================================================

-- Normalized final definition for user_backup_codes.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/003_create_user_mfa_devices.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql

CREATE TABLE IF NOT EXISTS user_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  used_from_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_backup_codes_user_unused
  ON user_backup_codes(user_id, created_at)
  WHERE used_at IS NULL;

-- ============================================================
-- Source: 04_user/001_create_user_linked_identities.sql
-- ============================================================

-- Normalized final definition for user_linked_identities.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/008_create_user_linked_identities.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS user_linked_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  provider_email VARCHAR(255),
  profile_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT user_linked_identities_provider_subject_unique
  UNIQUE (provider, provider_subject),
  CONSTRAINT user_linked_identities_user_provider_unique
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_linked_identities_user_active
  ON user_linked_identities(user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_linked_identities_provider_subject_active
  ON user_linked_identities(provider, provider_subject)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_linked_identities_user_all
  ON user_linked_identities (user_id, linked_at DESC);

-- ============================================================
-- Source: 04_user/001_create_user_preferences.sql
-- ============================================================

-- Normalized final definition for user_preferences.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/011_create_user_preferences.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/02_organizations/001_create_organizations.up.sql

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_org_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 04_user/001_create_user_security_events.sql
-- ============================================================

-- Normalized final definition for user_security_events.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql

CREATE TABLE IF NOT EXISTS user_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  device_info VARCHAR(500),
  ip_address INET,
  location VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_security_events_user_id_created
  ON user_security_events(user_id, created_at DESC);

-- ============================================================
-- Source: 04_user/001_create_user_sessions.sql
-- ============================================================

-- Normalized final definition for user_sessions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/002_create_user_sessions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/010_extend_user_sessions_for_sso_provider_type.up.sql

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(64) NOT NULL,
  previous_refresh_token_hash VARCHAR(64),
  previous_refresh_rotated_at TIMESTAMPTZ,
  access_token_jti VARCHAR(255),
  device_fingerprint VARCHAR(64),
  device_name VARCHAR(255),
  device_type VARCHAR(50),
  ip_address INET NOT NULL,
  ip_geo_country VARCHAR(2),
  ip_geo_city VARCHAR(100),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  status session_status NOT NULL DEFAULT 'active',
  terminated_at TIMESTAMPTZ,
  terminated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  termination_reason TEXT,
  mfa_verified_at TIMESTAMPTZ,
  mfa_expires_at TIMESTAMPTZ,
  saml_name_id TEXT,
  saml_session_index TEXT,
  sso_provider_id UUID,
  sso_provider_type VARCHAR(50),
  login_method VARCHAR(32)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token
  ON user_sessions(refresh_token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_previous_refresh_token_unique
  ON user_sessions(previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON user_sessions(user_id, status, last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_cleanup
  ON user_sessions(expires_at) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_user_sessions_purge
  ON user_sessions (status, terminated_at, expires_at)
  WHERE status IN ('revoked', 'expired', 'terminated_by_admin');

CREATE INDEX IF NOT EXISTS idx_sessions_saml_name_id
  ON user_sessions(saml_name_id) WHERE saml_name_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_sso_provider
  ON user_sessions(sso_provider_id, sso_provider_type)
  WHERE sso_provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active_last_active
  ON user_sessions (user_id, last_active_at DESC)
  WHERE status = 'active';

-- ============================================================
-- Source: 04_user/001_create_user_trusted_devices.sql
-- ============================================================

-- Normalized final definition for user_trusted_devices.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/007_create_user_trusted_devices.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql

CREATE TABLE IF NOT EXISTS user_trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint VARCHAR(64) NOT NULL,
  device_name VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  trusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  device_type VARCHAR(100),
  os VARCHAR(100),
  browser VARCHAR(100),
  location VARCHAR(255),
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_active
  ON user_trusted_devices(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

-- ============================================================
-- Source: 05_organization/001_create_organizations.sql
-- ============================================================

-- Normalized final definition for organizations.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/001_create_organizations.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
-- - canonical_migrations_draft/18_alerting_workspace/008_harden_organization_creation_indexes.up.sql

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  logo_url TEXT,
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
  owner_user_id UUID NOT NULL REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  status org_status NOT NULL DEFAULT 'trialing',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orgs_status
  ON organizations(status) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_active_owner
  ON organizations(owner_user_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_active_slug
  ON organizations(slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_owner_active
  ON organizations (owner_user_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 05_organization/001_create_organization_alert_thresholds.sql
-- ============================================================

-- Normalized final definition for organization_alert_thresholds.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/011_create_organization_alert_thresholds.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_alert_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID,
  p50_threshold_ms INTEGER NOT NULL DEFAULT 300 CHECK (p50_threshold_ms > 0),
  p75_threshold_ms INTEGER NOT NULL DEFAULT 500 CHECK (p75_threshold_ms > 0),
  p90_threshold_ms INTEGER NOT NULL DEFAULT 800 CHECK (p90_threshold_ms > 0),
  p95_threshold_ms INTEGER NOT NULL DEFAULT 1000 CHECK (p95_threshold_ms > 0),
  p99_threshold_ms INTEGER NOT NULL DEFAULT 2000 CHECK (p99_threshold_ms > 0),
  p50_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  p75_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  p90_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  p95_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  p99_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  error_rate_threshold_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00
  CHECK (error_rate_threshold_percent >= 0 AND error_rate_threshold_percent <= 100),
  error_rate_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  apdex_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.85
  CHECK (apdex_threshold >= 0 AND apdex_threshold <= 1),
  apdex_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  evaluation_window_minutes INTEGER NOT NULL DEFAULT 5 CHECK (evaluation_window_minutes >= 1),
  cooldown_minutes INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_minutes >= 0),
  alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notify_emails TEXT[] NOT NULL DEFAULT '{}',
  last_alerted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_alert_thresholds_scope
  ON organization_alert_thresholds(
    org_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_org_alert_thresholds_org
  ON organization_alert_thresholds(org_id);

-- ============================================================
-- Source: 05_organization/001_create_organization_audit_logs.sql
-- ============================================================

-- Normalized final definition for organization_audit_logs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/006_create_organization_audit_logs.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email VARCHAR(255),
  actor_ip INET,
  actor_user_agent TEXT,
  actor_session_id UUID,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  entity_name VARCHAR(255),
  request_id UUID,
  correlation_id UUID,
  http_method VARCHAR(10),
  endpoint TEXT,
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failure')),
  failure_reason TEXT,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project_id UUID
);

CREATE INDEX IF NOT EXISTS idx_org_audit_org_created
  ON organization_audit_logs(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_audit_project_created
  ON organization_audit_logs(org_id, project_id, created_at DESC, id DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_audit_actor
  ON organization_audit_logs(actor_user_id);

CREATE INDEX IF NOT EXISTS idx_org_audit_entity
  ON organization_audit_logs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_org_audit_action
  ON organization_audit_logs(org_id, action);

CREATE INDEX IF NOT EXISTS idx_org_audit_sensitive
  ON organization_audit_logs(org_id, is_sensitive)
  WHERE is_sensitive = TRUE;

CREATE INDEX IF NOT EXISTS idx_org_audit_metadata_gin
  ON organization_audit_logs USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_org_audit_logs_purge
  ON organization_audit_logs (org_id, is_sensitive, created_at)
  WHERE is_sensitive = FALSE;

-- ============================================================
-- Source: 05_organization/001_create_organization_email_outbox.sql
-- ============================================================

-- Normalized final definition for organization_email_outbox.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/010_create_organization_email_outbox.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID,
  email_type VARCHAR(50) NOT NULL DEFAULT 'generic',
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  dedupe_key VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_org_email_outbox_due
  ON organization_email_outbox(next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_org_email_outbox_org
  ON organization_email_outbox(org_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_email_outbox_dedupe
  ON organization_email_outbox(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status <> 'failed';

-- ============================================================
-- Source: 05_organization/001_create_organization_invitations.sql
-- ============================================================

-- Normalized final definition for organization_invitations.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/004_create_organization_invitations.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES users(id),
  email VARCHAR(255) NOT NULL,
  email_hash VARCHAR(64)
  GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
  role org_role NOT NULL DEFAULT 'member',
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status invitation_status NOT NULL DEFAULT 'pending',
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(id),
  declined_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  resent_count INTEGER NOT NULL DEFAULT 0,
  last_resent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending_lower_email
  ON organization_invitations(org_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_org_invitations_token
  ON organization_invitations(token_hash);

CREATE INDEX IF NOT EXISTS idx_org_invitations_org
  ON organization_invitations(org_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending_email_hash
  ON organization_invitations(org_id, email_hash)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending_token_hash
  ON organization_invitations(token_hash)
  WHERE status = 'pending';

-- ============================================================
-- Source: 05_organization/001_create_organization_members.sql
-- ============================================================

-- Normalized final definition for organization_members.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/003_create_organization_members.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'member',
  status member_status NOT NULL DEFAULT 'invited',
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  joined_method joined_method NOT NULL DEFAULT 'invite',
  last_active_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  deactivated_by UUID REFERENCES users(id),
  deactivation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org
  ON organization_members(org_id, status);

CREATE INDEX IF NOT EXISTS idx_org_members_user
  ON organization_members(user_id, status);

CREATE INDEX IF NOT EXISTS idx_org_members_role
  ON organization_members(org_id, role)
  WHERE status = 'active';

-- ============================================================
-- Source: 05_organization/001_create_organization_scim_tokens.sql
-- ============================================================

-- Normalized final definition for organization_scim_tokens.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/002_create_organization_scim_tokens.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/009_extend_organization_scim_tokens_for_rotation.up.sql

CREATE TABLE IF NOT EXISTS organization_scim_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_from UUID REFERENCES organization_scim_tokens(id),
  rotated_at TIMESTAMPTZ,
  grace_period_ends_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scim_tokens_org_token_active
  ON organization_scim_tokens(org_id, token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scim_tokens_rotated_from
  ON organization_scim_tokens(rotated_from)
  WHERE rotated_from IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scim_tokens_grace_window
  ON organization_scim_tokens(grace_period_ends_at)
  WHERE grace_period_ends_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scim_tokens_active_hash
  ON organization_scim_tokens(token_hash)
  WHERE revoked_at IS NULL;

-- ============================================================
-- Source: 05_organization/001_create_organization_scim_token_ips.sql
-- ============================================================

-- Normalized final definition for organization_scim_token_ips.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/005_create_organization_scim_token_ips.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_scim_token_ips (
  token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
  ip_cidr CIDR NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (token_id, ip_cidr)
);

CREATE INDEX IF NOT EXISTS idx_scim_token_ips_token
  ON organization_scim_token_ips(token_id);

-- ============================================================
-- Source: 05_organization/001_create_organization_scim_token_scopes.sql
-- ============================================================

-- Normalized final definition for organization_scim_token_scopes.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/004_create_organization_scim_token_scopes.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_scim_token_scopes (
  token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
  scope VARCHAR(50) NOT NULL CHECK (scope IN (
  'users:read', 'users:write', 'users:delete',
  'groups:read', 'groups:write', 'groups:delete',
  'bulk'
  )),
  PRIMARY KEY (token_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_scim_token_scopes_scope
  ON organization_scim_token_scopes(scope);

-- ============================================================
-- Source: 05_organization/001_create_organization_security_events.sql
-- ============================================================

-- Normalized final definition for organization_security_events.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/009_create_organization_security_events.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  event_type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_security_events_org
  ON organization_security_events(org_id, created_at DESC);

-- ============================================================
-- Source: 05_organization/001_create_organization_settings.sql
-- ============================================================

-- Normalized final definition for organization_settings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/002_create_organization_settings.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_settings (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enforce_sso BOOLEAN NOT NULL DEFAULT FALSE,
  enforce_mfa BOOLEAN NOT NULL DEFAULT FALSE,
  session_timeout_minutes INTEGER NOT NULL DEFAULT 480 CHECK (session_timeout_minutes >= 5),
  mfa_allowed_methods TEXT[] NOT NULL DEFAULT ARRAY['totp', 'email', 'hardware_key', 'backup_codes'],
  mfa_primary_method_preference VARCHAR(50),
  mfa_backup_codes_required BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_grace_period_days INTEGER NOT NULL DEFAULT 7
  CHECK (mfa_grace_period_days >= 0 AND mfa_grace_period_days <= 365),
  mfa_max_devices_per_user INTEGER NOT NULL DEFAULT 10
  CHECK (mfa_max_devices_per_user >= 1 AND mfa_max_devices_per_user <= 50),
  mfa_allow_sms_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_allow_email_fallback BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_remember_device_days INTEGER NOT NULL DEFAULT 30
  CHECK (mfa_remember_device_days >= 0 AND mfa_remember_device_days <= 365),
  data_region VARCHAR(50) NOT NULL DEFAULT 'us-east-1',
  data_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (data_retention_days >= 1),
  audit_log_retention_days INTEGER NOT NULL DEFAULT 365 CHECK (audit_log_retention_days >= 30),
  allow_public_projects BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 05_organization/001_create_organization_sso_providers.sql
-- ============================================================

-- Normalized final definition for organization_sso_providers.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/001_create_organization_sso_providers.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  entity_id TEXT,
  sso_url TEXT,
  x509_certificate TEXT,
  domain VARCHAR(255),
  oidc_issuer TEXT,
  oidc_client_id TEXT,
  oidc_client_secret_encrypted TEXT,
  oidc_scopes TEXT,
  oidc_jit_provision BOOLEAN NOT NULL DEFAULT FALSE,
  oidc_jit_default_role VARCHAR(50) NOT NULL DEFAULT 'member',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_providers_org
  ON organization_sso_providers(org_id);

CREATE INDEX IF NOT EXISTS idx_sso_providers_active_entity_id
  ON organization_sso_providers(entity_id)
  WHERE is_active = TRUE AND provider_type = 'saml' AND entity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sso_providers_active_domain_type
  ON organization_sso_providers(provider_type, LOWER(domain))
  WHERE is_active = TRUE AND domain IS NOT NULL;

-- ============================================================
-- Source: 05_organization/001_create_organization_verified_domains.sql
-- ============================================================

-- Normalized final definition for organization_verified_domains.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/0012_create_organizations_domains.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_verified_domains
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  domain VARCHAR(255) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  auto_join_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  verification_method VARCHAR(30)
  CHECK
  (
  verification_method IN
  (
  'dns_txt',
  'dns_cname',
  'html_file',
  'manual'
  )
  ),
  verification_token VARCHAR(255),
  verification_started_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  last_verification_check_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_domain_lowercase
  CHECK (domain = lower(domain))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_verified_domain
ON organization_verified_domains(domain)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_primary_domain
ON organization_verified_domains(organization_id)
WHERE is_primary = TRUE
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_org
ON organization_verified_domains(organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_verified
ON organization_verified_domains(is_verified)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_auto_join
ON organization_verified_domains(auto_join_enabled)
WHERE auto_join_enabled = TRUE
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_verification_check
ON organization_verified_domains(last_verification_check_at)
WHERE is_verified = FALSE
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_metadata
ON organization_verified_domains
USING GIN(metadata);

-- ============================================================
-- Source: 05_organization/001_create_quota_requests.sql
-- ============================================================

-- Normalized final definition for quota_requests.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/005_create_quota_requests.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS quota_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quota_type VARCHAR(50) NOT NULL,
  current_limit BIGINT NOT NULL CHECK (current_limit >= 0),
  requested_limit BIGINT NOT NULL CHECK (requested_limit > current_limit),
  reason TEXT NOT NULL,
  status quota_request_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quota_requests_org
  ON quota_requests(org_id, created_at DESC);

-- ============================================================
-- Source: 05_organization/001_create_saml_sessions.sql
-- ============================================================

-- Normalized final definition for saml_sessions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/008_create_saml_sessions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS saml_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES organization_sso_providers(id) ON DELETE CASCADE,
  saml_name_id VARCHAR(512) NOT NULL,
  saml_name_id_format VARCHAR(100),
  saml_session_index VARCHAR(255),
  issuer VARCHAR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_lookup
  ON saml_sessions(provider_id, saml_name_id);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_session
  ON saml_sessions(session_id);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_expiry
  ON saml_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_provider_session_index
  ON saml_sessions(provider_id, saml_session_index)
  WHERE saml_session_index IS NOT NULL;

-- ============================================================
-- Source: 05_organization/001_create_scim_groups.sql
-- ============================================================

-- Normalized final definition for scim_groups.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/006_create_scim_groups.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS scim_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  meta_version INTEGER NOT NULL DEFAULT 1,
  meta_created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta_last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (org_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_groups_org
  ON scim_groups(org_id);

CREATE INDEX IF NOT EXISTS idx_scim_groups_org_external
  ON scim_groups(org_id, external_id);

CREATE INDEX IF NOT EXISTS idx_scim_groups_org_display_name
  ON scim_groups(org_id, display_name);

-- ============================================================
-- Source: 05_organization/001_create_scim_group_memberships.sql
-- ============================================================

-- Normalized final definition for scim_group_memberships.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/007_create_scim_group_memberships.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS scim_group_memberships (
  group_id UUID NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_user
  ON scim_group_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_org
  ON scim_group_memberships(org_id);

CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_group
  ON scim_group_memberships(group_id);

-- ============================================================
-- Source: 05_organization/001_create_scim_user_mappings.sql
-- ============================================================

-- Normalized final definition for scim_user_mappings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/003_create_scim_user_mappings.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS scim_user_mappings (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, external_id),
  CONSTRAINT scim_user_mappings_org_user_unique UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_user_mappings_user
  ON scim_user_mappings(user_id);

-- ============================================================
-- Source: 06_project/001_create_projects.sql
-- ============================================================

-- Normalized final definition for projects.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/001_create_projects.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/007_create_project_environments.up.sql
-- - canonical_migrations_draft/04_projects/022_add_project_public_id.sql
-- - migrations/003_project_module_refactor.sql
-- - canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  description TEXT,
  status project_status NOT NULL DEFAULT 'active',
  icon VARCHAR(255),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  public_id TEXT NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_org
  ON projects(org_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_status
  ON projects(status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_cursor
  ON projects(org_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_archived
  ON projects(archived_at)
  WHERE archived_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_org_status
  ON projects(org_id, status)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_id_org
  ON projects(id, org_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_active_slug
  ON projects(org_id, lower(slug)) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_public_id ON projects (public_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_org_slug_active
  ON projects(org_id, slug)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 06_project/001_create_project_environments.sql
-- ============================================================

-- Normalized final definition for project_environments.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/007_create_project_environments.up.sql
-- - migrations/003_project_module_refactor.sql
-- - canonical_migrations_draft/04_projects/016_add_environment_runtime_configuration.up.sql
-- - canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql

CREATE TABLE IF NOT EXISTS project_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  color VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  type project_environment_type NOT NULL,
  UNIQUE (project_id, slug),
  UNIQUE (project_id, name)
);

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

CREATE INDEX IF NOT EXISTS idx_project_environments_project
  ON project_environments(project_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_environments_default
  ON project_environments(project_id)
  WHERE is_default = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_environments_active
  ON project_environments(project_id, is_active)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 06_project/001_create_project_api_keys.sql
-- ============================================================

-- Normalized final definition for project_api_keys.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/005_create_project_api_keys.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/009_converge_project_api_keys.up.sql
-- - canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
-- - canonical_migrations_draft/04_projects/018_normalize_project_api_keys_and_usage.up.sql
-- - canonical_migrations_draft/04_projects/024_update_api_key_public_prefix_constraint.up.sql
-- - migrations/003_project_module_refactor.sql

CREATE TABLE IF NOT EXISTS project_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  status api_key_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  revoked_by UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  public_key VARCHAR(64) NOT NULL UNIQUE,
  secret_hash TEXT,
  key_type api_key_type NOT NULL DEFAULT 'read_write',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rotated_from_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
  rotated_at TIMESTAMPTZ,
  rotated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rotation_reason TEXT,
  rotation_state api_key_rotation_state NOT NULL DEFAULT 'none',
  rotation_version INTEGER NOT NULL DEFAULT 1,
  grace_period_ends_at TIMESTAMPTZ,
  revoked_reason TEXT,
  auto_rotate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_rotate_days INTEGER,
  last_used_ip INET,
  usage_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  rate_limit_per_second INTEGER NOT NULL DEFAULT 0,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 0,
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 0,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_endpoints TEXT[] NOT NULL DEFAULT '{}',
  blocked_endpoints TEXT[] NOT NULL DEFAULT '{}',
  allowed_sdks TEXT[] NOT NULL DEFAULT '{}',
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  allowed_ips INET[] NOT NULL DEFAULT '{}',
  allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  allowed_event_types TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  sampling_rules JSONB NOT NULL DEFAULT '{}',
  feature_flags JSONB NOT NULL DEFAULT '{}',
  sdk_config JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_api_keys_project
  ON project_api_keys(project_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_org
  ON project_api_keys(organization_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_status
  ON project_api_keys(status);

CREATE INDEX IF NOT EXISTS idx_api_keys_expiry
  ON project_api_keys(expires_at);

CREATE INDEX IF NOT EXISTS idx_api_keys_last_used
  ON project_api_keys(last_used_at);

CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_cleanup
  ON project_api_keys(revoked_at, deleted_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_api_keys_tenant_env ON project_api_keys(organization_id, project_id, environment_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_api_keys_lifecycle ON project_api_keys(status, expires_at, grace_period_ends_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_env
  ON project_api_keys(environment_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_rotation
  ON project_api_keys(rotated_from_key_id)
  WHERE rotated_from_key_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_api_keys_env_active
  ON project_api_keys (project_id, environment_id, status)
  WHERE deleted_at IS NULL;

-- High-performance covering index for gateway authentication lookup
CREATE INDEX IF NOT EXISTS idx_project_api_keys_auth_covering
  ON project_api_keys (public_key)
  INCLUDE (id, project_id, organization_id, environment_id, status, expires_at, secret_hash)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 06_project/001_create_api_key_usage_daily.sql
-- ============================================================

-- Physical retained fact for billing and long-range API-key usage.

CREATE TABLE IF NOT EXISTS api_key_usage_daily (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  event_type_id SMALLINT NOT NULL REFERENCES telemetry_event_types(id),
  request_count BIGINT NOT NULL DEFAULT 0,
  accepted_event_count BIGINT NOT NULL DEFAULT 0,
  error_event_count BIGINT NOT NULL DEFAULT 0,
  ingestion_failure_count BIGINT NOT NULL DEFAULT 0,
  accepted_bytes BIGINT NOT NULL DEFAULT 0,
  rate_limited_request_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, bucket, event_type_id)
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_daily_project
  ON api_key_usage_daily(project_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_daily_org
  ON api_key_usage_daily(organization_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_daily_env
  ON api_key_usage_daily(environment_id, bucket DESC)
  WHERE environment_id IS NOT NULL;

-- ============================================================
-- Source: 06_project/001_create_api_key_usage_minute.sql
-- ============================================================

-- Normalized final definition for per-key minute usage.

CREATE TABLE IF NOT EXISTS api_key_usage_minute (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  event_type_id SMALLINT NOT NULL REFERENCES telemetry_event_types(id),
  request_count BIGINT NOT NULL DEFAULT 0,
  accepted_event_count BIGINT NOT NULL DEFAULT 0,
  error_event_count BIGINT NOT NULL DEFAULT 0,
  ingestion_failure_count BIGINT NOT NULL DEFAULT 0,
  accepted_bytes BIGINT NOT NULL DEFAULT 0,
  rate_limited_request_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, bucket, event_type_id)
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_minute_project
  ON api_key_usage_minute(project_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_minute_env
  ON api_key_usage_minute(environment_id, bucket DESC)
  WHERE environment_id IS NOT NULL;

-- ============================================================
-- Source: 06_project/001_create_project_api_key_rotations.sql
-- ============================================================

-- Normalized final definition for project_api_key_rotations.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/018_normalize_project_api_keys_and_usage.up.sql

CREATE TABLE IF NOT EXISTS project_api_key_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE RESTRICT,
  old_key_id UUID NOT NULL,
  new_key_id UUID,
  state api_key_rotation_state NOT NULL DEFAULT 'rotating',
  reason TEXT,
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grace_ends_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT project_api_key_rotations_distinct_keys CHECK (new_key_id IS NULL OR new_key_id <> old_key_id),
  CONSTRAINT project_api_key_rotations_state_check CHECK (
  state <> 'none'
  AND (state <> 'grace_period' OR grace_ends_at IS NOT NULL)
  AND (state <> 'completed' OR completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_tenant_time
  ON project_api_key_rotations(organization_id,project_id,environment_id,initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_old_key
  ON project_api_key_rotations(old_key_id,initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_grace_lookup
  ON project_api_key_rotations(old_key_id,grace_ends_at DESC)
  WHERE state = 'grace_period' AND grace_ends_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_new_key
  ON project_api_key_rotations(new_key_id) WHERE new_key_id IS NOT NULL;

-- ============================================================
-- Source: 06_project/001_create_project_environment_sdk_configs.sql
-- ============================================================

-- Normalized final definition for project_environment_sdk_configs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql

CREATE TABLE IF NOT EXISTS project_environment_sdk_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  published_revision_id UUID NOT NULL,
  current_revision INTEGER NOT NULL,
  current_hash CHAR(64) NOT NULL,
  schema_version VARCHAR(50) NOT NULL DEFAULT '1',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT project_environment_sdk_configs_revision_check CHECK (current_revision > 0),
  CONSTRAINT project_environment_sdk_configs_hash_check CHECK (current_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(environment_id),
  UNIQUE(id, environment_id, project_id, organization_id),
  FOREIGN KEY(project_id, organization_id) REFERENCES projects(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY(environment_id, project_id, organization_id)
  REFERENCES project_environments(id, project_id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_environment_sdk_configs_project
  ON project_environment_sdk_configs(organization_id, project_id, environment_id);

-- ============================================================
-- Source: 06_project/001_create_project_environment_sdk_config_revisions.sql
-- ============================================================

-- Normalized final definition for project_environment_sdk_config_revisions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
-- - canonical_migrations_draft/04_projects/019_upgrade_environment_sdk_config_snapshot.up.sql
-- - canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
-- - canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql

CREATE TABLE IF NOT EXISTS project_environment_sdk_config_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES project_environment_sdk_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  requested_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  compiled_snapshot JSONB NOT NULL,
  config_hash CHAR(64) NOT NULL,
  schema_version VARCHAR(50) NOT NULL DEFAULT '1',
  change_type VARCHAR(20) NOT NULL DEFAULT 'publish',
  change_summary TEXT,
  rolled_back_to_revision INTEGER,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_environment_sdk_revisions_number_check CHECK (revision_number > 0),
  CONSTRAINT project_environment_sdk_revisions_hash_check CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sdk_revisions_requested_config_object CHECK (jsonb_typeof(requested_config) = 'object'),
  CONSTRAINT sdk_revisions_compiled_snapshot_object CHECK (jsonb_typeof(compiled_snapshot) = 'object'),
  CONSTRAINT project_environment_sdk_revisions_change_type_check
  CHECK (change_type IN ('initial','publish','rollback')),
  CONSTRAINT project_environment_sdk_revisions_rollback_check CHECK (
  (change_type = 'rollback' AND rolled_back_to_revision IS NOT NULL)
  OR (change_type <> 'rollback' AND rolled_back_to_revision IS NULL)
  ),
  UNIQUE(config_id, revision_number),
  UNIQUE(id, config_id),
  FOREIGN KEY(config_id, environment_id, project_id, organization_id)
  REFERENCES project_environment_sdk_configs(id, environment_id, project_id, organization_id)
  ON DELETE CASCADE,
  FOREIGN KEY(project_id, organization_id) REFERENCES projects(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY(environment_id, project_id, organization_id)
  REFERENCES project_environments(id, project_id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_environment_sdk_revisions_history
  ON project_environment_sdk_config_revisions(config_id, revision_number DESC);

-- ============================================================
-- Source: 06_project/001_create_project_member_invitations.sql
-- ============================================================

-- Normalized final definition for project_member_invitations.
-- Canonical/historical sources include:
-- - migrations/003_project_module_refactor.sql

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

-- ============================================================
-- Source: 06_project/001_create_project_member_notification_preferences.sql
-- ============================================================

-- Normalized final definition for project_member_notification_preferences.
-- Canonical/historical sources include:
-- - migrations/003_project_module_refactor.sql

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

-- ============================================================
-- Source: 06_project/001_create_project_roles.sql
-- ============================================================

-- Normalized final definition for project_roles.
-- Canonical/historical sources include:
-- - migrations/003_project_module_refactor.sql

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

-- ============================================================
-- Source: 06_project/001_create_project_members.sql
-- ============================================================

-- Normalized final definition for project_members.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/002_create_project_members.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/008_converge_project_members.up.sql
-- - migrations/003_project_module_refactor.sql

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role project_member_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  status project_member_status NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  removed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  role_id UUID REFERENCES project_roles(id) ON DELETE SET NULL,
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user
  ON project_members(user_id);

CREATE INDEX IF NOT EXISTS idx_project_members_org_user
  ON project_members(organization_id, user_id);

CREATE INDEX IF NOT EXISTS idx_project_members_role
  ON project_members(project_id, role);

CREATE INDEX IF NOT EXISTS idx_project_members_status
  ON project_members(status);

CREATE INDEX IF NOT EXISTS idx_project_members_active
  ON project_members(project_id, user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_project_members_project_status
  ON project_members(project_id, status);

-- ============================================================
-- Source: 06_project/001_create_project_notification_preferences.sql
-- ============================================================

-- Normalized final definition for project_notification_preferences.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
-- - migrations/003_project_module_refactor.sql

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
  default_channel_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  default_member_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  role_targets project_member_role[] NOT NULL DEFAULT ARRAY['owner','admin']::project_member_role[],
  escalation_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (project_id, category)
);

CREATE INDEX IF NOT EXISTS idx_project_notification_preferences_enabled
  ON project_notification_preferences(organization_id,project_id,enabled) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_notif_prefs_project
  ON project_notification_preferences(project_id);

-- ============================================================
-- Source: 06_project/001_create_project_releases.sql
-- ============================================================

-- Normalized final definition for project_releases.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/003_create_project_releases.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/007_create_project_environments.up.sql

CREATE TABLE IF NOT EXISTS project_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version VARCHAR(100) NOT NULL,
  commit_sha VARCHAR(64),
  branch VARCHAR(150),
  released_by UUID REFERENCES users(id),
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_releases_version
  ON project_releases(project_id, version);

CREATE INDEX IF NOT EXISTS idx_project_releases_time
  ON project_releases(project_id, released_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_releases_commit
  ON project_releases(commit_sha)
  WHERE commit_sha IS NOT NULL;

-- ============================================================
-- Source: 06_project/001_create_project_settings.sql
-- ============================================================

-- Normalized final definition for project_settings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/004_create_project_settings.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/007_create_project_environments.up.sql

CREATE TABLE IF NOT EXISTS project_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_retention_days INTEGER NOT NULL DEFAULT 10,
  sampling_rate NUMERIC(6,5) NOT NULL DEFAULT 1.00000,
  allowed_domains TEXT[] NOT NULL DEFAULT '{}'::text[],
  blocked_domains TEXT[] NOT NULL DEFAULT '{}'::text[],
  pii_scrubbing_enabled BOOLEAN NOT NULL DEFAULT true,
  ip_collection_enabled BOOLEAN NOT NULL DEFAULT true,
  release_tracking_enabled BOOLEAN NOT NULL DEFAULT true,
  session_replay_enabled BOOLEAN NOT NULL DEFAULT false,
  performance_monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
  error_monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
  log_ingestion_enabled BOOLEAN NOT NULL DEFAULT true,
  metric_ingestion_enabled BOOLEAN NOT NULL DEFAULT true,
  trace_ingestion_enabled BOOLEAN NOT NULL DEFAULT true,
  profile_ingestion_enabled BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_project_settings_org
  ON project_settings(organization_id);

-- ============================================================
-- Source: 06_project/001_create_project_usage.sql
-- ============================================================

-- Normalized final definition for project_usage.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS project_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID NOT NULL,
  counter_type VARCHAR(64) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE (project_id, counter_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_lookup
  ON project_usage(project_id, counter_type, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_project_usage_org
  ON project_usage(org_id, period_start DESC);

-- ============================================================
-- Source: 06_project/001_create_project_usage_daily.sql
-- ============================================================

-- Normalized final definition for project_usage_daily.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - migrations/003_project_module_refactor.sql

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
  id BIGSERIAL PRIMARY KEY,
  bucket_date DATE NOT NULL,
  total_bytes BIGINT DEFAULT 0,
  category_counts JSONB DEFAULT '{}',
  event_type_counts JSONB DEFAULT '{}',
  peak_events_per_hour INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_project_date
  ON project_usage_daily(project_id, bucket_date DESC);

CREATE INDEX IF NOT EXISTS idx_usage_daily_org_date
  ON project_usage_daily(organization_id, bucket_date DESC);

CREATE INDEX IF NOT EXISTS idx_project_usage_daily_project_bucket
  ON project_usage_daily(project_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_project_usage_daily_org_bucket
  ON project_usage_daily(organization_id, bucket DESC);

-- ============================================================
-- Source: 06_project/001_create_project_usage_hourly.sql
-- ============================================================

-- Normalized final definition for project_usage_hourly.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - migrations/003_project_module_refactor.sql

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
  id BIGSERIAL,
  bucket_hour TIMESTAMPTZ NOT NULL,
  event_count BIGINT NOT NULL DEFAULT 0,
  event_bytes BIGINT NOT NULL DEFAULT 0,
  category_counts JSONB DEFAULT '{}',
  event_type_counts JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, bucket)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_hourly_project_bucket
  ON project_usage_hourly(project_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_project_usage_hourly_org_bucket
  ON project_usage_hourly(organization_id, bucket DESC);

-- ============================================================
-- Source: 06_project/001_create_project_usage_minute.sql
-- ============================================================

-- Normalized final definition for project_usage_minute.
-- Canonical/historical sources include:
-- - migrations/003_project_module_refactor.sql

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

CREATE INDEX IF NOT EXISTS idx_project_usage_minute_project_bucket
  ON project_usage_minute(project_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_project_usage_minute_org_bucket
  ON project_usage_minute(organization_id, bucket DESC);

-- ============================================================
-- Source: 06_project/001_create_project_usage_monthly.sql
-- ============================================================

-- Normalized final definition for project_usage_monthly.
-- Canonical/historical sources include:
-- - migrations/003_project_module_refactor.sql

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

-- ============================================================
-- Source: 06_project/002_fix_project_members_invitation_columns.sql
-- ============================================================

-- Repair project_members for draft databases created before invitation audit
-- columns were folded into the normalized table definition.
-- Required by project member invitation flows and ProjectService.ensureProjectOwner,
-- which sets invited_by, invited_at, and joined_at when creating owner memberships.


ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS invited_by UUID,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT NOW();

UPDATE project_members
SET
  invited_by = COALESCE(invited_by, added_by_user_id),
  invited_at = COALESCE(invited_at, added_at),
  joined_at = COALESCE(joined_at, added_at, created_at, NOW())
WHERE invited_by IS NULL
   OR invited_at IS NULL
   OR joined_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'project_members'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (invited_by)%'
  ) THEN
    ALTER TABLE project_members
      ADD CONSTRAINT fk_project_members_invited_by
      FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- Source: 06_project/003_fix_project_defaults_provisioning_function.sql
-- ============================================================

-- Repair stale project provisioning trigger functions that inserted only
-- project_id and organization_id into project_settings.
--
-- project_settings has NOT NULL defaults; the trigger must provide explicit
-- defaults so older live databases do not fail before application-level
-- provisioning can continue.

ALTER TABLE project_settings
  ALTER COLUMN data_retention_days SET DEFAULT 10,
  ALTER COLUMN sampling_rate SET DEFAULT 1.00000,
  ALTER COLUMN allowed_domains SET DEFAULT '{}'::text[],
  ALTER COLUMN blocked_domains SET DEFAULT '{}'::text[],
  ALTER COLUMN pii_scrubbing_enabled SET DEFAULT true,
  ALTER COLUMN ip_collection_enabled SET DEFAULT true,
  ALTER COLUMN release_tracking_enabled SET DEFAULT true,
  ALTER COLUMN session_replay_enabled SET DEFAULT false,
  ALTER COLUMN performance_monitoring_enabled SET DEFAULT true,
  ALTER COLUMN error_monitoring_enabled SET DEFAULT true,
  ALTER COLUMN log_ingestion_enabled SET DEFAULT true,
  ALTER COLUMN metric_ingestion_enabled SET DEFAULT true,
  ALTER COLUMN trace_ingestion_enabled SET DEFAULT true,
  ALTER COLUMN profile_ingestion_enabled SET DEFAULT true,
  ALTER COLUMN version SET DEFAULT 1;

UPDATE project_settings
SET
  data_retention_days = COALESCE(data_retention_days, 10),
  sampling_rate = COALESCE(sampling_rate, 1.00000),
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
  version = COALESCE(version, 1)
WHERE data_retention_days IS NULL
   OR sampling_rate IS NULL
   OR allowed_domains IS NULL
   OR blocked_domains IS NULL
   OR pii_scrubbing_enabled IS NULL
   OR ip_collection_enabled IS NULL
   OR release_tracking_enabled IS NULL
   OR session_replay_enabled IS NULL
   OR performance_monitoring_enabled IS NULL
   OR error_monitoring_enabled IS NULL
   OR log_ingestion_enabled IS NULL
   OR metric_ingestion_enabled IS NULL
   OR trace_ingestion_enabled IS NULL
   OR profile_ingestion_enabled IS NULL
   OR version IS NULL;

-- Project defaults are provisioned explicitly in application-level transactions
-- (ProjectService.createProject). Clean up any legacy database triggers or functions.
DROP TRIGGER IF EXISTS trg_projects_provision_defaults ON projects;
DROP FUNCTION IF EXISTS provision_project_schema_defaults();

-- ============================================================
-- Source: 06_project/004_repair_api_key_usage_rollups.sql
-- ============================================================

-- Idempotent repair for databases that were created before normalized
-- API-key usage facts and monthly/hourly views existed.

DO $$
DECLARE
  all_event_type_id SMALLINT;
BEGIN
  SELECT id INTO all_event_type_id FROM telemetry_event_types WHERE name = '__all__';

  IF to_regclass('public.api_key_usage_minute') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'requests'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'request_count'
    ) THEN
      ALTER TABLE api_key_usage_minute RENAME COLUMN requests TO request_count;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'events'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'accepted_event_count'
    ) THEN
      ALTER TABLE api_key_usage_minute RENAME COLUMN events TO accepted_event_count;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'errors'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'error_event_count'
    ) THEN
      ALTER TABLE api_key_usage_minute RENAME COLUMN errors TO error_event_count;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'rate_limited'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'rate_limited_request_count'
    ) THEN
      ALTER TABLE api_key_usage_minute RENAME COLUMN rate_limited TO rate_limited_request_count;
    END IF;

    ALTER TABLE api_key_usage_minute
      ADD COLUMN IF NOT EXISTS event_type_id SMALLINT,
      ADD COLUMN IF NOT EXISTS request_count BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS accepted_event_count BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS error_event_count BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ingestion_failure_count BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS accepted_bytes BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rate_limited_request_count BIGINT NOT NULL DEFAULT 0;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'bytes_ingested'
    ) THEN
      UPDATE api_key_usage_minute
         SET accepted_bytes = COALESCE(accepted_bytes, bytes_ingested, 0);
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'event_type'
    ) THEN
      INSERT INTO telemetry_event_types(name)
      SELECT DISTINCT event_type
        FROM api_key_usage_minute
       WHERE event_type IS NOT NULL
      ON CONFLICT (name) DO NOTHING;

      UPDATE api_key_usage_minute m
         SET event_type_id = t.id
        FROM telemetry_event_types t
       WHERE t.name = m.event_type
         AND m.event_type_id IS NULL;
    END IF;

    UPDATE api_key_usage_minute
       SET event_type_id = all_event_type_id
     WHERE event_type_id IS NULL;

    ALTER TABLE api_key_usage_minute
      ALTER COLUMN event_type_id SET NOT NULL,
      ALTER COLUMN request_count SET NOT NULL,
      ALTER COLUMN accepted_event_count SET NOT NULL,
      ALTER COLUMN error_event_count SET NOT NULL,
      ALTER COLUMN ingestion_failure_count SET NOT NULL,
      ALTER COLUMN accepted_bytes SET NOT NULL,
      ALTER COLUMN rate_limited_request_count SET NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS api_key_usage_daily (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  event_type_id SMALLINT NOT NULL REFERENCES telemetry_event_types(id),
  request_count BIGINT NOT NULL DEFAULT 0,
  accepted_event_count BIGINT NOT NULL DEFAULT 0,
  error_event_count BIGINT NOT NULL DEFAULT 0,
  ingestion_failure_count BIGINT NOT NULL DEFAULT 0,
  accepted_bytes BIGINT NOT NULL DEFAULT 0,
  rate_limited_request_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, bucket, event_type_id)
);

INSERT INTO api_key_usage_daily (
  api_key_id, project_id, organization_id, environment_id, bucket, event_type_id,
  request_count, accepted_event_count, error_event_count, ingestion_failure_count,
  accepted_bytes, rate_limited_request_count
)
SELECT
  api_key_id,
  project_id,
  organization_id,
  environment_id,
  date_trunc('day', bucket),
  event_type_id,
  SUM(request_count)::bigint,
  SUM(accepted_event_count)::bigint,
  SUM(error_event_count)::bigint,
  SUM(ingestion_failure_count)::bigint,
  SUM(accepted_bytes)::bigint,
  SUM(rate_limited_request_count)::bigint
FROM api_key_usage_minute
GROUP BY api_key_id, project_id, organization_id, environment_id, date_trunc('day', bucket), event_type_id
ON CONFLICT (api_key_id, bucket, event_type_id) DO NOTHING;

-- ============================================================
-- Source: 07_billing/001_create_billing_features.sql
-- ============================================================

-- Normalized final definition for billing_features.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/004_billing_features.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/006_organization_subscriptions.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS billing_features
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key        VARCHAR(100) NOT NULL,
  feature_name       VARCHAR(150) NOT NULL,
  description        TEXT,
  category           billing_feature_category NOT NULL,
  value_type         billing_feature_value_type NOT NULL,
  is_billable        BOOLEAN NOT NULL DEFAULT TRUE,
  is_public          BOOLEAN NOT NULL DEFAULT TRUE,
  is_deprecated      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ,
  module VARCHAR(50),
  is_module_root BOOLEAN NOT NULL DEFAULT FALSE,
  usage_behavior billing_usage_behavior NOT NULL DEFAULT 'none',
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility billing_visibility NOT NULL DEFAULT 'public',
  CONSTRAINT uq_billing_feature_key UNIQUE(feature_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_features_category
ON billing_features(category)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_features_public
ON billing_features(is_public, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_features_billable
ON billing_features(is_billable)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_feature_public ON billing_features(category, sort_order) WHERE is_public = TRUE;

-- ============================================================
-- Source: 07_billing/001_create_addons.sql
-- ============================================================

-- Normalized final definition for addons.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/addons.sql

CREATE TABLE IF NOT EXISTS addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(20) NOT NULL             
  CHECK (category IN ('module','capacity','enterprise_feature')),
  target_module VARCHAR(50),
  target_feature_id UUID REFERENCES billing_features(id),
  available_in_tiers billing_plan_tier[] NOT NULL DEFAULT '{}',
  not_available_in_tiers billing_plan_tier[] NOT NULL DEFAULT '{enterprise}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 07_billing/001_create_addon_prices.sql
-- ============================================================

-- Normalized final definition for addon_prices.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/addons_prices.sql

CREATE TABLE IF NOT EXISTS addon_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  provider billing_provider_type NOT NULL DEFAULT 'system',
  billing_interval billing_interval_type NOT NULL DEFAULT 'monthly',
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  provider_price_id VARCHAR(150),
  pricing_model VARCHAR(20) NOT NULL DEFAULT 'flat'
  CHECK (pricing_model IN ('flat','per_unit','tiered')),
  unit_quantity INTEGER,
  unit_label VARCHAR(50),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_addon_price UNIQUE (addon_id, provider, billing_interval, currency, starts_at)
);

-- ============================================================
-- Source: 07_billing/001_create_ai_usage_logs.sql
-- ============================================================

-- Normalized final definition for ai_usage_logs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/012_ai_usage_logs.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ai_usage_logs
(
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  project_id UUID
  REFERENCES projects(id)
  ON DELETE SET NULL,
  user_id UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  feature_key VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS
  (prompt_tokens + completion_tokens) STORED,
  estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0
  CHECK (estimated_cost_usd >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'success'
  CHECK (status IN ('success','failed','timeout','cancelled')),
  request_id UUID,
  trace_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

-- ============================================================
-- Source: 07_billing/001_create_ai_usage_logs_2026_07.sql
-- ============================================================

-- Normalized final definition for ai_usage_logs_2026_07.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/012_ai_usage_logs.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ai_usage_logs_2026_07
PARTITION OF ai_usage_logs
FOR VALUES FROM (
  '2026-07-01'
) TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS brin_ai_usage_2026_07_time
ON ai_usage_logs_2026_07
USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS gin_ai_usage_2026_07_metadata
ON ai_usage_logs_2026_07
USING GIN (metadata);

-- ============================================================
-- Source: 07_billing/001_create_coupons.sql
-- ============================================================

-- Normalized final definition for coupons.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/016_coupons.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql

CREATE TABLE IF NOT EXISTS coupons
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  discount_type billing_coupon_discount_type NOT NULL,
  discount_value NUMERIC(12,2) NOT NULL
  CHECK (discount_value > 0),
  currency CHAR(3),
  max_redemptions INTEGER
  CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemption_count INTEGER NOT NULL DEFAULT 0
  CHECK (redemption_count >= 0),
  max_redemptions_per_org INTEGER NOT NULL DEFAULT 1
  CHECK (max_redemptions_per_org > 0),
  first_time_customers_only BOOLEAN NOT NULL DEFAULT FALSE,
  trial_only BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_coupon_code UNIQUE(code),
  CONSTRAINT chk_coupon_window
  CHECK(valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT chk_percentage_value
  CHECK (
  discount_type <> 'percentage'
  OR (discount_value > 0 AND discount_value <= 100)
  )
);

CREATE INDEX IF NOT EXISTS idx_coupons_active
ON coupons(is_active, valid_until)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_public
ON coupons(is_public)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_validity
ON coupons(valid_from, valid_until)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coupons_redemptions
ON coupons(redemption_count);

CREATE INDEX IF NOT EXISTS gin_coupons_metadata
ON coupons
USING GIN(metadata);

-- ============================================================
-- Source: 07_billing/001_create_plans.sql
-- ============================================================

-- Normalized final definition for plans.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/002_plans.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(100) NOT NULL,
  tier billing_plan_tier NOT NULL,
  description TEXT,
  trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  is_customizable BOOLEAN NOT NULL DEFAULT FALSE,
  next_plan_key VARCHAR(50),
  previous_plan_key VARCHAR(50),
  badge VARCHAR(50),
  CONSTRAINT uq_plans_key_version UNIQUE (key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_active_key
  ON plans (key)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_active_public
  ON plans (sort_order, tier, key)
  WHERE is_active = TRUE AND is_public = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_tier_active
  ON plans (tier, version DESC)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_key_version
  ON plans (key, version DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_public_sort
  ON plans (is_public, sort_order)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(sort_order) WHERE deleted_at IS NULL AND is_active = TRUE;

-- ============================================================
-- Source: 07_billing/001_create_organization_subscriptions.sql
-- ============================================================

-- Normalized final definition for organization_subscriptions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/006_organization_subscriptions.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS organization_subscriptions
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  plan_id UUID NOT NULL
  REFERENCES plans(id),
  status billing_subscription_status NOT NULL,
  provider billing_provider_type NOT NULL DEFAULT 'system',
  billing_interval billing_interval_type NOT NULL,
  provider_customer_id VARCHAR(150),
  provider_subscription_id VARCHAR(150),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end   TIMESTAMPTZ NOT NULL,
  trial_start TIMESTAMPTZ,
  trial_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  modules JSONB NOT NULL DEFAULT '{}',
  performance_class VARCHAR(20),
  addons JSONB NOT NULL DEFAULT '[]',
  next_plan_id UUID REFERENCES plans(id),
  entitlement_version INTEGER NOT NULL DEFAULT 1,
  entitlement_snapshot_version INTEGER,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_subscription_period
  CHECK (current_period_end > current_period_start),
  CONSTRAINT chk_trial_period
  CHECK (
  trial_start IS NULL
  OR trial_end IS NULL
  OR trial_end > trial_start
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_single_active_subscription
ON organization_subscriptions(organization_id)
WHERE status IN ('trialing','active','past_due')
AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_subscription
ON organization_subscriptions(provider, provider_subscription_id)
WHERE provider_subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org
ON organization_subscriptions(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_live_latest
ON organization_subscriptions(organization_id, created_at DESC)
WHERE status IN ('trialing','active','past_due')
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_plan
ON organization_subscriptions(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_period_end
ON organization_subscriptions(current_period_end)
WHERE status IN ('trialing','active','past_due')
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_status
ON organization_subscriptions(status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_active_current
  ON organization_subscriptions (organization_id, current_period_end DESC)
  WHERE status IN ('trialing', 'active') AND deleted_at IS NULL;

-- ============================================================
-- Source: 07_billing/001_create_invoices.sql
-- ============================================================

-- Normalized final definition for invoices.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/013_invoices.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql

CREATE TABLE IF NOT EXISTS invoices
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  subscription_id UUID
  REFERENCES organization_subscriptions(id)
  ON DELETE SET NULL,
  provider billing_provider_type NOT NULL,
  provider_invoice_id VARCHAR(150),
  invoice_number VARCHAR(100) NOT NULL,
  status billing_invoice_status NOT NULL,
  currency CHAR(3) NOT NULL,
  subtotal_amount BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  tax_amount INTEGER NOT NULL DEFAULT 0,
  discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_paid BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  tax_rate NUMERIC(5,2),
  tax_id_snapshot VARCHAR(50),
  billing_address_snapshot JSONB,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  overage_events BIGINT NOT NULL DEFAULT 0,
  overage_amount BIGINT NOT NULL DEFAULT 0,
  pdf_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_invoice_period
  CHECK(period_end > period_start),
  CONSTRAINT uq_invoice_number UNIQUE(invoice_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_invoice
ON invoices(provider, provider_invoice_id)
WHERE provider_invoice_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_org
ON invoices(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_subscription
ON invoices(subscription_id, created_at DESC)
WHERE subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_status
ON invoices(status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_due
ON invoices(due_at)
WHERE due_at IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_period
ON invoices(period_start, period_end)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS gin_invoice_metadata
ON invoices
USING GIN(metadata);

-- ============================================================
-- Source: 07_billing/001_create_payments.sql
-- ============================================================

-- Normalized final definition for payments.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/014_payments.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS payments
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  invoice_id UUID
  REFERENCES invoices(id)
  ON DELETE SET NULL,
  subscription_id UUID
  REFERENCES organization_subscriptions(id)
  ON DELETE SET NULL,
  provider billing_provider_type NOT NULL,
  provider_payment_id VARCHAR(150),
  provider_order_id   VARCHAR(150),
  status billing_payment_status NOT NULL,
  currency CHAR(3) NOT NULL,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  fee_amount BIGINT NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  tax_amount BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  payment_method VARCHAR(50),
  payment_method_last4 VARCHAR(10),
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  failure_code VARCHAR(100),
  failure_reason TEXT,
  idempotency_key VARCHAR(150),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_provider_payment UNIQUE(provider, provider_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_org
ON payments(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_invoice
ON payments(invoice_id)
WHERE invoice_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_subscription
ON payments(subscription_id)
WHERE subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_status
ON payments(status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency
ON payments(idempotency_key)
WHERE idempotency_key IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS gin_payments_metadata
ON payments
USING GIN(metadata);

-- ============================================================
-- Source: 07_billing/001_create_billing_audit_logs.sql
-- ============================================================

-- Normalized final definition for billing_audit_logs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/019_billing_audit_logs.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS billing_audit_logs
(
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  subscription_id UUID
  REFERENCES organization_subscriptions(id)
  ON DELETE SET NULL,
  invoice_id UUID
  REFERENCES invoices(id)
  ON DELETE SET NULL,
  payment_id UUID
  REFERENCES payments(id)
  ON DELETE SET NULL,
  coupon_id UUID
  REFERENCES coupons(id)
  ON DELETE SET NULL,
  actor_type subscription_event_actor NOT NULL,
  actor_user_id UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  request_id UUID,
  correlation_id UUID,
  trace_id UUID,
  ip_address INET,
  user_agent TEXT,
  previous_state JSONB,
  new_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

-- ============================================================
-- Source: 07_billing/001_create_billing_audit_logs_2026_07.sql
-- ============================================================

-- Normalized final definition for billing_audit_logs_2026_07.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/019_billing_audit_logs.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS billing_audit_logs_2026_07
PARTITION OF billing_audit_logs
FOR VALUES FROM (
  '2026-07-01'
) TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS brin_bal_2026_07_time
ON billing_audit_logs_2026_07
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_metadata
ON billing_audit_logs_2026_07
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_previous
ON billing_audit_logs_2026_07
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_new
ON billing_audit_logs_2026_07
USING GIN(new_state);

-- ============================================================
-- Source: 07_billing/001_create_billing_audit_logs_2026_08.sql
-- ============================================================

-- Normalized final definition for billing_audit_logs_2026_08.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/019_billing_audit_logs.sql
-- - canonical_migrations_draft/11_billing/043_billing_audit_log_partition_safety.sql

CREATE TABLE IF NOT EXISTS billing_audit_logs_2026_08
PARTITION OF billing_audit_logs
FOR VALUES FROM (
  '2026-08-01'
) TO ('2026-09-01');

CREATE INDEX IF NOT EXISTS brin_bal_2026_08_time
ON billing_audit_logs_2026_08
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS gin_bal_2026_08_metadata
ON billing_audit_logs_2026_08
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_2026_08_previous
ON billing_audit_logs_2026_08
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_2026_08_new
ON billing_audit_logs_2026_08
USING GIN(new_state);

-- ============================================================
-- Source: 07_billing/001_create_billing_audit_logs_default.sql
-- ============================================================

-- Normalized final definition for billing_audit_logs_default.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/019_billing_audit_logs.sql
-- - canonical_migrations_draft/11_billing/043_billing_audit_log_partition_safety.sql

CREATE TABLE IF NOT EXISTS billing_audit_logs_default
PARTITION OF billing_audit_logs
DEFAULT;

CREATE INDEX IF NOT EXISTS brin_bal_default_time
ON billing_audit_logs_default
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS gin_bal_default_metadata
ON billing_audit_logs_default
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_default_previous
ON billing_audit_logs_default
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_default_new
ON billing_audit_logs_default
USING GIN(new_state);

-- ============================================================
-- Source: 07_billing/001_create_billing_event_credit_weights.sql
-- ============================================================

-- Normalized final definition for billing_event_credit_weights.
-- Canonical source: database/primarydbv2/migrations/000005_weighted_event_credit_billing.up.sql

CREATE TABLE IF NOT EXISTS billing_event_credit_weights (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(64) NOT NULL UNIQUE,
    credit_weight   NUMERIC(8,4) NOT NULL,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying active event credit weights
CREATE INDEX IF NOT EXISTS idx_billing_event_credit_weights_active
    ON billing_event_credit_weights (is_active)
    WHERE is_active = true;

COMMENT ON TABLE billing_event_credit_weights IS 
'Stores the credit cost per telemetry event type for weighted credit consumption';

COMMENT ON COLUMN billing_event_credit_weights.credit_weight IS 
'Multiplier converting one raw event of this type into billable credits';

-- ============================================================
-- Source: 07_billing/001_create_billing_webhook_events.sql
-- ============================================================

-- Normalized final definition for billing_webhook_events.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
-- - canonical_migrations_draft/11_billing/015_billing_webhook_events.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS billing_webhook_events
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider billing_provider_type NOT NULL,
  provider_event_id VARCHAR(200) NOT NULL,
  event_type VARCHAR(150) NOT NULL,
  organization_id UUID
  REFERENCES organizations(id)
  ON DELETE SET NULL,
  payload JSONB NOT NULL,
  payload_sha256 CHAR(64),
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  api_version VARCHAR(50),
  processing_status VARCHAR(20) NOT NULL DEFAULT 'received'
  CHECK (
  processing_status IN
  ('received','processing','processed','failed','ignored','dead_letter')
  ),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  processing_duration_ms INTEGER
  CHECK (processing_duration_ms IS NULL OR processing_duration_ms >= 0),
  request_id UUID,
  correlation_id UUID,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_provider_event UNIQUE(provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_pending
  ON billing_webhook_events(received_at)
  WHERE processing_status IN ('received', 'failed');

CREATE INDEX IF NOT EXISTS idx_billing_webhook_org
  ON billing_webhook_events(org_id, received_at DESC)
  WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bwe_pending
ON billing_webhook_events(next_retry_at, received_at)
WHERE processing_status IN ('received','failed');

CREATE INDEX IF NOT EXISTS idx_bwe_org
ON billing_webhook_events(organization_id, received_at DESC)
WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bwe_status
ON billing_webhook_events(processing_status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_bwe_request
ON billing_webhook_events(request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bwe_received_brin
ON billing_webhook_events
USING BRIN(received_at);

CREATE INDEX IF NOT EXISTS gin_bwe_payload
ON billing_webhook_events
USING GIN(payload);

CREATE INDEX IF NOT EXISTS gin_bwe_metadata
ON billing_webhook_events
USING GIN(metadata);

-- ============================================================
-- Source: 07_billing/001_create_coupon_applicable_plans.sql
-- ============================================================

-- Normalized final definition for coupon_applicable_plans.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
-- - canonical_migrations_draft/11_billing/018_coupon_applicable_plans.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS coupon_applicable_plans
(
  coupon_id UUID NOT NULL
  REFERENCES coupons(id)
  ON DELETE CASCADE,
  plan_id UUID NOT NULL
  REFERENCES plans(id)
  ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (coupon_id, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_applicable_plans_plan
  ON coupon_applicable_plans(plan_id);

-- ============================================================
-- Source: 07_billing/001_create_coupon_redemptions.sql
-- ============================================================

-- Normalized final definition for coupon_redemptions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/017_coupon_redemptions.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS coupon_redemptions
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL
  REFERENCES coupons(id)
  ON DELETE CASCADE,
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  subscription_id UUID
  REFERENCES organization_subscriptions(id)
  ON DELETE SET NULL,
  invoice_id UUID
  REFERENCES invoices(id)
  ON DELETE SET NULL,
  redeemed_by UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  discount_amount BIGINT NOT NULL DEFAULT 0
  CHECK (discount_amount >= 0),
  currency CHAR(3) NOT NULL,
  redemption_source VARCHAR(30) NOT NULL DEFAULT 'manual'
  CHECK (
  redemption_source IN
  ('manual','checkout','admin','promotion','api')
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_coupon_org UNIQUE(coupon_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_org
ON coupon_redemptions(organization_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon
ON coupon_redemptions(coupon_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_subscription
ON coupon_redemptions(subscription_id)
WHERE subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_invoice
ON coupon_redemptions(invoice_id)
WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brin_coupon_redemptions_time
ON coupon_redemptions
USING BRIN(redeemed_at);

CREATE INDEX IF NOT EXISTS gin_coupon_redemptions_metadata
ON coupon_redemptions
USING GIN(metadata);

-- ============================================================
-- Source: 07_billing/001_create_credit_balances.sql
-- ============================================================

-- Normalized final definition for credit_balances.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/002_credit_balances.up.sql
-- - canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql

CREATE TABLE IF NOT EXISTS credit_balances (
  owner_type VARCHAR(20) NOT NULL
  CHECK (owner_type IN ('organization', 'user')),
  owner_id UUID NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved_credits BIGINT NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlimited BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (owner_type, owner_id)
);

-- ============================================================
-- Source: 07_billing/001_create_credit_ledger.sql
-- ============================================================

-- Normalized final definition for credit_ledger.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/003_credit_ledger.up.sql
-- - canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql

CREATE TABLE IF NOT EXISTS credit_ledger (
  ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type VARCHAR(20) NOT NULL
  CHECK (owner_type IN ('organization', 'user')),
  owner_id UUID NOT NULL,
  request_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  ai_mode TEXT,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  direction VARCHAR(10) NOT NULL
  CHECK (direction IN ('debit', 'credit', 'refund')),
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
  CHECK (status IN ('pending', 'completed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_owner
  ON credit_ledger (owner_type, owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_request
  ON credit_ledger (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_ledger_ai_mode
  ON credit_ledger (owner_type, owner_id, ai_mode);

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_owner_idempotency
  ON credit_ledger (owner_type, owner_id, idempotency_key);

-- ============================================================
-- Source: 07_billing/001_create_credit_rules.sql
-- ============================================================

-- Normalized final definition for credit_rules.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/004_credit_rules.up.sql

CREATE TABLE IF NOT EXISTS credit_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope VARCHAR(20) NOT NULL
  CHECK (scope IN ('platform', 'plan', 'tenant')),
  plan TEXT,
  tenant_id UUID,
  ai_mode TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost >= 0),
  cached_cost INTEGER NOT NULL DEFAULT 0 CHECK (cached_cost >= 0),
  partial_cost INTEGER NOT NULL DEFAULT 0 CHECK (partial_cost >= 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  priority INTEGER NOT NULL DEFAULT 100,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_rules_platform_mode
  ON credit_rules (ai_mode)
  WHERE scope = 'platform' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_credit_rules_lookup
  ON credit_rules (scope, plan, tenant_id, ai_mode)
  WHERE status = 'active';

-- ============================================================
-- Source: 07_billing/001_create_invoice_line_items.sql
-- ============================================================

-- Normalized final definition for invoice_line_items.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/invoice_line_items.sql

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_type VARCHAR(30) NOT NULL            
  CHECK (line_type IN ('plan','addon','overage','discount','tax','credit')),
  description VARCHAR(255) NOT NULL,
  quantity BIGINT NOT NULL DEFAULT 1,
  unit_amount_minor BIGINT NOT NULL,
  amount_minor BIGINT NOT NULL,
  plan_id UUID REFERENCES plans(id),
  addon_id UUID REFERENCES addons(id),
  feature_key VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 07_billing/001_create_organization_feature_overrides.sql
-- ============================================================

-- Normalized final definition for organization_feature_overrides.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/009_organization_feature_overrides.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS organization_feature_overrides
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  feature_id UUID NOT NULL
  REFERENCES billing_features(id)
  ON DELETE RESTRICT,
  boolean_value BOOLEAN,
  integer_value BIGINT,
  decimal_value NUMERIC(20,6),
  string_value TEXT,
  reason TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_by UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  approved_by UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_override_window
  CHECK (expires_at IS NULL OR expires_at > effective_from),
  CONSTRAINT chk_override_single_value
  CHECK (
  ((boolean_value IS NOT NULL)::int +
  (integer_value IS NOT NULL)::int +
  (decimal_value IS NOT NULL)::int +
  (string_value IS NOT NULL)::int) <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_ofo_org
ON organization_feature_overrides(organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_feature
ON organization_feature_overrides(feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_org_feature
ON organization_feature_overrides(organization_id, feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_active
ON organization_feature_overrides(effective_from, expires_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_metadata
ON organization_feature_overrides
USING GIN(metadata);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ofo_active_org_feature
  ON organization_feature_overrides(organization_id, feature_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 07_billing/001_create_organization_usage_current_period.sql
-- ============================================================

-- Normalized final definition for organization_usage_current_period.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
-- - canonical_migrations_draft/11_billing/010_organization_usage_current_period.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/042_alert_connector_usage_counters.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql
-- - migrations/004_enterprise_database_integrity.sql

CREATE TABLE IF NOT EXISTS organization_usage_current_period
(
  organization_id UUID PRIMARY KEY
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  subscription_id UUID
  REFERENCES organization_subscriptions(id)
  ON DELETE SET NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  events_used              NUMERIC(14, 4) NOT NULL DEFAULT 0,
  raw_events_count         BIGINT NOT NULL DEFAULT 0,
  ai_credits_used          BIGINT NOT NULL DEFAULT 0,
  projects_used            INTEGER NOT NULL DEFAULT 0,
  members_used             INTEGER NOT NULL DEFAULT 0,
  api_keys_used            INTEGER NOT NULL DEFAULT 0,
  connectors_used          INTEGER NOT NULL DEFAULT 0,
  alert_rules_used         INTEGER NOT NULL DEFAULT 0,
  dashboards_used          INTEGER NOT NULL DEFAULT 0,
  event_limit              BIGINT NOT NULL DEFAULT 0,
  ai_credit_limit          BIGINT NOT NULL DEFAULT 0,
  overage_events           BIGINT NOT NULL DEFAULT 0,
  overage_ai_credits       BIGINT NOT NULL DEFAULT 0,
  last_event_at            TIMESTAMPTZ,
  last_ai_request_at       TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  events_count BIGINT NOT NULL DEFAULT 0,
  last_incremented_at TIMESTAMPTZ,
  alert_notifications_used BIGINT NOT NULL DEFAULT 0,
  connector_sends_used BIGINT NOT NULL DEFAULT 0,
  email_sends_used BIGINT NOT NULL DEFAULT 0,
  slack_sends_used BIGINT NOT NULL DEFAULT 0,
  sms_sends_used BIGINT NOT NULL DEFAULT 0,
  webhook_sends_used BIGINT NOT NULL DEFAULT 0,
  last_alert_notification_at TIMESTAMPTZ,
  last_connector_send_at TIMESTAMPTZ,
  projects_limit INTEGER NOT NULL DEFAULT 0,
  members_limit INTEGER NOT NULL DEFAULT 0,
  api_keys_limit INTEGER NOT NULL DEFAULT 0,
  connectors_limit INTEGER NOT NULL DEFAULT 0,
  alert_rules_limit INTEGER NOT NULL DEFAULT 0,
  dashboards_limit INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_usage_period
  CHECK (period_end > period_start),
  CONSTRAINT chk_non_negative
  CHECK (
  events_used >= 0
  AND raw_events_count >= 0
  AND ai_credits_used >= 0
  AND projects_used >= 0
  AND members_used >= 0
  AND api_keys_used >= 0
  AND connectors_used >= 0
  AND alert_rules_used >= 0
  AND dashboards_used >= 0
  AND event_limit >= 0
  AND ai_credit_limit >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_org_usage_period_end
ON organization_usage_current_period(period_end);

CREATE INDEX IF NOT EXISTS idx_org_usage_subscription
ON organization_usage_current_period(subscription_id);

CREATE INDEX IF NOT EXISTS idx_org_usage_last_event
ON organization_usage_current_period(last_event_at DESC)
WHERE last_event_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_usage_last_ai
ON organization_usage_current_period(last_ai_request_at DESC)
WHERE last_ai_request_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_usage_metadata
ON organization_usage_current_period
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_org_usage_current_period
    ON organization_usage_current_period(organization_id, period_start, period_end);

-- ============================================================
-- Source: 07_billing/001_create_payment_methods.sql
-- ============================================================

-- Normalized final definition for payment_methods.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/payment_methods.sql

CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider billing_provider_type NOT NULL,
  provider_payment_method_id VARCHAR(150) NOT NULL,
  type VARCHAR(30) NOT NULL
  CHECK (type IN ('card', 'bank_transfer', 'upi', 'wallet')),
  last4 VARCHAR(10),
  brand VARCHAR(50),
  expiry_month INTEGER,
  expiry_year INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  billing_details JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_default_payment_method
ON payment_methods (organization_id)
WHERE is_default = TRUE;

-- ============================================================
-- Source: 07_billing/001_create_plan_feature_entitlements.sql
-- ============================================================

-- Normalized final definition for plan_feature_entitlements.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/005_plan_feature_entitlements.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS plan_feature_entitlements
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL
  REFERENCES plans(id)
  ON DELETE CASCADE,
  feature_id UUID NOT NULL
  REFERENCES billing_features(id)
  ON DELETE CASCADE,
  boolean_value BOOLEAN,
  integer_value BIGINT,
  decimal_value NUMERIC(20,6),
  string_value TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_value TEXT,
  CONSTRAINT uq_plan_feature UNIQUE(plan_id, feature_id),
  CONSTRAINT chk_single_value CHECK (
  ((boolean_value IS NOT NULL)::int +
  (integer_value IS NOT NULL)::int +
  (decimal_value IS NOT NULL)::int +
  (string_value IS NOT NULL)::int) <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_pfe_plan
ON plan_feature_entitlements(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pfe_feature
ON plan_feature_entitlements(feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pfe_plan_feature
ON plan_feature_entitlements(plan_id, feature_id)
WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 07_billing/001_create_plan_prices.sql
-- ============================================================

-- Normalized final definition for plan_prices.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/003_plan_prices.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS plan_prices
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL
  REFERENCES plans(id)
  ON DELETE CASCADE,
  provider billing_provider_type NOT NULL,
  billing_interval billing_interval_type NOT NULL,
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL
  CHECK (amount_minor >= 0),
  provider_price_id VARCHAR(150),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  country_code CHAR(2),
  region_code VARCHAR(50),
  tax_behavior billing_tax_behavior
  NOT NULL DEFAULT 'unspecified',
  is_promotional BOOLEAN
  NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_plan_price UNIQUE
  (
  plan_id,
  provider,
  billing_interval,
  currency,
  starts_at
  ),
  CONSTRAINT chk_plan_price_window
  CHECK
  (
  ends_at IS NULL
  OR starts_at IS NULL
  OR ends_at > starts_at
  )
);

CREATE INDEX IF NOT EXISTS idx_plan_prices_plan
ON plan_prices(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_provider
ON plan_prices(provider)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_currency
ON plan_prices(currency)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_interval
ON plan_prices(billing_interval)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_lookup
ON plan_prices
(
    plan_id,
    provider,
    billing_interval,
    currency
)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_prices_default
ON plan_prices
(
    plan_id,
    billing_interval,
    currency
)
WHERE is_default = TRUE
AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_price
ON plan_prices
(
    provider,
    provider_price_id
)
WHERE provider_price_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_active_window
ON plan_prices
(
    starts_at,
    ends_at
)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_region
ON plan_prices
(
    country_code,
    region_code
)
WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 07_billing/001_create_subscription_addons.sql
-- ============================================================

-- Normalized final definition for subscription_addons.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/008_subscription_addons.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/006_organization_subscriptions.sql

CREATE TABLE IF NOT EXISTS subscription_addons
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL
  REFERENCES organization_subscriptions(id)
  ON DELETE CASCADE,
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  feature_id UUID NOT NULL
  REFERENCES billing_features(id)
  ON DELETE RESTRICT,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  provider billing_provider_type NOT NULL DEFAULT 'system',
  provider_reference VARCHAR(150),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','scheduled','expired','cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  addon_key VARCHAR(50),
  module VARCHAR(50),
  addon_id UUID REFERENCES addons(id) ON DELETE SET NULL,
  CONSTRAINT chk_addon_window
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_subscription
ON subscription_addons(subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_org
ON subscription_addons(organization_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_feature
ON subscription_addons(feature_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_active
ON subscription_addons(status, expires_at)
WHERE status='active';

CREATE INDEX IF NOT EXISTS idx_subscription_addons_metadata
ON subscription_addons
USING GIN(metadata);

-- ============================================================
-- Source: 07_billing/001_create_subscription_events.sql
-- ============================================================

-- Normalized final definition for subscription_events.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/007_subscription_events.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql

CREATE TABLE IF NOT EXISTS subscription_events
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  subscription_id UUID NOT NULL
  REFERENCES organization_subscriptions(id)
  ON DELETE CASCADE,
  event_type subscription_event_type NOT NULL,
  actor subscription_event_actor NOT NULL,
  actor_user_id UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  old_plan_id UUID
  REFERENCES plans(id)
  ON DELETE SET NULL,
  new_plan_id UUID
  REFERENCES plans(id)
  ON DELETE SET NULL,
  request_id UUID,
  correlation_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_org_time
ON subscription_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription_time
ON subscription_events (subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_event
ON subscription_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_actor
ON subscription_events (actor, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_request
ON subscription_events (request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_events_metadata
ON subscription_events
USING GIN (metadata);

-- ============================================================
-- Source: 07_billing/001_create_usage_daily_counters.sql
-- ============================================================

-- Normalized final definition for usage_daily_counters.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/011_usage_daily_counters.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/042_alert_connector_usage_counters.sql

CREATE TABLE IF NOT EXISTS usage_daily_counters
(
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  project_id UUID
  REFERENCES projects(id)
  ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  events_count           BIGINT NOT NULL DEFAULT 0,
  ai_credits_used        BIGINT NOT NULL DEFAULT 0,
  requests_count         BIGINT NOT NULL DEFAULT 0,
  errors_count           BIGINT NOT NULL DEFAULT 0,
  traces_count           BIGINT NOT NULL DEFAULT 0,
  spans_count            BIGINT NOT NULL DEFAULT 0,
  metrics_count          BIGINT NOT NULL DEFAULT 0,
  logs_count             BIGINT NOT NULL DEFAULT 0,
  profiles_count         BIGINT NOT NULL DEFAULT 0,
  replays_count          BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_notifications_count BIGINT NOT NULL DEFAULT 0,
  connector_sends_count BIGINT NOT NULL DEFAULT 0,
  email_sends_count BIGINT NOT NULL DEFAULT 0,
  slack_sends_count BIGINT NOT NULL DEFAULT 0,
  sms_sends_count BIGINT NOT NULL DEFAULT 0,
  webhook_sends_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id, usage_date),
  CONSTRAINT uq_usage_scope UNIQUE
  (
  organization_id,
  project_id,
  usage_date
  )
)
PARTITION BY RANGE (usage_date);

-- ============================================================
-- Source: 07_billing/001_create_usage_daily_counters_2026_07.sql
-- ============================================================

-- Normalized final definition for usage_daily_counters_2026_07.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/011_usage_daily_counters.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS usage_daily_counters_2026_07
PARTITION OF usage_daily_counters
FOR VALUES FROM (
  '2026-07-01'
) TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS brin_udc_2026_07_date
ON usage_daily_counters_2026_07
USING BRIN (usage_date);

-- ============================================================
-- Source: 07_billing/001_create_usage_daily_counters_default.sql
-- ============================================================

-- Normalized final definition for usage_daily_counters_default.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/17_enterprise_ingestion/005_usage_counters_default_partition.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS usage_daily_counters_default
  PARTITION OF usage_daily_counters DEFAULT;

-- ============================================================
-- Source: 08_connector/001_create_connector_configs.sql
-- ============================================================

-- Normalized final definition for connector_configs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/001_create_connector_configs.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/06_connectors/014_link_project_routing.up.sql
-- - migrations/003_project_module_refactor.sql
-- - migrations/004_enterprise_database_integrity.sql

CREATE TABLE IF NOT EXISTS connector_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_setup'
  CHECK (status IN (
  'pending_setup','active','inactive',
  'disabled','expired','revoked',
  'degraded','error','rate_limited'
  )),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  supports_rich_formatting BOOLEAN NOT NULL DEFAULT FALSE,
  supports_threading BOOLEAN NOT NULL DEFAULT FALSE,
  supports_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limit_requests INTEGER NOT NULL DEFAULT 60,
  rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60,
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_backoff_base_ms INTEGER NOT NULL DEFAULT 1000,
  retry_backoff_multiplier NUMERIC(5,2) NOT NULL DEFAULT 2.0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_threshold INTEGER NOT NULL DEFAULT 5,
  last_health_check_at TIMESTAMPTZ,
  last_successful_delivery_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_name_org
ON connector_configs (organization_id, lower(name))
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_org
ON connector_configs (organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_project
ON connector_configs (project_id)
WHERE deleted_at IS NULL AND project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_connector_provider
ON connector_configs (provider)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_status
ON connector_configs (status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_default
ON connector_configs (organization_id, is_default)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_last_health
ON connector_configs (last_health_check_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_last_delivery
ON connector_configs (last_successful_delivery_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_configs_tenant_id
  ON connector_configs(id, organization_id);

CREATE INDEX IF NOT EXISTS idx_connector_configs_org_provider_status
  ON connector_configs (organization_id, provider, status)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 08_connector/001_create_connector_audit_logs.sql
-- ============================================================

-- Normalized final definition for connector_audit_logs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_type VARCHAR(50),
  previous_state JSONB,
  new_state JSONB,
  changes_summary JSONB,
  ip_address INET,
  user_agent TEXT,
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_audit_org_created
ON connector_audit_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_connector_created
ON connector_audit_logs (connector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor
ON connector_audit_logs (actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_changes_gin
ON connector_audit_logs
USING GIN (changes_summary);

-- ============================================================
-- Source: 08_connector/001_create_connector_audit_logs_default.sql
-- ============================================================

-- Normalized final definition for connector_audit_logs_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_audit_logs_default
PARTITION OF connector_audit_logs DEFAULT;

-- ============================================================
-- Source: 08_connector/001_create_connector_circuit_state.sql
-- ============================================================

-- Normalized final definition for connector_circuit_state.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql

CREATE TABLE IF NOT EXISTS connector_circuit_state (
  connector_id          UUID PRIMARY KEY REFERENCES connector_configs(id) ON DELETE CASCADE,
  state                 VARCHAR(12) NOT NULL DEFAULT 'closed',
  consecutive_failures  INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  opened_at             TIMESTAMPTZ,
  half_open_at          TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_failure_at       TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_connector_circuit_state_state CHECK (
  state IN ('closed','open','half_open')
  )
);

CREATE INDEX IF NOT EXISTS idx_connector_circuit_state_open
  ON connector_circuit_state (state, opened_at)
  WHERE state <> 'closed';

-- ============================================================
-- Source: 08_connector/001_create_connector_credentials.sql
-- ============================================================

-- Normalized final definition for connector_credentials.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/002_create_connector_credentials.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  credential_type VARCHAR(50) NOT NULL,
  key_name VARCHAR(100) NOT NULL,
  encrypted_value BYTEA NOT NULL,
  algorithm VARCHAR(50),
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(connector_id,key_name)
);

CREATE INDEX IF NOT EXISTS idx_credentials_type
ON connector_credentials (credential_type);

CREATE INDEX IF NOT EXISTS idx_credentials_expiry
ON connector_credentials (expires_at)
WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credentials_last_used
ON connector_credentials (last_used_at DESC);

-- ============================================================
-- Source: 08_connector/001_create_connector_routes.sql
-- ============================================================

-- Normalized final definition for connector_routes.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/004_create_connector_routes.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  environment VARCHAR(30),
  event_type VARCHAR(100) NOT NULL,
  severity VARCHAR(30),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT connector_routes_environment_check
  CHECK (environment IS NULL OR environment IN ('development', 'staging', 'production'))
);

CREATE INDEX IF NOT EXISTS idx_routes_connector
ON connector_routes (connector_id);

CREATE INDEX IF NOT EXISTS idx_routes_project
ON connector_routes (project_id);

CREATE INDEX IF NOT EXISTS idx_routes_environment
ON connector_routes (environment);

CREATE INDEX IF NOT EXISTS idx_routes_event
ON connector_routes (event_type);

CREATE INDEX IF NOT EXISTS idx_routes_enabled
ON connector_routes (enabled);

CREATE INDEX IF NOT EXISTS idx_routes_lookup
ON connector_routes (project_id, environment, event_type, severity, enabled);

-- ============================================================
-- Source: 08_connector/001_create_connector_deliveries.sql
-- ============================================================

-- Normalized final definition for connector_deliveries.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  route_id UUID REFERENCES connector_routes(id) ON DELETE SET NULL,
  event_id UUID,
  alert_id UUID,
  notification_type VARCHAR(100) NOT NULL DEFAULT 'alert',
  severity VARCHAR(30) NOT NULL DEFAULT 'info',
  status VARCHAR(30) NOT NULL,
  http_status INTEGER,
  provider_request_id VARCHAR(255),
  external_message_id VARCHAR(255),
  payload JSONB NOT NULL,
  payload_size_bytes INTEGER,
  provider_response JSONB,
  response_body TEXT,
  response_status_code INTEGER,
  error_message TEXT,
  error_details JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  duration_ms INTEGER,
  delivery_latency_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  parent_delivery_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_delivery_connector
ON connector_deliveries (connector_id);

CREATE INDEX IF NOT EXISTS idx_delivery_org_created
ON connector_deliveries (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_alert
ON connector_deliveries (alert_id);

CREATE INDEX IF NOT EXISTS idx_delivery_event
ON connector_deliveries (event_id);

CREATE INDEX IF NOT EXISTS idx_delivery_status
ON connector_deliveries (status);

CREATE INDEX IF NOT EXISTS idx_delivery_next_retry
ON connector_deliveries (next_retry_at)
WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_correlation
ON connector_deliveries (correlation_id);

CREATE INDEX IF NOT EXISTS idx_delivery_created
ON connector_deliveries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_lookup
ON connector_deliveries (connector_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_payload_gin
ON connector_deliveries
USING GIN (payload);

CREATE INDEX IF NOT EXISTS idx_delivery_response_gin
ON connector_deliveries
USING GIN (provider_response);

-- ============================================================
-- Source: 08_connector/001_create_connector_deliveries_default.sql
-- ============================================================

-- Normalized final definition for connector_deliveries_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_deliveries_default
PARTITION OF connector_deliveries DEFAULT;

-- ============================================================
-- Source: 08_connector/001_create_connector_delivery_attempts.sql
-- ============================================================

-- Normalized final definition for connector_delivery_attempts.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_delivery_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL,
  delivery_created_at TIMESTAMPTZ NOT NULL,
  attempt_number INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL,
  http_status INTEGER,
  error_code VARCHAR(100),
  error_message TEXT,
  response JSONB,
  duration_ms INTEGER,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, attempted_at),
  FOREIGN KEY (delivery_id, delivery_created_at)
  REFERENCES connector_deliveries(id, created_at) ON DELETE CASCADE
) PARTITION BY RANGE (attempted_at);

CREATE INDEX IF NOT EXISTS idx_attempt_delivery
ON connector_delivery_attempts (delivery_id);

CREATE INDEX IF NOT EXISTS idx_attempt_status
ON connector_delivery_attempts (status);

CREATE INDEX IF NOT EXISTS idx_attempt_time
ON connector_delivery_attempts (attempted_at DESC);

-- ============================================================
-- Source: 08_connector/001_create_connector_delivery_attempts_default.sql
-- ============================================================

-- Normalized final definition for connector_delivery_attempts_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_delivery_attempts_default
PARTITION OF connector_delivery_attempts DEFAULT;

-- ============================================================
-- Source: 08_connector/001_create_connector_health_checks.sql
-- ============================================================

-- Normalized final definition for connector_health_checks.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_health_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  http_status INTEGER,
  dns_time_ms INTEGER,
  tls_time_ms INTEGER,
  connect_time_ms INTEGER,
  response_time_ms INTEGER,
  error_code VARCHAR(100),
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, checked_at)
) PARTITION BY RANGE (checked_at);

CREATE INDEX IF NOT EXISTS idx_health_connector_recent
ON connector_health_checks (connector_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_status
ON connector_health_checks (status);

CREATE INDEX IF NOT EXISTS idx_health_checked_at
ON connector_health_checks (checked_at DESC);

-- ============================================================
-- Source: 08_connector/001_create_connector_health_checks_default.sql
-- ============================================================

-- Normalized final definition for connector_health_checks_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_health_checks_default
PARTITION OF connector_health_checks DEFAULT;

-- ============================================================
-- Source: 08_connector/001_create_connector_oauth_states.sql
-- ============================================================

-- Normalized final definition for connector_oauth_states.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/009_create_connector_oauth_states.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID REFERENCES connector_configs(id) ON DELETE CASCADE,
  state VARCHAR(255) NOT NULL UNIQUE,
  code_verifier TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_expiry
ON connector_oauth_states (expires_at);

CREATE INDEX IF NOT EXISTS idx_oauth_connector
ON connector_oauth_states (connector_id);

-- ============================================================
-- Source: 08_connector/001_create_connector_rate_buckets.sql
-- ============================================================

-- Normalized final definition for connector_rate_buckets.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql

CREATE TABLE IF NOT EXISTS connector_rate_buckets (
  connector_id    UUID PRIMARY KEY REFERENCES connector_configs(id) ON DELETE CASCADE,
  window_start    TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', now()),
  window_seconds  INTEGER NOT NULL CHECK (window_seconds > 0),
  consumed        INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_rate_buckets_window
  ON connector_rate_buckets (window_start);

-- ============================================================
-- Source: 08_connector/001_create_connector_secret_versions.sql
-- ============================================================

-- Normalized final definition for connector_secret_versions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/003_create_connector_secret_versions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_secret_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES connector_credentials(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  encrypted_value BYTEA NOT NULL,
  rotated_by UUID REFERENCES users(id),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secret_versions_lookup
ON connector_secret_versions (credential_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_secret_rotated_at
ON connector_secret_versions (rotated_at DESC);

-- ============================================================
-- Source: 08_connector/001_create_connector_test_runs.sql
-- ============================================================

-- Normalized final definition for connector_test_runs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  triggered_by UUID REFERENCES users(id),
  status VARCHAR(30) NOT NULL,
  response JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_connector
ON connector_test_runs (connector_id);

CREATE INDEX IF NOT EXISTS idx_test_created
ON connector_test_runs (created_at DESC);

-- ============================================================
-- Source: 08_connector/001_create_project_connector_subscriptions.sql
-- ============================================================

-- Normalized final definition for project_connector_subscriptions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
-- - migrations/003_project_module_refactor.sql
-- - canonical_migrations_draft/06_connectors/014_link_project_routing.up.sql

CREATE TABLE IF NOT EXISTS project_connector_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  alert_categories alert_category[] NOT NULL DEFAULT ARRAY['error','performance','security']::alert_category[],
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
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (project_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_project_connector_subscriptions_route ON project_connector_subscriptions(organization_id,project_id,enabled,severity_threshold) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_connector_subs_connector
  ON project_connector_subscriptions(connector_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_connector_subs_enabled
  ON project_connector_subscriptions(project_id, enabled)
  WHERE enabled = TRUE AND deleted_at IS NULL;

-- ============================================================
-- Source: 08_connector/002_add_connector_configs_project_id.sql
-- ============================================================

ALTER TABLE connector_configs
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_connector_project
  ON connector_configs (project_id)
  WHERE deleted_at IS NULL AND project_id IS NOT NULL;

-- ============================================================
-- Source: 10_notification/001_create_notification_routes.sql
-- ============================================================

-- Normalized final definition for notification_routes.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/07_notifications/003_create_notification_routes.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS notification_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  event_types VARCHAR(100)[] NOT NULL DEFAULT '{}',
  severity_levels notification_severity[] NOT NULL DEFAULT '{}',
  source_services VARCHAR(100)[] NOT NULL DEFAULT '{}',
  target_connector_ids UUID[] NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  throttle_window_seconds INTEGER,
  max_notifications_per_window INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_name_per_org
  ON notification_routes(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_routes_org_active
  ON notification_routes(organization_id, priority DESC)
  WHERE deleted_at IS NULL AND is_active;

-- ============================================================
-- Source: 10_notification/001_create_notification_templates.sql
-- ============================================================

-- Normalized final definition for notification_templates.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/07_notifications/002_create_notification_templates.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  connector_type connector_type NOT NULL,
  template_format VARCHAR(50) NOT NULL DEFAULT 'markdown',
  subject_template TEXT,
  body_template TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_template_name_per_org
  ON notification_templates(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_templates_org_type
  ON notification_templates(organization_id, connector_type)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alert_escalation_policies.sql
-- ============================================================

-- Normalized final definition for alert_escalation_policies.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/009_create_alert_escalation_policies.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_escalation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  repeat_interval_minutes INTEGER,
  max_repeats INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_policy_name_per_org
  ON alert_escalation_policies(organization_id, lower(name))
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alert_rules.sql
-- ============================================================

-- Normalized final definition for alert_rules.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/002_create_alert_rules.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/08_alerting/021_create_alert_rule_revisions.down.sql
-- - canonical_migrations_draft/08_alerting/021_create_alert_rule_revisions.up.sql
-- - canonical_migrations_draft/17_enterprise_ingestion/002_alerting_project_scope.up.sql
-- - migrations/004_enterprise_database_integrity.sql

CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  severity alert_severity NOT NULL DEFAULT 'warning',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  evaluation_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (evaluation_interval_seconds > 0),
  cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
  auto_resolve_after_minutes INTEGER,
  deduplication_window_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (deduplication_window_seconds >= 0),
  deduplication_key_template VARCHAR(500) DEFAULT '{{rule_id}}:{{source}}:{{fingerprint}}',
  grouping_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  grouping_key_template VARCHAR(500),
  grouping_wait_seconds INTEGER NOT NULL DEFAULT 300,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  enabled_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  current_revision INTEGER NOT NULL DEFAULT 1,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  preset_key VARCHAR(64),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  last_evaluated_at TIMESTAMPTZ,
  evaluation_category VARCHAR(32) NOT NULL DEFAULT 'analytics' CHECK (evaluation_category IN ('fast', 'analytics'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rule_name_per_org
  ON alert_rules(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_org_eval_cat
  ON alert_rules(organization_id, evaluation_category)
  WHERE deleted_at IS NULL AND enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled
  ON alert_rules(organization_id, enabled)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_severity
  ON alert_rules(severity)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_org_project
  ON alert_rules(organization_id, project_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_eval_due
  ON alert_rules(enabled, last_evaluated_at)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rules_preset_scope
  ON alert_rules(organization_id, project_id, preset_key) NULLS NOT DISTINCT
  WHERE preset_key IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alert_events.sql
-- ============================================================

-- Normalized final definition for alert_events.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  status alert_event_status NOT NULL DEFAULT 'pending',
  severity alert_severity NOT NULL,
  fingerprint VARCHAR(255) NOT NULL,
  source VARCHAR(100) NOT NULL,
  source_id VARCHAR(255),
  payload JSONB NOT NULL,
  payload_size_bytes INTEGER,
  normalized_payload JSONB,
  group_id UUID,
  group_key VARCHAR(255),
  is_group_parent BOOLEAN NOT NULL DEFAULT FALSE,
  parent_event_id UUID REFERENCES alert_events(id) ON DELETE SET NULL,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  next_escalation_at TIMESTAMPTZ,
  auto_resolve_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  acknowledgment_expires_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason VARCHAR(100),
  suppressed_by UUID REFERENCES users(id),
  suppressed_at TIMESTAMPTZ,
  suppression_reason VARCHAR(255),
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  escalation_policy_id UUID REFERENCES alert_escalation_policies(id) ON DELETE SET NULL,
  escalation_step_number INTEGER NOT NULL DEFAULT 0,
  escalation_repeat_count INTEGER NOT NULL DEFAULT 0,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT valid_event_lifecycle CHECK (
  (status = 'resolved' AND resolved_at IS NOT NULL) OR (status <> 'resolved')
  )
);

CREATE INDEX IF NOT EXISTS idx_alert_events_org_status
  ON alert_events(organization_id, status, created_at DESC)
  WHERE status IN ('firing', 'acknowledged', 'pending');

CREATE INDEX IF NOT EXISTS idx_alert_events_org_rule
  ON alert_events(organization_id, rule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint
  ON alert_events(organization_id, fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_source
  ON alert_events(organization_id, source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_group
  ON alert_events(organization_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_next_escalation
  ON alert_events(next_escalation_at)
  WHERE status = 'firing' AND next_escalation_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_auto_resolve
  ON alert_events(auto_resolve_at)
  WHERE status = 'firing' AND auto_resolve_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_pending_claim
  ON alert_events(organization_id, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_alert_events_stuck_processing
  ON alert_events(updated_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_alert_events_expired_ack
  ON alert_events(acknowledgment_expires_at)
  WHERE status = 'acknowledged' AND acknowledgment_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_escalation_policy
  ON alert_events(escalation_policy_id)
  WHERE escalation_policy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_org_project_status
  ON alert_events(organization_id, project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_org_fingerprint_status
  ON alert_events (organization_id, fingerprint, status, created_at DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alert_acknowledgments.sql
-- ============================================================

-- Normalized final definition for alert_acknowledgments.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  acknowledged_by UUID NOT NULL REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  comment TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_ack_per_event
  ON alert_acknowledgments(event_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_alert_acks_org
  ON alert_acknowledgments(organization_id, created_at DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alert_dead_letter_events.sql
-- ============================================================

-- Normalized final definition for alert_dead_letter_events.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_dead_letter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_queue VARCHAR(100) NOT NULL,
  pg_boss_job_id VARCHAR(255),
  batch_id UUID,
  event_ids UUID[] NOT NULL DEFAULT '{}',
  job_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  status alert_dead_letter_status NOT NULL DEFAULT 'pending_retry',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_retry_at TIMESTAMPTZ,
  retried_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ,
  discarded_by UUID REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_org_status
  ON alert_dead_letter_events(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_retryable
  ON alert_dead_letter_events(status, created_at)
  WHERE status = 'pending_retry';

-- ============================================================
-- Source: 09_alerting/001_create_alert_event_batches.sql
-- ============================================================

-- Normalized final definition for alert_event_batches.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_event_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status batch_status NOT NULL DEFAULT 'pending',
  worker_id VARCHAR(255),
  event_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_ids UUID[] NOT NULL DEFAULT '{}',
  skipped_count INTEGER NOT NULL DEFAULT 0,
  pg_boss_job_id VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_alert_event_batches_status
  ON alert_event_batches(status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_alert_event_batches_org
  ON alert_event_batches(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_event_batches_stuck
  ON alert_event_batches(started_at)
  WHERE status = 'processing';

-- ============================================================
-- Source: 09_alerting/001_create_alert_delivery_attempts.sql
-- ============================================================

-- Normalized final definition for alert_delivery_attempts.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  route_id UUID REFERENCES notification_routes(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES alert_event_batches(id) ON DELETE SET NULL,
  status delivery_attempt_status NOT NULL DEFAULT 'pending',
  request_payload JSONB,
  request_headers JSONB,
  response_payload TEXT,
  response_status_code INTEGER,
  error_message TEXT,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_category VARCHAR(50),
  latency_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  max_retries INTEGER NOT NULL DEFAULT 3,
  external_message_id VARCHAR(255),
  external_delivery_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_event
  ON alert_delivery_attempts(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_connector
  ON alert_delivery_attempts(connector_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_status
  ON alert_delivery_attempts(status, next_retry_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_batch
  ON alert_delivery_attempts(batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_org_created
  ON alert_delivery_attempts(organization_id, created_at DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alert_escalation_steps.sql
-- ============================================================

-- Normalized final definition for alert_escalation_steps.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/010_create_alert_escalation_steps.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_escalation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES alert_escalation_policies(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  wait_minutes INTEGER NOT NULL DEFAULT 5,
  connector_ids UUID[] NOT NULL DEFAULT '{}',
  route_ids UUID[] NOT NULL DEFAULT '{}',
  notify_on_call BOOLEAN NOT NULL DEFAULT FALSE,
  custom_message_template TEXT,
  template_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_step_number_per_policy UNIQUE (policy_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_alert_escalation_steps_policy
  ON alert_escalation_steps(policy_id, step_number);

-- ============================================================
-- Source: 09_alerting/001_create_alert_event_history.sql
-- ============================================================

-- Normalized final definition for alert_event_history.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_event_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action history_action NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(50) NOT NULL DEFAULT 'user',
  previous_state JSONB,
  new_state JSONB,
  changes_summary JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_history_event
  ON alert_event_history(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_event_history_org
  ON alert_event_history(organization_id, created_at DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alert_rule_bindings.sql
-- ============================================================

-- Normalized final definition for alert_rule_bindings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/020_create_alert_rule_bindings.up.sql

CREATE TABLE IF NOT EXISTS alert_rule_bindings (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id                       UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  scope_type                    alert_scope_type NOT NULL,
  scope_level                   SMALLINT NOT NULL,
  project_id                    UUID REFERENCES projects(id) ON DELETE CASCADE,
  environment                   VARCHAR(64),
  service                       VARCHAR(255),
  endpoint                      VARCHAR(500),
  mode                          alert_binding_mode NOT NULL DEFAULT 'inherit',
  enabled                       BOOLEAN NOT NULL DEFAULT TRUE,
  priority                      INTEGER NOT NULL DEFAULT 100,
  severity                      alert_severity,
  cooldown_seconds              INTEGER CHECK (cooldown_seconds IS NULL OR cooldown_seconds >= 0),
  deduplication_window_seconds  INTEGER CHECK (deduplication_window_seconds IS NULL OR deduplication_window_seconds >= 0),
  auto_resolve_after_minutes    INTEGER CHECK (auto_resolve_after_minutes IS NULL OR auto_resolve_after_minutes > 0),
  evaluation_interval_seconds   INTEGER CHECK (evaluation_interval_seconds IS NULL OR evaluation_interval_seconds > 0),
  consecutive_breaches          INTEGER CHECK (consecutive_breaches IS NULL OR consecutive_breaches >= 1),
  threshold_overrides           JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_mode                   alert_action_merge_mode NOT NULL DEFAULT 'inherit',
  requested_channels            JSONB,
  recipient_overrides           JSONB,
  escalation_policy_id          UUID REFERENCES alert_escalation_policies(id) ON DELETE SET NULL,
  notes                         TEXT,
  created_by                    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by                    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ,
  CONSTRAINT ck_alert_rule_binding_scope_shape CHECK (
  (scope_type = 'organization' AND scope_level = 0
  AND project_id IS NULL AND environment IS NULL AND service IS NULL AND endpoint IS NULL) OR
  (scope_type = 'project' AND scope_level = 1
  AND project_id IS NOT NULL AND environment IS NULL AND service IS NULL AND endpoint IS NULL) OR
  (scope_type = 'environment' AND scope_level = 2
  AND project_id IS NOT NULL AND environment IS NOT NULL AND service IS NULL AND endpoint IS NULL) OR
  (scope_type = 'service' AND scope_level = 3
  AND project_id IS NOT NULL AND service IS NOT NULL AND endpoint IS NULL) OR
  (scope_type = 'endpoint' AND scope_level = 4
  AND project_id IS NOT NULL AND endpoint IS NOT NULL)
  ),
  CONSTRAINT ck_alert_rule_binding_environment CHECK (
  environment IS NULL OR (
  char_length(environment) BETWEEN 1 AND 64
  AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
  ),
  CONSTRAINT ck_alert_rule_binding_threshold_overrides CHECK (
  jsonb_typeof(threshold_overrides) = 'object'
  ),
  CONSTRAINT ck_alert_rule_binding_requested_channels CHECK (
  requested_channels IS NULL OR jsonb_typeof(requested_channels) = 'array'
  ),
  CONSTRAINT ck_alert_rule_binding_recipient_overrides CHECK (
  recipient_overrides IS NULL OR jsonb_typeof(recipient_overrides) = 'object'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rule_binding_scope
  ON alert_rule_bindings (rule_id, scope_type, project_id, environment, service, endpoint)
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rule_bindings_resolve
  ON alert_rule_bindings (organization_id, rule_id, scope_level DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rule_bindings_project
  ON alert_rule_bindings (project_id, scope_level DESC)
  WHERE deleted_at IS NULL AND project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rule_bindings_escalation
  ON alert_rule_bindings (escalation_policy_id)
  WHERE deleted_at IS NULL AND escalation_policy_id IS NOT NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alert_incidents.sql
-- ============================================================

-- Normalized final definition for alert_incidents.
--
-- Incidents are APPLICATION/CONTROL-PLANE state and are therefore owned by the
-- PRIMARY database (ADR-0006). The Log DB keeps telemetry, evidence, and the
-- high-volume alert event facts; it must not be the authoritative incident store.
--
-- NAME COLLISION (deliberate, documented):
--   database/migrations/logdb/06_alert_runtime/005_incidents_preferences.up.sql
--   creates a table also called `alert_incidents` in the LOG DB. That table is
--   dead schema - no TypeScript reads or writes it - and it is unusable for this
--   purpose for two reasons:
--     1. it has no project_id, so incidents cannot be scoped to a project;
--     2. it declares a FULL `UNIQUE (organization_id, fingerprint)`, which
--        permanently blocks a SECOND incident for the same fingerprint after the
--        first one resolves. Recurrence is a core requirement, so a full unique
--        constraint is simply wrong here (see uq_alert_incident_active below).
--   The Log DB copy is slated for removal; it still has an inbound FK from
--   alert_correlation_groups, so removing it is a separate, sequenced migration.
--
-- WRITE-VOLUME NOTE (ingestion safety):
--   Rows here are created per DISTINCT ALERT IDENTITY (fingerprint), never per
--   telemetry event. Repeated matches update `last_seen_at`/`occurrence_count` on
--   an existing row instead of inserting. Explicit autovacuum parameters are set
--   at the bottom so this table's churn cannot starve autovacuum workers that
--   `pgboss.job` (also in this database) depends on.

-- Incident lifecycle states. Intentionally a small, closed vocabulary rather
-- than reusing the 8-value alert_event_status: an incident is an operational
-- occurrence with exactly three meaningful terminal-facing states.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_incident_status') THEN
    CREATE TYPE alert_incident_status AS ENUM ('open', 'acknowledged', 'resolved');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS alert_incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenancy. project_id is REQUIRED product semantics: the global incident list
  -- must be filterable by project, and incident authorization is project-scoped.
  -- Nullable only to represent a genuinely organization-level rule with no
  -- project scope; the fingerprint encodes the project either way.
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id            UUID REFERENCES projects(id) ON DELETE CASCADE,
  environment           VARCHAR(64),

  -- Provenance: which rule, at which revision, produced this incident.
  rule_id               UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_revision         INTEGER,
  binding_id            UUID REFERENCES alert_rule_bindings(id) ON DELETE SET NULL,

  -- Canonical alert identity from alertIdentityHash(). Already encodes
  -- org + project + environment + rule + policy revision + grouping dimensions,
  -- which is why the active-uniqueness index below does not need to repeat them.
  fingerprint           VARCHAR(255) NOT NULL,
  -- Human-readable grouping key ('global', or 'route=/users/:id|service=api').
  dimension_key         VARCHAR(500) NOT NULL DEFAULT 'global',

  status                alert_incident_status NOT NULL DEFAULT 'open',
  severity              alert_severity NOT NULL DEFAULT 'warning',
  title                 VARCHAR(500) NOT NULL,

  -- Grouping dimensions promoted to columns because the incident list filters
  -- and sorts on them at the database level.
  service               VARCHAR(255),
  route                 VARCHAR(500),

  -- Latest evaluation snapshot. Enough for the incident list/detail to render
  -- "current vs threshold" without querying the Log DB. NOT a telemetry dump.
  observed_value        NUMERIC(20,6),
  threshold_value       NUMERIC(20,6),

  occurrence_count      INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),

  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to           UUID REFERENCES users(id) ON DELETE SET NULL,

  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_reason     VARCHAR(100),

  labels                JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Lifecycle integrity: a state and its timestamp cannot disagree. These are
  -- the DB-level guard against a partially-applied transition.
  CONSTRAINT ck_alert_incident_resolved_shape CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL)
    OR (status <> 'resolved' AND resolved_at IS NULL)
  ),
  CONSTRAINT ck_alert_incident_acknowledged_shape CHECK (
    status <> 'acknowledged' OR acknowledged_at IS NOT NULL
  ),
  CONSTRAINT ck_alert_incident_labels CHECK (jsonb_typeof(labels) = 'object')
);

-- ── Active-incident uniqueness (Phase 6) ────────────────────────────────────
-- THE correctness backstop. Repeated evaluations of the same logical alert must
-- not create duplicate ACTIVE incidents, and application-level
-- "SELECT then INSERT" is race-prone by construction.
--
-- PARTIAL on active statuses so that:
--   * at most ONE open/acknowledged incident exists per (org, fingerprint);
--   * unlimited RESOLVED history is retained, so a later breach legitimately
--     creates a NEW incident (recurrence). A full UNIQUE would forbid this -
--     that is the bug in the Log DB copy of this table.
--
-- fingerprint already encodes project/environment/rule/revision/dimensions, so
-- (organization_id, fingerprint) is the minimal correct key. organization_id is
-- kept as the leading column for tenant-scoped index locality.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_incident_active
  ON alert_incidents (organization_id, fingerprint)
  WHERE status IN ('open', 'acknowledged');

-- ── Query-driven indexes (Phase 5 / Phase 24) ───────────────────────────────
-- Every index below maps to a specific query this feature actually issues. No
-- index exists merely because a column exists.

-- Default incident list: tenant-scoped, newest first, optional status filter.
-- Serves `GET /alerts/incidents` with and without ?status=.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_status_started
  ON alert_incidents (organization_id, status, started_at DESC);

-- Project-scoped list, the most common filtered view in the UI, and the
-- project-scoped authorization check.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_project_started
  ON alert_incidents (organization_id, project_id, started_at DESC);

-- "Active incidents" widgets (overview page counts, rule health) and the
-- resolve-by-fingerprint path in the evaluator. Partial: only active rows are
-- ever queried this way, which keeps the index small on a table whose bulk is
-- resolved history.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_active_lookup
  ON alert_incidents (organization_id, fingerprint, status)
  WHERE status IN ('open', 'acknowledged');

-- Per-rule incident counts + "last triggered" on the Alert Rules page.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_rule
  ON alert_incidents (rule_id, started_at DESC)
  WHERE rule_id IS NOT NULL;

-- Severity facet on the incident list, and critical-incident overview counts.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_severity_started
  ON alert_incidents (organization_id, severity, started_at DESC);

-- `sortBy=lastSeenAt` (the other supported sort) and the recency feed.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_last_seen
  ON alert_incidents (organization_id, last_seen_at DESC);

-- "Resolved today" / MTTR-style overview metrics over a bounded window.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_resolved
  ON alert_incidents (organization_id, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;

-- Deliberately NOT indexed:
--   environment, service, route, assigned_to, dimension_key
-- These are low-selectivity secondary facets that always co-occur with
-- organization_id, so the leading composite indexes above already restrict the
-- scan to a small tenant slice. Add them only if EXPLAIN on real data shows a
-- problem; each costs write amplification on an alerting write path.

-- ── Autovacuum (ingestion safety) ───────────────────────────────────────────
-- Active incidents are updated repeatedly (last_seen_at/occurrence_count), so
-- this table produces dead tuples out of proportion to its row count. Tighter
-- per-table thresholds keep its bloat local and stop it from monopolising the
-- shared autovacuum workers that pgboss.job (same database) relies on.
ALTER TABLE alert_incidents SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

COMMENT ON TABLE alert_incidents IS
  'Authoritative incident lifecycle (PRIMARY db). One ACTIVE row per canonical alert fingerprint, enforced by uq_alert_incident_active; resolved rows are retained so recurrence creates a new incident.';
COMMENT ON COLUMN alert_incidents.fingerprint IS
  'Canonical alert identity from alertIdentityHash(): org:project:env:rule:policy:dimensionKey.';
COMMENT ON COLUMN alert_incidents.occurrence_count IS
  'Number of matched evaluations folded into this incident. Incremented on reuse, never by inserting a new row.';

-- ============================================================
-- Source: 09_alerting/001_create_alert_metrics.sql
-- ============================================================

-- Normalized final definition for alert_metrics.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  metric_type VARCHAR(50) NOT NULL,
  value NUMERIC NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  bucket_end TIMESTAMPTZ NOT NULL,
  granularity metric_granularity NOT NULL DEFAULT 'hour',
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_metric_bucket
  ON alert_metrics(
    organization_id,
    metric_type,
    COALESCE(rule_id, '00000000-0000-0000-0000-000000000000'::uuid),
    bucket_start,
    granularity
  );

CREATE INDEX IF NOT EXISTS idx_alert_metrics_lookup
  ON alert_metrics(organization_id, metric_type, granularity, bucket_start DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alert_templates.sql
-- ============================================================

-- Normalized final definition for alert_templates.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/013_create_alert_templates.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  template_type VARCHAR(50) NOT NULL DEFAULT 'body',
  content TEXT NOT NULL,
  variables_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_for_severity alert_severity,
  connector_type connector_type,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sample_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_template_name_per_org
  ON alert_templates(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_templates_org
  ON alert_templates(organization_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alert_routing_rules.sql
-- ============================================================

-- Normalized final definition for alert_routing_rules.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/014_create_alert_routing_rules.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_connector_ids UUID[] NOT NULL DEFAULT '{}',
  target_route_ids UUID[] NOT NULL DEFAULT '{}',
  fallback_connector_ids UUID[] NOT NULL DEFAULT '{}',
  template_id UUID REFERENCES alert_templates(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_routing_rule_name_per_org
  ON alert_routing_rules(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_routing_rules_active
  ON alert_routing_rules(organization_id, priority DESC)
  WHERE deleted_at IS NULL AND is_active;

-- ============================================================
-- Source: 09_alerting/001_create_alert_rule_actions.sql
-- ============================================================

-- Normalized final definition for alert_rule_actions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/004_create_alert_rule_actions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_rule_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  action_type alert_action_type NOT NULL DEFAULT 'notify',
  priority INTEGER NOT NULL DEFAULT 100,
  order_index INTEGER NOT NULL DEFAULT 0,
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  route_id UUID REFERENCES notification_routes(id) ON DELETE SET NULL,
  template_id UUID,
  escalation_policy_id UUID,
  throttle_duration_seconds INTEGER NOT NULL DEFAULT 0,
  max_notifications_per_hour INTEGER,
  action_conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_actions_rule
  ON alert_rule_actions(rule_id, order_index);

CREATE INDEX IF NOT EXISTS idx_alert_rule_actions_connector
  ON alert_rule_actions(connector_id)
  WHERE connector_id IS NOT NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alert_rule_conditions.sql
-- ============================================================

-- Normalized final definition for alert_rule_conditions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/003_create_alert_rule_conditions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_rule_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  condition_type alert_condition_type NOT NULL DEFAULT 'threshold',
  condition_group_id UUID,
  field_path VARCHAR(500) NOT NULL,
  operator alert_condition_operator NOT NULL,
  threshold_value JSONB,
  lookback_minutes INTEGER,
  aggregate_function VARCHAR(50),
  sub_query JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_conditions_rule
  ON alert_rule_conditions(rule_id);

CREATE INDEX IF NOT EXISTS idx_alert_rule_conditions_group
  ON alert_rule_conditions(condition_group_id)
  WHERE condition_group_id IS NOT NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alert_rule_executions.sql
-- ============================================================

-- Normalized final definition for alert_rule_executions.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_rule_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  matched_count INTEGER NOT NULL DEFAULT 0,
  triggered_count INTEGER NOT NULL DEFAULT 0,
  suppressed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  evaluation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_executions_rule
  ON alert_rule_executions(rule_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_rule_executions_org
  ON alert_rule_executions(organization_id, started_at DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alert_rule_revisions.sql
-- ============================================================

-- Normalized final definition for alert_rule_revisions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/021_create_alert_rule_revisions.up.sql

CREATE TABLE IF NOT EXISTS alert_rule_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id         UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  revision        INTEGER NOT NULL CHECK (revision >= 1),
  change_kind     VARCHAR(40) NOT NULL,
  snapshot        JSONB NOT NULL,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alert_rule_revision UNIQUE (rule_id, revision),
  CONSTRAINT ck_alert_rule_revision_change_kind CHECK (
  change_kind IN ('rule','condition','action','binding')
  ),
  CONSTRAINT ck_alert_rule_revision_snapshot CHECK (
  jsonb_typeof(snapshot) = 'object'
  )
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_revisions_rule
  ON alert_rule_revisions (rule_id, revision DESC);

CREATE INDEX IF NOT EXISTS idx_alert_rule_revisions_org
  ON alert_rule_revisions (organization_id, created_at DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alert_silences.sql
-- ============================================================

-- Normalized final definition for alert_silences.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/007_create_alert_silences.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_silences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  comment TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  matchers JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_silence_duration CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_alert_silences_active
  ON alert_silences(organization_id, is_active, ends_at)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_alert_silences_rule
  ON alert_silences(rule_id, is_active)
  WHERE is_active = TRUE;

-- ============================================================
-- Source: 09_alerting/001_create_alert_throttle_windows.sql
-- ============================================================

-- Normalized final definition for alert_throttle_windows.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_throttle_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_action_id UUID NOT NULL REFERENCES alert_rule_actions(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  notification_count INTEGER NOT NULL DEFAULT 0,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_throttle_window UNIQUE (rule_action_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_alert_throttle_windows_action
  ON alert_throttle_windows(rule_action_id, window_start DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_workspaces.sql
-- ============================================================

-- Normalized final definition for alerting_workspaces.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  initialized_by VARCHAR(100) NOT NULL,
  initialization_version VARCHAR(100) NOT NULL,
  provisioning_status VARCHAR(20) NOT NULL DEFAULT 'initializing'
  CHECK (provisioning_status IN ('initializing', 'ready', 'failed')),
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alerting_workspace_ready_completion CHECK (
  provisioning_status <> 'ready' OR completed_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_alerting_workspaces_status
  ON alerting_workspaces(provisioning_status, updated_at DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_audit_events.sql
-- ============================================================

-- Normalized final definition for alerting_audit_events.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql

CREATE TABLE IF NOT EXISTS alerting_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  actor_type VARCHAR(30) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provisioning_version VARCHAR(100),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_audit_payload CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_audit_events_workspace_time
  ON alerting_audit_events(workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_alerting_audit_events_org_entity
  ON alerting_audit_events(organization_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerting_audit_events_type
  ON alerting_audit_events(organization_id, event_type, created_at DESC);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_audit_roots.sql
-- ============================================================

-- Normalized final definition for alerting_audit_roots.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql

CREATE TABLE IF NOT EXISTS alerting_audit_roots (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  root_version INTEGER NOT NULL DEFAULT 1 CHECK (root_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_dashboard_widgets.sql
-- ============================================================

-- Normalized final definition for alerting_dashboard_widgets.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_dashboard_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  widget_key VARCHAR(100) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  position JSONB NOT NULL DEFAULT '{}'::jsonb,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_dashboard_widget UNIQUE (workspace_id, widget_key),
  CONSTRAINT ck_alerting_dashboard_position CHECK (jsonb_typeof(position) = 'object'),
  CONSTRAINT ck_alerting_dashboard_configuration CHECK (jsonb_typeof(configuration) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_dashboard_widgets_workspace_position
  ON alerting_dashboard_widgets(workspace_id, is_visible, widget_key);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_entitlements.sql
-- ============================================================

-- Normalized final definition for alerting_entitlements.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_entitlements (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
  plan_key VARCHAR(100) NOT NULL,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_version INTEGER NOT NULL DEFAULT 1 CHECK (source_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_entitlements_limits CHECK (jsonb_typeof(limits) = 'object'),
  CONSTRAINT ck_alerting_entitlements_features CHECK (jsonb_typeof(features) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_entitlements_org
  ON alerting_entitlements(organization_id);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_escalation_policies_v2.sql
-- ============================================================

-- Normalized final definition for alerting_escalation_policies_v2.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_escalation_policies_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  system_key VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  acknowledgement_timeout_seconds INTEGER NOT NULL CHECK (acknowledgement_timeout_seconds >= 0),
  repeat_interval_seconds INTEGER NOT NULL CHECK (repeat_interval_seconds >= 0),
  max_repeats INTEGER NOT NULL CHECK (max_repeats >= 0),
  cancellation_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_escalation_policy_org_key UNIQUE (organization_id, system_key),
  CONSTRAINT ck_alerting_escalation_cancellation_rules CHECK (jsonb_typeof(cancellation_rules) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_escalation_policies_org_default
  ON alerting_escalation_policies_v2(organization_id, is_default, system_key);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_escalation_steps_v2.sql
-- ============================================================

-- Normalized final definition for alerting_escalation_steps_v2.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_escalation_steps_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES alerting_escalation_policies_v2(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL CHECK (step_number >= 1),
  wait_seconds INTEGER NOT NULL CHECK (wait_seconds >= 0),
  connector_ids UUID[] NOT NULL DEFAULT '{}',
  route_ids UUID[] NOT NULL DEFAULT '{}',
  notify_on_call BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_escalation_step UNIQUE (policy_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_alerting_escalation_steps_policy
  ON alerting_escalation_steps_v2(policy_id, step_number);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_legacy_mappings.sql
-- ============================================================

-- Normalized final definition for alerting_legacy_mappings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/022_alerting_consolidation_support.up.sql

CREATE TABLE IF NOT EXISTS alerting_legacy_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  legacy_source VARCHAR(64) NOT NULL,
  legacy_source_id UUID NOT NULL,
  canonical_rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  canonical_binding_id UUID REFERENCES alert_rule_bindings(id) ON DELETE SET NULL,
  source_revision VARCHAR(128),
  source_hash VARCHAR(64),
  mapping_status VARCHAR(24) NOT NULL DEFAULT 'pending'
  CHECK (mapping_status IN ('pending','mapped','quarantined','verified','failed')),
  mapping_error TEXT,
  checkpoint VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_legacy_mapping_source UNIQUE (legacy_source, legacy_source_id),
  CONSTRAINT ck_alerting_legacy_mapping_tenant CHECK (
  project_id IS NULL OR organization_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_alerting_legacy_mappings_pending
  ON alerting_legacy_mappings (organization_id, mapping_status, updated_at)
  WHERE mapping_status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS idx_alerting_legacy_mappings_canonical
  ON alerting_legacy_mappings (organization_id, canonical_rule_id, canonical_binding_id)
  WHERE canonical_rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alerting_legacy_mappings_project
  ON alerting_legacy_mappings (organization_id, project_id, legacy_source)
  WHERE project_id IS NOT NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alerting_maintenance_config.sql
-- ============================================================

-- Normalized final definition for alerting_maintenance_config.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql

CREATE TABLE IF NOT EXISTS alerting_maintenance_config (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  suppression_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recurring_support_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_suppression_settings JSONB NOT NULL DEFAULT '{"suppressNotifications":true,"suppressEvaluation":false}'::jsonb,
  calendar_metadata JSONB NOT NULL DEFAULT '{"windows":[]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_maintenance_suppression CHECK (jsonb_typeof(default_suppression_settings) = 'object'),
  CONSTRAINT ck_alerting_maintenance_calendar CHECK (jsonb_typeof(calendar_metadata) = 'object')
);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_notification_defaults.sql
-- ============================================================

-- Normalized final definition for alerting_notification_defaults.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql

CREATE TABLE IF NOT EXISTS alerting_notification_defaults (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  business_hours JSONB NOT NULL DEFAULT '{"enabled":true,"start":"09:00","end":"17:00","days":[1,2,3,4,5]}'::jsonb,
  quiet_hours JSONB NOT NULL DEFAULT '{"enabled":false,"start":"22:00","end":"07:00"}'::jsonb,
  fallback_behavior VARCHAR(30) NOT NULL DEFAULT 'dashboard'
  CHECK (fallback_behavior IN ('dashboard', 'email', 'drop')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_notification_business_hours CHECK (jsonb_typeof(business_hours) = 'object'),
  CONSTRAINT ck_alerting_notification_quiet_hours CHECK (jsonb_typeof(quiet_hours) = 'object')
);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_policy_categories.sql
-- ============================================================

-- Normalized final definition for alerting_policy_categories.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_policy_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_policy_category_org_slug UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_categories_org_order
  ON alerting_policy_categories(organization_id, sort_order, slug);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_policy_catalog.sql
-- ============================================================

-- Normalized final definition for alerting_policy_catalog.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_policy_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug VARCHAR(150) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES alerting_policy_categories(id) ON DELETE RESTRICT,
  severity alert_severity NOT NULL,
  default_threshold JSONB NOT NULL DEFAULT '{}'::jsonb,
  recovery_threshold JSONB NOT NULL DEFAULT '{}'::jsonb,
  cooldown_seconds INTEGER NOT NULL CHECK (cooldown_seconds >= 0),
  evaluation_window_seconds INTEGER NOT NULL CHECK (evaluation_window_seconds > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_policy_catalog_org_slug UNIQUE (organization_id, slug),
  CONSTRAINT ck_alerting_policy_catalog_threshold_object CHECK (jsonb_typeof(default_threshold) = 'object'),
  CONSTRAINT ck_alerting_policy_catalog_recovery_object CHECK (jsonb_typeof(recovery_threshold) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_catalog_org_category
  ON alerting_policy_catalog(organization_id, category_id, enabled);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_catalog_org_severity
  ON alerting_policy_catalog(organization_id, severity, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerting_policy_catalog_id_org
  ON alerting_policy_catalog(id, organization_id);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_policy_versions.sql
-- ============================================================

-- Normalized final definition for alerting_policy_versions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
-- - migrations/002_create_all_ordered.sql
-- - canonical_migrations_draft/18_alerting_workspace/010_add_subscription_tenant_keys.up.sql

CREATE TABLE IF NOT EXISTS alerting_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES alerting_policy_catalog(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  definition JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_policy_version UNIQUE (policy_id, version),
  CONSTRAINT ck_alerting_policy_version_definition CHECK (jsonb_typeof(definition) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_versions_org_created
  ON alerting_policy_versions(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerting_policy_versions_policy
  ON alerting_policy_versions(policy_id, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerting_policy_versions_policy_org
  ON alerting_policy_versions(policy_id, organization_id);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_project_policy_subscriptions.sql
-- ============================================================

-- Normalized final definition for alerting_project_policy_subscriptions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_project_policy_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES alerting_policy_catalog(id) ON DELETE CASCADE,
  state VARCHAR(20) NOT NULL DEFAULT 'subscribed'
  CHECK (state IN ('subscribed', 'paused', 'muted', 'disabled', 'archived')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_alerting_project_policy_subscription_id_org UNIQUE (id, organization_id),
  CONSTRAINT fk_alerting_policy_subscription_policy_tenant
  FOREIGN KEY (policy_id, organization_id) REFERENCES alerting_policy_catalog(id, organization_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerting_project_policy_subscription_live
  ON alerting_project_policy_subscriptions(project_id, policy_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerting_project_policy_subscriptions_org_project
  ON alerting_project_policy_subscriptions(organization_id, project_id, state)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerting_project_policy_subscriptions_policy
  ON alerting_project_policy_subscriptions(organization_id, policy_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alerting_project_policy_overrides.sql
-- ============================================================

-- Normalized final definition for alerting_project_policy_overrides.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_project_policy_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES alerting_project_policy_subscriptions(id) ON DELETE CASCADE,
  threshold JSONB,
  cooldown_seconds INTEGER CHECK (cooldown_seconds IS NULL OR cooldown_seconds >= 0),
  channels JSONB,
  severity alert_severity,
  maintenance_windows JSONB,
  evaluation_window_seconds INTEGER CHECK (evaluation_window_seconds IS NULL OR evaluation_window_seconds > 0),
  environment VARCHAR(100),
  escalation_policy_id UUID REFERENCES alerting_escalation_policies_v2(id) ON DELETE SET NULL,
  mute_schedule JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_project_policy_override UNIQUE (subscription_id),
  CONSTRAINT ck_alerting_override_channels CHECK (channels IS NULL OR jsonb_typeof(channels) = 'array'),
  CONSTRAINT ck_alerting_override_maintenance CHECK (maintenance_windows IS NULL OR jsonb_typeof(maintenance_windows) = 'array'),
  CONSTRAINT ck_alerting_override_mute CHECK (mute_schedule IS NULL OR jsonb_typeof(mute_schedule) = 'object'),
  CONSTRAINT fk_alerting_override_subscription_tenant
  FOREIGN KEY (subscription_id, organization_id) REFERENCES alerting_project_policy_subscriptions(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alerting_project_policy_overrides_org_subscription
  ON alerting_project_policy_overrides(organization_id, subscription_id);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_provider_catalog.sql
-- ============================================================

-- Normalized final definition for alerting_provider_catalog.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/004_create_alerting_provider_catalog.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_provider_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key VARCHAR(50) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'not_configured'
  CHECK (status IN ('not_configured', 'available', 'disabled')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_provider_catalog_org_key UNIQUE (organization_id, provider_key),
  CONSTRAINT ck_alerting_provider_capabilities CHECK (jsonb_typeof(capabilities) = 'object'),
  CONSTRAINT ck_alerting_provider_metadata CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_provider_catalog_org_status
  ON alerting_provider_catalog(organization_id, status, provider_key);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_routing_defaults.sql
-- ============================================================

-- Normalized final definition for alerting_routing_defaults.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_routing_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  destination_type VARCHAR(30) NOT NULL CHECK (destination_type IN ('email', 'dashboard', 'none')),
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  route_id UUID REFERENCES notification_routes(id) ON DELETE SET NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_routing_default UNIQUE (organization_id, severity, priority),
  CONSTRAINT ck_alerting_routing_default_config CHECK (jsonb_typeof(config) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_routing_defaults_org_severity
  ON alerting_routing_defaults(organization_id, severity, priority);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_saved_views.sql
-- ============================================================

-- Normalized final definition for alerting_saved_views.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  view_key VARCHAR(100) NOT NULL,
  name VARCHAR(150) NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_saved_view UNIQUE (workspace_id, view_key),
  CONSTRAINT ck_alerting_saved_view_filters CHECK (jsonb_typeof(filters) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_saved_views_workspace_system
  ON alerting_saved_views(workspace_id, is_system, view_key);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_search_index_metadata.sql
-- ============================================================

-- Normalized final definition for alerting_search_index_metadata.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql

CREATE TABLE IF NOT EXISTS alerting_search_index_metadata (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  enabled_entities JSONB NOT NULL DEFAULT '{"policies":true,"incidents":false,"events":false}'::jsonb,
  last_rebuild_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_search_entities CHECK (jsonb_typeof(enabled_entities) = 'object')
);

-- ============================================================
-- Source: 09_alerting/001_create_alerting_settings.sql
-- ============================================================

-- Normalized final definition for alerting_settings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_settings (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  default_evaluation_window_seconds INTEGER NOT NULL DEFAULT 300 CHECK (default_evaluation_window_seconds > 0),
  default_cooldown_seconds INTEGER NOT NULL DEFAULT 900 CHECK (default_cooldown_seconds >= 0),
  retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days > 0),
  default_severity alert_severity NOT NULL DEFAULT 'warning',
  default_routing_key VARCHAR(100) NOT NULL DEFAULT 'severity_default',
  default_escalation_policy_id UUID REFERENCES alerting_escalation_policies_v2(id) ON DELETE SET NULL,
  maximum_incident_age_seconds INTEGER NOT NULL DEFAULT 604800 CHECK (maximum_incident_age_seconds > 0),
  digest_defaults JSONB NOT NULL DEFAULT '{"enabled":true,"frequency":"daily"}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_settings_digest_defaults CHECK (jsonb_typeof(digest_defaults) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_settings_escalation
  ON alerting_settings(default_escalation_policy_id)
  WHERE default_escalation_policy_id IS NOT NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alerting_usage_counters.sql
-- ============================================================

-- Normalized final definition for alerting_usage_counters.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_usage_counters (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  policies_count BIGINT NOT NULL DEFAULT 0 CHECK (policies_count >= 0),
  custom_policies_count BIGINT NOT NULL DEFAULT 0 CHECK (custom_policies_count >= 0),
  project_subscriptions_count BIGINT NOT NULL DEFAULT 0 CHECK (project_subscriptions_count >= 0),
  notifications_count BIGINT NOT NULL DEFAULT 0 CHECK (notifications_count >= 0),
  sms_count BIGINT NOT NULL DEFAULT 0 CHECK (sms_count >= 0),
  connector_deliveries_count BIGINT NOT NULL DEFAULT 0 CHECK (connector_deliveries_count >= 0),
  incidents_count BIGINT NOT NULL DEFAULT 0 CHECK (incidents_count >= 0),
  maintenance_windows_count BIGINT NOT NULL DEFAULT 0 CHECK (maintenance_windows_count >= 0),
  escalations_count BIGINT NOT NULL DEFAULT 0 CHECK (escalations_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerting_usage_counters_org
  ON alerting_usage_counters(organization_id);

-- ============================================================
-- Source: 09_alerting/001_create_project_alert_channels.sql
-- ============================================================

-- Normalized final definition for project_alert_channels.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
-- - canonical_migrations_draft/06_connectors/014_link_project_routing.up.sql

CREATE TABLE IF NOT EXISTS project_alert_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connector_id UUID,
  channel_type VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  destination TEXT,
  destination_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_project_alert_channels_active ON project_alert_channels(organization_id,project_id,channel_type) WHERE enabled AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_alert_channel_default ON project_alert_channels(project_id,channel_type) WHERE is_default AND enabled AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_alert_channels_org_proj_enabled
  ON project_alert_channels (organization_id, project_id, enabled)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 09_alerting/001_create_project_alert_thresholds.sql
-- ============================================================

-- Normalized final definition for project_alert_thresholds.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql

CREATE TABLE IF NOT EXISTS project_alert_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE CASCADE,
  threshold_key VARCHAR(100) NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  metric_source VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  comparison_operator VARCHAR(10) NOT NULL CHECK(comparison_operator IN ('>','>=','<','<=','=','!=')),
  threshold_value NUMERIC(20,5) NOT NULL,
  threshold_unit VARCHAR(50) NOT NULL,
  evaluation_window_minutes INTEGER NOT NULL DEFAULT 5 CHECK(evaluation_window_minutes>0),
  cooldown_minutes INTEGER NOT NULL DEFAULT 15 CHECK(cooldown_minutes>=0),
  consecutive_breaches INTEGER NOT NULL DEFAULT 1 CHECK(consecutive_breaches>0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  notify_on_recovery BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  last_recovered_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_threshold_key ON project_alert_thresholds(project_id,environment_id,threshold_key) NULLS NOT DISTINCT WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_thresholds_evaluation ON project_alert_thresholds(organization_id,project_id,environment_id,enabled) WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 09_alerting/001_create_project_member_alert_channel_preferences.sql
-- ============================================================

-- Normalized final definition for project_member_alert_channel_preferences.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql

CREATE TABLE IF NOT EXISTS project_member_alert_channel_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_alert_channel_id UUID NOT NULL REFERENCES project_alert_channels(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL DEFAULT 'all',
  severity_threshold VARCHAR(20) NOT NULL DEFAULT 'warning',
  enabled BOOLEAN NOT NULL DEFAULT true,
  digest_mode VARCHAR(30) NOT NULL DEFAULT 'immediate',
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(project_id,user_id,project_alert_channel_id,category)
);

CREATE INDEX IF NOT EXISTS idx_member_alert_preferences_delivery
  ON project_member_alert_channel_preferences(project_id,user_id,enabled,severity_threshold) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_member_alert_prefs_lookup
  ON project_member_alert_channel_preferences (organization_id, project_id, user_id, project_alert_channel_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 09_alerting/002_create_alert_incident_events.sql
-- ============================================================

-- Normalized final definition for alert_incident_events.
--
-- FILENAME PREFIX IS LOAD-BEARING: this file is `002_`, not `001_`.
-- run-primary-draft-folder.ts applies a folder's .sql files in LEXICOGRAPHIC
-- order. As `001_create_alert_incident_events.sql` this sorted BEFORE
-- `001_create_alert_incidents.sql` ('_' = 0x5F < 's' = 0x73), so the FK below
-- referenced a table that did not exist yet and the run failed with
-- 42P01 relation "alert_incidents" does not exist.
-- Any table with an FK to another table in this same folder must sort after it.
--
-- Durable incident LIFECYCLE timeline, co-located with alert_incidents in the
-- PRIMARY database.
--
-- WHY THIS TABLE EXISTS (and is not just a read of the Log DB):
--   The incident timeline was previously reconstructed from
--   `alert_event_history_v2` in the Log DB. That table is
--   `PARTITION BY RANGE (created_at)` and the Log DB's stated policy is that
--   "continuously growing event, usage, runtime, audit ... tables are
--   range-partitioned to support retention pruning"
--   (logdb/00_shared/001_foundation.up.sql). So incident timelines would be
--   silently pruned out from under resolved incidents - the exact failure mode
--   that put alert_incidents in the primary database in the first place.
--   Postmortems, MTTR analysis, and compliance review all need the lifecycle of
--   an incident to outlive telemetry retention.
--
-- SCOPE - deliberately narrow:
--   Only LIFECYCLE transitions live here (opened, breach re-observed,
--   acknowledged, assigned, resolved, escalated, notification-created). These
--   are a handful of rows per incident, so the table is low-volume and durable.
--   High-volume per-retry delivery attempts stay in the Log DB
--   (`alert_delivery_attempts_v2`), where partition pruning is correct: an
--   individual SMTP retry is evidence, not lifecycle. The incident detail view
--   therefore reads lifecycle from here (authoritative) and delivery attempts
--   from the Log DB (best-effort enrichment).
--
-- INGESTION SAFETY: written only from the alert worker process and from the
-- incident API, never from the ingestion request path. Volume is bounded by
-- incident count, not telemetry count.

CREATE TABLE IF NOT EXISTS alert_incident_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  incident_id       UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
  -- Denormalized tenancy so the activity feed can filter by tenant/project
  -- without joining alert_incidents on every row.
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE CASCADE,

  /* Lifecycle event kind. Free-form VARCHAR rather than an enum because new
     lifecycle events are additive and should not require a type migration; the
     CHECK keeps it a closed set that is cheap to extend. */
  kind              VARCHAR(48) NOT NULL,
  actor_type        VARCHAR(16) NOT NULL DEFAULT 'worker',
  actor_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,

  /* Small structured detail (occurrence count, observed value, reason).
     NOT a telemetry payload - evidence stays in the Log DB. */
  detail            JSONB NOT NULL DEFAULT '{}'::jsonb,

  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ck_alert_incident_event_kind CHECK (kind IN (
    'incident_opened',
    'condition_still_breaching',
    'incident_acknowledged',
    'incident_assigned',
    'incident_resolved',
    'incident_reopened',
    'incident_escalated',
    'notification_created',
    'notification_suppressed'
  )),
  CONSTRAINT ck_alert_incident_event_actor CHECK (
    actor_type IN ('worker', 'user', 'system', 'api')
  ),
  CONSTRAINT ck_alert_incident_event_detail CHECK (jsonb_typeof(detail) = 'object')
);

-- ── Query-driven indexes ────────────────────────────────────────────────────

-- Per-incident timeline, newest first. The incident detail page's only query.
CREATE INDEX IF NOT EXISTS idx_alert_incident_events_incident
  ON alert_incident_events (incident_id, occurred_at DESC);

-- Global Activity feed: tenant-scoped, newest first, optional kind filter.
CREATE INDEX IF NOT EXISTS idx_alert_incident_events_org_occurred
  ON alert_incident_events (organization_id, occurred_at DESC);

-- Project-filtered activity feed.
CREATE INDEX IF NOT EXISTS idx_alert_incident_events_org_project_occurred
  ON alert_incident_events (organization_id, project_id, occurred_at DESC)
  WHERE project_id IS NOT NULL;

-- Deliberately NOT indexed: kind, actor_type, actor_user_id. They are
-- low-selectivity facets that always co-occur with organization_id, so the
-- composites above already restrict the scan to a small tenant slice.

ALTER TABLE alert_incident_events SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.1
);

COMMENT ON TABLE alert_incident_events IS
  'Durable incident lifecycle timeline (PRIMARY db). Outlives Log DB telemetry retention. Lifecycle only - per-retry delivery attempts remain in alert_delivery_attempts_v2.';

-- ============================================================
-- Source: 11_observability/001_create_backpressure_gauge.sql
-- ============================================================

-- Normalized final definition for backpressure_gauge.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS backpressure_gauge (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pending_depth BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_worker_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_backpressure_gauge_updated
  ON backpressure_gauge(updated_at);

-- ============================================================
-- Source: 11_observability/001_create_cron_checkins.sql
-- ============================================================

-- Normalized final definition for cron_checkins.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS cron_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  monitor_slug VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL,
  duration_ms DOUBLE PRECISION,
  environment VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_cron_monitor_time ON cron_checkins(project_id, monitor_slug, timestamp DESC);

-- ============================================================
-- Source: 11_observability/001_create_cron_checkins_default.sql
-- ============================================================

-- Normalized final definition for cron_checkins_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS cron_checkins_default PARTITION OF cron_checkins DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_error_groups.sql
-- ============================================================

-- Normalized final definition for error_groups.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  occurrences BIGINT NOT NULL DEFAULT 1,
  last_message TEXT,
  error_type VARCHAR(256),
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_active ON error_groups(project_id, last_seen DESC) WHERE is_resolved = FALSE;

-- ============================================================
-- Source: 11_observability/001_create_errors.sql
-- ============================================================

-- Normalized final definition for errors.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS errors (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  message TEXT NOT NULL,
  error_type VARCHAR(256) NOT NULL DEFAULT 'UnknownError',
  fingerprint VARCHAR(128) NOT NULL,
  severity VARCHAR(16),
  stack JSONB,
  context JSONB,
  breadcrumbs JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  session_id VARCHAR(64),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_errors_fingerprint ON errors(project_id, fingerprint, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_errors_trace ON errors(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_errors_project_time ON errors(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_errors_unresolved ON errors(project_id, timestamp DESC) WHERE resolved_at IS NULL;

-- ============================================================
-- Source: 11_observability/001_create_errors_default.sql
-- ============================================================

-- Normalized final definition for errors_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS errors_default PARTITION OF errors DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_events_cron_checkins.sql
-- ============================================================

-- Normalized final definition for events_cron_checkins.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_cron_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  monitor_slug VARCHAR(255) NOT NULL,
  status cron_status NOT NULL,
  duration_ms INTEGER,
  environment VARCHAR(64),
  trace_id VARCHAR(64),
  request_id VARCHAR(64),
  service VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_cron_checkins_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_crons_org_slug
  ON events_cron_checkins(organization_id, monitor_slug, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_crons_brin_time
  ON events_cron_checkins USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_cron_checkins_project_event
  ON events_cron_checkins(project_id, event_id) NULLS NOT DISTINCT;

-- ============================================================
-- Source: 11_observability/001_create_events_errors.sql
-- ============================================================

-- Normalized final definition for events_errors.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  error_name VARCHAR(256) NOT NULL,
  severity event_severity NOT NULL DEFAULT 'error',
  stack_hash VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  source VARCHAR(100) NOT NULL DEFAULT 'capture',
  mechanism VARCHAR(50),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  server_name VARCHAR(100),
  stack_frames JSONB,
  source_context JSONB,
  user_id VARCHAR(255),
  user_email VARCHAR(255),
  user_ip INET,
  breadcrumbs JSONB,
  tags JSONB DEFAULT '{}',
  extra JSONB DEFAULT '{}',
  contexts JSONB DEFAULT '{}',
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_errors_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_errors_org_time
  ON events_errors(organization_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_errors_severity
  ON events_errors(organization_id, severity, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_errors_service
  ON events_errors(organization_id, service, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_errors_user
  ON events_errors(organization_id, user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_errors_brin_time
  ON events_errors USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_errors_project_event
  ON events_errors(project_id, event_id) NULLS NOT DISTINCT;

-- ============================================================
-- Source: 11_observability/001_create_events_logs.sql
-- ============================================================

-- Normalized final definition for events_logs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  level log_level NOT NULL,
  message TEXT NOT NULL,
  logger VARCHAR(255),
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  tags JSONB DEFAULT '{}',
  context JSONB DEFAULT '{}',
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_logs_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_logs_org_level_time
  ON events_logs(organization_id, level, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_logs_message
  ON events_logs USING GIN (to_tsvector('english', message));

CREATE INDEX IF NOT EXISTS idx_logs_brin_time
  ON events_logs USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_logs_project_event
  ON events_logs(project_id, event_id) NULLS NOT DISTINCT;

-- ============================================================
-- Source: 11_observability/001_create_events_messages.sql
-- ============================================================

-- Normalized final definition for events_messages.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  severity event_severity NOT NULL DEFAULT 'info',
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  user_id VARCHAR(255),
  user_ip INET,
  tags JSONB DEFAULT '{}',
  contexts JSONB DEFAULT '{}',
  breadcrumbs JSONB,
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_messages_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_messages_org_time
  ON events_messages(organization_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_messages_brin_time
  ON events_messages USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_messages_project_event
  ON events_messages(project_id, event_id) NULLS NOT DISTINCT;

-- ============================================================
-- Source: 11_observability/001_create_events_metrics.sql
-- ============================================================

-- Normalized final definition for events_metrics.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  metric_type VARCHAR(50) NOT NULL,
  metric_unit VARCHAR(50),
  metric_namespace VARCHAR(255),
  metric_description TEXT,
  value DOUBLE PRECISION,
  unit VARCHAR(50),
  tags JSONB NOT NULL DEFAULT '{}',
  attributes JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  payload JSONB NOT NULL DEFAULT '{}',
  count DOUBLE PRECISION,
  sum DOUBLE PRECISION,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  avg DOUBLE PRECISION,
  rate DOUBLE PRECISION,
  buckets JSONB,
  p50 DOUBLE PRECISION,
  p75 DOUBLE PRECISION,
  p90 DOUBLE PRECISION,
  p95 DOUBLE PRECISION,
  p99 DOUBLE PRECISION,
  metric_category VARCHAR(50),
  aggregation_type VARCHAR(50),
  temporality VARCHAR(32),
  is_monotonic BOOLEAN,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  tenant_id VARCHAR(255),
  endpoint VARCHAR(500),
  http_method VARCHAR(10),
  status_code INTEGER,
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  application_name VARCHAR(100),
  application_version VARCHAR(50),
  server_name VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ai_response JSONB,
  CONSTRAINT events_metrics_metric_category_ck CHECK (metric_category IS NULL OR metric_category IN ('http','database','cache','queue','runtime','system','business','application','network','memory','cpu','disk','custom')),
  CONSTRAINT events_metrics_aggregation_type_ck CHECK (aggregation_type IS NULL OR aggregation_type IN ('counter','gauge','histogram','summary','observable_counter','observable_gauge','up_down_counter')),
  CONSTRAINT events_metrics_temporality_ck CHECK (temporality IS NULL OR temporality IN ('delta','cumulative','unspecified')),
  CONSTRAINT events_metrics_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_metrics_org_name_time
  ON events_metrics(organization_id, metric_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_project_metric_time
  ON events_metrics(project_id, metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_project_env_time
  ON events_metrics(project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_name_occurred
  ON events_metrics(metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_endpoint_time
  ON events_metrics(organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_http_method_time
  ON events_metrics(organization_id, project_id, http_method, occurred_at DESC)
  WHERE http_method IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metrics_tags
  ON events_metrics USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_events_metrics_attributes_gin
  ON events_metrics USING GIN (attributes);

CREATE INDEX IF NOT EXISTS idx_metrics_brin_time
  ON events_metrics USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_metrics_project_event
  ON events_metrics(project_id, event_id) NULLS NOT DISTINCT;

-- ============================================================
-- Source: 11_observability/001_create_events_profiles.sql
-- ============================================================

-- Normalized final definition for events_profiles.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  profile_type VARCHAR(50) NOT NULL,
  format VARCHAR(50),
  duration_ms INTEGER,
  sample_count INTEGER,
  profile JSONB,
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_profiles_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_profiles_org_time
  ON events_profiles(organization_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_brin_time
  ON events_profiles USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_profiles_project_event
  ON events_profiles(project_id, event_id) NULLS NOT DISTINCT;

-- ============================================================
-- Source: 11_observability/001_create_events_replays.sql
-- ============================================================

-- Normalized final definition for events_replays.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_replays (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  segment_id INTEGER NOT NULL,
  events JSONB NOT NULL,
  trace_id VARCHAR(64),
  user_id VARCHAR(255),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_replays_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_replays_org_session
  ON events_replays(organization_id, session_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_replays_brin_time
  ON events_replays USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_replays_project_event
  ON events_replays(project_id, event_id) NULLS NOT DISTINCT;

-- ============================================================
-- Source: 11_observability/001_create_events_requests.sql
-- ============================================================

-- Normalized final definition for events_requests.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  url TEXT NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  route VARCHAR(500),
  framework VARCHAR(50),
  headers JSONB,
  query_params JSONB,
  body JSONB,
  body_size INTEGER,
  response_size INTEGER,
  user_id VARCHAR(255),
  tenant_id VARCHAR(255),
  session_id VARCHAR(64),
  client_ip INET,
  user_agent TEXT,
  referer TEXT,
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  is_slow BOOLEAN GENERATED ALWAYS AS (latency_ms > 1000) STORED,
  is_error BOOLEAN GENERATED ALWAYS AS (status_code >= 500) STORED,
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_requests_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_requests_org_time
  ON events_requests(organization_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_requests_slow
  ON events_requests(organization_id, timestamp DESC)
  WHERE is_slow = TRUE;

CREATE INDEX IF NOT EXISTS idx_requests_user
  ON events_requests(organization_id, user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_brin_time
  ON events_requests USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_requests_project_event
  ON events_requests(project_id, event_id) NULLS NOT DISTINCT;

-- ============================================================
-- Source: 11_observability/001_create_events_spans.sql
-- ============================================================

-- Normalized final definition for events_spans.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  span_id VARCHAR(64) NOT NULL,
  trace_id VARCHAR(64) NOT NULL,
  parent_span_id VARCHAR(64),
  name VARCHAR(500) NOT NULL,
  span_kind TEXT,
  span_type TEXT,
  span_status TEXT,
  message TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_ms INTEGER,
  exclusive_duration_ms INTEGER,
  attributes JSONB DEFAULT '{}',
  events JSONB,
  links JSONB,
  db_system VARCHAR(50),
  db_name VARCHAR(100),
  db_operation VARCHAR(50),
  db_collection VARCHAR(100),
  db_statement TEXT,
  http_method VARCHAR(10),
  http_url TEXT,
  http_status_code INTEGER,
  http_host VARCHAR(255),
  http_route VARCHAR(500),
  messaging_system VARCHAR(50),
  messaging_destination VARCHAR(255),
  messaging_operation VARCHAR(50),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id VARCHAR(255),
  tenant_id VARCHAR(255),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_spans_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_spans_org_time
  ON events_spans(organization_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_spans_name
  ON events_spans(organization_id, name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_spans_db
  ON events_spans(organization_id, db_system, timestamp DESC)
  WHERE db_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_http
  ON events_spans(organization_id, http_route, timestamp DESC)
  WHERE http_route IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_brin_time
  ON events_spans USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_spans_project_event
  ON events_spans(project_id, event_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_spans_trace_time_asc
  ON events_spans(organization_id, trace_id, timestamp ASC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_span_id
  ON events_spans(organization_id, span_id)
  WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_slow_db
  ON events_spans(organization_id, db_system, duration_ms DESC, timestamp DESC)
  WHERE db_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_db_collection
  ON events_spans(organization_id, db_collection, timestamp DESC)
  WHERE db_collection IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_session_time
  ON events_spans(organization_id, session_id, timestamp DESC)
  WHERE session_id IS NOT NULL;

-- ============================================================
-- Source: 11_observability/001_create_events_traces.sql
-- ============================================================

-- Normalized final definition for events_traces.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_traces (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  trace_id VARCHAR(64) NOT NULL,
  root_span_name VARCHAR(500),
  root_span_id VARCHAR(64),
  span_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,
  is_partial BOOLEAN DEFAULT FALSE,
  spans_tree JSONB,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id VARCHAR(255),
  tenant_id VARCHAR(255),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_traces_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_traces_org_time
  ON events_traces(organization_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_traces_trace_id
  ON events_traces(organization_id, trace_id);

CREATE INDEX IF NOT EXISTS idx_traces_brin_time
  ON events_traces USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_traces_project_event
  ON events_traces(project_id, event_id) NULLS NOT DISTINCT;

-- ============================================================
-- Source: 11_observability/001_create_feature_flags.sql
-- ============================================================

-- Normalized final definition for feature_flags.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/17_enterprise_ingestion/003_feature_flags.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('platform', 'organization', 'project')),
  scope_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_feature_flags_scope_id CHECK (
  (scope = 'platform' AND scope_id IS NULL)
  OR (scope IN ('organization', 'project') AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_flags_key_scope
  ON feature_flags(key, scope, scope_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_feature_flags_scope
  ON feature_flags(scope, scope_id);

-- ============================================================
-- Source: 11_observability/001_create_ingestion_admin_logs.sql
-- ============================================================

-- Normalized final definition for ingestion_admin_logs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ingestion_admin_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  log_level VARCHAR(16) NOT NULL CHECK (log_level IN ('debug', 'info', 'warn', 'error', 'fatal')),
  category VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  org_id UUID,
  project_id UUID,
  job_id UUID,
  event_id VARCHAR(64),
  worker_id VARCHAR(128),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created
  ON ingestion_admin_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_logs_category
  ON ingestion_admin_logs(category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_logs_project
  ON ingestion_admin_logs(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_logs_level
  ON ingestion_admin_logs(log_level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_logs_metadata
  ON ingestion_admin_logs USING GIN (metadata);

-- ============================================================
-- Source: 11_observability/001_create_ingestion_admin_logs_default.sql
-- ============================================================

-- Normalized final definition for ingestion_admin_logs_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ingestion_admin_logs_default
  PARTITION OF ingestion_admin_logs DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_ingestion_dead_letter_jobs.sql
-- ============================================================

-- Normalized final definition for ingestion_dead_letter_jobs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ingestion_dead_letter_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_job_id UUID,
  queue VARCHAR(64) NOT NULL,
  job_type VARCHAR(64) NOT NULL,
  org_id UUID,
  project_id UUID,
  payload JSONB NOT NULL,
  dedupe_key VARCHAR(256),
  attempts SMALLINT NOT NULL,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  last_error TEXT NOT NULL,
  error_code VARCHAR(64),
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed_at TIMESTAMPTZ,
  replayed_by VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_queue_time
  ON ingestion_dead_letter_jobs(queue, failed_at);

CREATE INDEX IF NOT EXISTS idx_dlq_project
  ON ingestion_dead_letter_jobs(project_id, failed_at)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dlq_unreplayed
  ON ingestion_dead_letter_jobs(failed_at)
  WHERE replayed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dlq_original_job
  ON ingestion_dead_letter_jobs(original_job_id)
  WHERE original_job_id IS NOT NULL;

-- ============================================================
-- Source: 11_observability/001_create_ingestion_failures.sql
-- ============================================================

-- Normalized final definition for ingestion_failures.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID,
  org_id UUID,
  event_type VARCHAR(32),
  reason VARCHAR(64) NOT NULL,
  detail TEXT,
  raw_excerpt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_failures_project ON ingestion_failures(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_failures_reason ON ingestion_failures(reason, created_at DESC);

-- ============================================================
-- Source: 11_observability/001_create_ingestion_jobs.sql
-- ============================================================

-- Normalized final definition for ingestion_jobs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue VARCHAR(64) NOT NULL DEFAULT 'ingestion',
  job_type VARCHAR(64) NOT NULL CHECK (job_type IN (
  'error', 'message', 'request', 'span', 'trace',
  'metric', 'log', 'profile', 'cron_checkin', 'replay'
  )),
  priority SMALLINT NOT NULL DEFAULT 100 CHECK (priority >= 0 AND priority <= 1000),
  priority_label ingestion_job_priority GENERATED ALWAYS AS (
  CASE
  WHEN priority <= 10 THEN 'critical'::ingestion_job_priority
  WHEN priority <= 50 THEN 'high'::ingestion_job_priority
  WHEN priority <= 80 THEN 'normal'::ingestion_job_priority
  WHEN priority <= 95 THEN 'low'::ingestion_job_priority
  ELSE 'background'::ingestion_job_priority
  END
  ) STORED,
  org_id UUID,
  project_id UUID,
  payload JSONB NOT NULL,
  event_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id VARCHAR(64),
  tenant_id VARCHAR(64),
  dedupe_key VARCHAR(256),
  state ingestion_job_state NOT NULL DEFAULT 'pending',
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 50),
  max_attempts SMALLINT NOT NULL DEFAULT 3 CHECK (max_attempts >= 1 AND max_attempts <= 50),
  locked_until TIMESTAMPTZ,
  locked_by VARCHAR(128),
  heartbeat_at TIMESTAMPTZ,
  last_error TEXT,
  error_code VARCHAR(64),
  processed_by VARCHAR(128),
  processing_duration_ms INTEGER CHECK (processing_duration_ms IS NULL OR processing_duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim
  ON ingestion_jobs(queue, priority ASC, run_at ASC, created_at ASC)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim_typed
  ON ingestion_jobs(queue, job_type, priority ASC, run_at ASC)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_lease
  ON ingestion_jobs(locked_until, state)
  WHERE state = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_dedupe
  ON ingestion_jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_project
  ON ingestion_jobs(project_id, state, priority)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_org_state
  ON ingestion_jobs(org_id, state)
  WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_event_id
  ON ingestion_jobs(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_trace_id
  ON ingestion_jobs(trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_completed
  ON ingestion_jobs(completed_at)
  WHERE state = 'completed';

-- ============================================================
-- Source: 11_observability/001_create_logs.sql
-- ============================================================

-- Normalized final definition for logs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  level VARCHAR(16) NOT NULL,
  message TEXT NOT NULL,
  args JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_logs_project_time ON logs(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(project_id, level, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs(project_id, trace_id) WHERE trace_id IS NOT NULL;

-- ============================================================
-- Source: 11_observability/001_create_logs_default.sql
-- ============================================================

-- Normalized final definition for logs_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS logs_default PARTITION OF logs DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_messages.sql
-- ============================================================

-- Normalized final definition for messages.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS messages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  message TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL,
  context JSONB,
  breadcrumbs JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_messages_project_time ON messages(project_id, severity, timestamp DESC);

-- ============================================================
-- Source: 11_observability/001_create_messages_default.sql
-- ============================================================

-- Normalized final definition for messages_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS messages_default PARTITION OF messages DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_metrics.sql
-- ============================================================

-- Normalized final definition for metrics.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  metric_name VARCHAR(255) NOT NULL,
  metric_type VARCHAR(16) NOT NULL,
  value DOUBLE PRECISION,
  unit VARCHAR(32),
  count BIGINT,
  sum DOUBLE PRECISION,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  avg DOUBLE PRECISION,
  buckets JSONB,
  tags JSONB,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON metrics(project_id, metric_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_tags_gin ON metrics USING GIN (tags);

-- ============================================================
-- Source: 11_observability/001_create_metrics_default.sql
-- ============================================================

-- Normalized final definition for metrics_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS metrics_default PARTITION OF metrics DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_profiles.sql
-- ============================================================

-- Normalized final definition for profiles.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  profile_type VARCHAR(16) NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms DOUBLE PRECISION,
  profile JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_profiles_project_time ON profiles(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_trace ON profiles(project_id, trace_id) WHERE trace_id IS NOT NULL;

-- ============================================================
-- Source: 11_observability/001_create_profiles_default.sql
-- ============================================================

-- Normalized final definition for profiles_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS profiles_default PARTITION OF profiles DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_replays.sql
-- ============================================================

-- Normalized final definition for replays.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS replays (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  session_id VARCHAR(64) NOT NULL,
  segment_id INTEGER NOT NULL,
  events JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_replays_session ON replays(project_id, session_id, segment_id);

-- ============================================================
-- Source: 11_observability/001_create_replays_default.sql
-- ============================================================

-- Normalized final definition for replays_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS replays_default PARTITION OF replays DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_requests.sql
-- ============================================================

-- Normalized final definition for requests.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  request_id VARCHAR(64),
  url TEXT,
  method VARCHAR(10),
  status_code INTEGER,
  latency_ms DOUBLE PRECISION,
  body_size INTEGER,
  response_size INTEGER,
  user_id TEXT,
  tenant_id VARCHAR(128),
  session_id VARCHAR(64),
  client_ip INET,
  user_agent TEXT,
  referer TEXT,
  route TEXT,
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  headers JSONB,
  query JSONB,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_requests_route ON requests(project_id, route, timestamp DESC) WHERE route IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(project_id, status_code, timestamp DESC) WHERE status_code >= 400;

CREATE INDEX IF NOT EXISTS idx_requests_trace ON requests(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_project_time ON requests(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_requests_latency ON requests(project_id, latency_ms, timestamp DESC);

-- ============================================================
-- Source: 11_observability/001_create_requests_default.sql
-- ============================================================

-- Normalized final definition for requests_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS requests_default PARTITION OF requests DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_sdk_sessions.sql
-- ============================================================

-- Normalized final definition for sdk_sessions.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS sdk_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  session_id VARCHAR(64) NOT NULL,
  started_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  event_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  crashed BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16),
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sdk_sessions_unique ON sdk_sessions(project_id, session_id, timestamp);

-- ============================================================
-- Source: 11_observability/001_create_sdk_sessions_default.sql
-- ============================================================

-- Normalized final definition for sdk_sessions_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS sdk_sessions_default PARTITION OF sdk_sessions DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_spans.sql
-- ============================================================

-- Normalized final definition for spans.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS spans (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  trace_id VARCHAR(64) NOT NULL,
  span_id VARCHAR(64) NOT NULL,
  parent_span_id VARCHAR(64),
  name TEXT NOT NULL,
  kind VARCHAR(16),
  status VARCHAR(16),
  status_message TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_ms DOUBLE PRECISION,
  exclusive_duration_ms DOUBLE PRECISION,
  attributes JSONB,
  events JSONB,
  links JSONB,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(project_id, trace_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(project_id, parent_span_id) WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spans_project_time ON spans(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_spans_attrs_gin ON spans USING GIN (attributes);

-- ============================================================
-- Source: 11_observability/001_create_spans_default.sql
-- ============================================================

-- Normalized final definition for spans_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS spans_default PARTITION OF spans DEFAULT;

-- ============================================================
-- Source: 11_observability/001_create_traces.sql
-- ============================================================

-- Normalized final definition for traces.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS traces (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  trace_id VARCHAR(64) NOT NULL,
  root_span JSONB NOT NULL,
  span_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms DOUBLE PRECISION,
  is_partial BOOLEAN NOT NULL DEFAULT FALSE,
  root_name TEXT,
  has_error BOOLEAN NOT NULL DEFAULT FALSE,
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_unique ON traces(project_id, trace_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_traces_project_time ON traces(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_traces_errors ON traces(project_id, timestamp DESC) WHERE has_error = TRUE;

-- ============================================================
-- Source: 11_observability/001_create_traces_default.sql
-- ============================================================

-- Normalized final definition for traces_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS traces_default PARTITION OF traces DEFAULT;

-- ============================================================
-- Source: 12_usage/001_create_usage_counter_staging.sql
-- ============================================================

-- Normalized final definition for usage_counter_staging.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/13_ingestion/010_add_usage_counter_staging_dimensions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE UNLOGGED TABLE IF NOT EXISTS usage_counter_staging (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL,
  org_id UUID NOT NULL,
  counter_type VARCHAR(64) NOT NULL,
  increment_by NUMERIC(14, 4) NOT NULL DEFAULT 1 CHECK (increment_by > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  api_key_id UUID,
  event_type TEXT NOT NULL DEFAULT 'all'
);

CREATE INDEX IF NOT EXISTS idx_usage_staging_project
  ON usage_counter_staging(project_id, counter_type, created_at);

CREATE INDEX IF NOT EXISTS idx_usage_staging_flush
  ON usage_counter_staging(created_at);

CREATE INDEX IF NOT EXISTS idx_usage_staging_api_key
  ON usage_counter_staging(api_key_id, event_type, created_at)
  WHERE api_key_id IS NOT NULL;

-- ============================================================
-- Source: 13_ai/001_create_ai_model_routes.sql
-- ============================================================

-- Normalized final definition for ai_model_routes.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/011_ai_model_routes.up.sql

CREATE TABLE IF NOT EXISTS ai_model_routes (
  route_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_mode TEXT NOT NULL,
  plan TEXT,
  tenant_id UUID,
  primary_model TEXT NOT NULL,
  fallback_model TEXT,
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.2
  CHECK (temperature >= 0 AND temperature <= 2),
  max_tokens INTEGER NOT NULL DEFAULT 4096 CHECK (max_tokens > 0),
  timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (timeout_ms >= 1000),
  priority INTEGER NOT NULL DEFAULT 100,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_model_routes_lookup
  ON ai_model_routes (ai_mode, plan, tenant_id)
  WHERE status = 'active';

-- ============================================================
-- Source: 13_ai/001_create_ai_prompt_templates.sql
-- ============================================================

-- Normalized final definition for ai_prompt_templates.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/010_ai_prompt_templates.up.sql

CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_mode TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  template_body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
  CHECK (status IN ('active', 'draft', 'deprecated')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ai_mode, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_active
  ON ai_prompt_templates (ai_mode)
  WHERE status = 'active';

-- ============================================================
-- Source: 13_ai/002_create_ai_requests_responses.sql
-- ============================================================

-- AI Requests, Responses, Feedback, Jobs, and Cache for PrimaryDB
CREATE TABLE IF NOT EXISTS ai_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  input_hash TEXT,
  cache_key TEXT,
  model_route TEXT,
  provider TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  status TEXT,
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_requests_tenant_time
  ON ai_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_tenant_mode
  ON ai_requests (tenant_id, ai_mode);
CREATE INDEX IF NOT EXISTS idx_ai_requests_cache_key
  ON ai_requests (cache_key)
  WHERE cache_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_responses (
  response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ai_requests(request_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  answer JSONB,
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  credit_action JSONB,
  status TEXT,
  prompt_template_version TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_responses_request
  ON ai_responses (request_id);
CREATE INDEX IF NOT EXISTS idx_ai_responses_tenant_time
  ON ai_responses (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_responses_tenant_mode
  ON ai_responses (tenant_id, ai_mode);

CREATE TABLE IF NOT EXISTS ai_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES ai_requests(request_id) ON DELETE SET NULL,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  helpful BOOLEAN,
  correction TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_response
  ON ai_feedback (response_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_tenant_time
  ON ai_feedback (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input_hash TEXT,
  input_ciphertext TEXT,
  idempotency_key TEXT,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  model_route TEXT,
  pgboss_job_id TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_status
  ON ai_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_time
  ON ai_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_pgboss
  ON ai_jobs (pgboss_job_id)
  WHERE pgboss_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_mode TEXT NOT NULL,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (ttl_seconds >= 0),
  etag TEXT,
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_tenant_mode
  ON ai_cache (tenant_id, ai_mode);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expiry
  ON ai_cache (expires_at)
  WHERE invalidated_at IS NULL;

-- ============================================================
-- Source: 13_ai/003_create_ai_conversations_chat.sql
-- ============================================================

-- AI Conversations, Chat Requests, Messages, and Tool Calls for PrimaryDB
CREATE TABLE IF NOT EXISTS ai_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (conversation_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS ai_chat_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('processing','success','failed')),
  response JSONB,
  provider VARCHAR(50),
  model VARCHAR(100),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  completed_at TIMESTAMPTZ,
  usage_logged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES ai_conversations(conversation_id, tenant_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (request_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS ai_conversation_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  request_id UUID,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, request_id, role),
  FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES ai_conversations(conversation_id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id, tenant_id)
    REFERENCES ai_chat_requests(request_id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  invocation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  arguments JSONB NOT NULL,
  result JSONB,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  status VARCHAR(20) NOT NULL CHECK (status IN ('success','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (request_id, tenant_id)
    REFERENCES ai_chat_requests(request_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant_user
  ON ai_conversations (tenant_id, user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_chat_requests_pending_usage
  ON ai_chat_requests (completed_at) WHERE status = 'success' AND usage_logged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_time
  ON ai_conversation_messages (tenant_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_request
  ON ai_tool_calls (tenant_id, request_id, created_at);

-- ============================================================
-- Source: 13_ai/004_create_ai_knowledge_and_evaluations.sql
-- ============================================================

-- Knowledge Documents, Chunks, Evaluations, Reports, and Usage Receipts for PrimaryDB
CREATE TABLE IF NOT EXISTS knowledge_documents (
  document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  uri TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum TEXT NOT NULL,
  access_control JSONB NOT NULL DEFAULT '{}'::jsonb,
  service_tags TEXT[] NOT NULL DEFAULT '{}',
  environment_tags TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','deleted')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, source_type, checksum)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_documents(document_id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content_summary TEXT NOT NULL,
  embedding VECTOR(1536),
  access_control JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_weight NUMERIC(4,3) NOT NULL DEFAULT 1 CHECK (confidence_weight BETWEEN 0 AND 1),
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content_summary)) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_tenant_status
  ON knowledge_documents (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant
  ON knowledge_chunks (tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_fts
  ON knowledge_chunks USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS ai_evaluations (
  evaluation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES ai_responses(response_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_mode TEXT NOT NULL,
  correctness_score NUMERIC(5,2) CHECK (correctness_score BETWEEN 0 AND 100),
  groundedness_score NUMERIC(5,2) CHECK (groundedness_score BETWEEN 0 AND 100),
  safety_score NUMERIC(5,2) CHECK (safety_score BETWEEN 0 AND 100),
  evaluator TEXT NOT NULL,
  dataset_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  report_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  summary JSONB,
  storage_uri TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS ai_usage_receipts (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  feature_key VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, request_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_evaluations_tenant_mode
  ON ai_evaluations (tenant_id, ai_mode, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reports_tenant_period
  ON ai_reports (tenant_id, period_start DESC);

-- ============================================================
-- Source: 14_automation/001_create_automation_workflows.sql
-- ============================================================

-- Normalized final definition for automation_workflows.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/002_automation_workflows.sql
-- - canonical_migrations_draft/19_automation/010_automation_templates.sql

CREATE TABLE IF NOT EXISTS automation_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  template_id UUID NULL,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  description TEXT,
  workflow_type VARCHAR(80) NOT NULL,
  scope automation_workflow_scope NOT NULL DEFAULT 'organization',
  status automation_workflow_status NOT NULL DEFAULT 'draft',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  current_version INTEGER NOT NULL DEFAULT 1,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_workflows_org_scope CHECK (
  (scope = 'organization' AND organization_id IS NOT NULL) OR
  (scope = 'project' AND project_id IS NOT NULL AND organization_id IS NOT NULL) OR
  (scope = 'platform' AND organization_id IS NULL)
  ),
  CONSTRAINT chk_workflows_current_version CHECK (current_version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_workflows_org_slug
  ON automation_workflows(organization_id, slug)
  WHERE deleted_at IS NULL AND scope = 'organization';

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_workflows_project_slug
  ON automation_workflows(project_id, slug)
  WHERE deleted_at IS NULL AND scope = 'project';

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_workflows_platform_slug
  ON automation_workflows(slug)
  WHERE deleted_at IS NULL AND scope = 'platform';

CREATE INDEX IF NOT EXISTS idx_automation_workflows_org_status
  ON automation_workflows(organization_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_org_enabled_next_run
  ON automation_workflows(organization_id, is_enabled, next_run_at)
  WHERE deleted_at IS NULL AND is_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_project_status
  ON automation_workflows(project_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_type_status
  ON automation_workflows(workflow_type, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_tags
  ON automation_workflows USING GIN (tags)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_metadata
  ON automation_workflows USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_automation_workflows_org_updated
  ON automation_workflows (organization_id, is_enabled, status, updated_at DESC)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 14_automation/001_create_automation_workflow_versions.sql
-- ============================================================

-- Normalized final definition for automation_workflow_versions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/003_automation_workflow_versions.sql

CREATE TABLE IF NOT EXISTS automation_workflow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  trigger_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  condition_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  checksum VARCHAR(128) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workflow_versions UNIQUE (workflow_id, version),
  CONSTRAINT chk_workflow_version_definition CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT chk_workflow_version_trigger_summary CHECK (jsonb_typeof(trigger_summary) = 'array'),
  CONSTRAINT chk_workflow_version_condition_summary CHECK (jsonb_typeof(condition_summary) = 'array'),
  CONSTRAINT chk_workflow_version_action_summary CHECK (jsonb_typeof(action_summary) = 'array'),
  CONSTRAINT chk_workflow_version_published CHECK (
  (status != 'published') OR (status = 'published' AND published_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_automation_wv_workflow_version
  ON automation_workflow_versions(workflow_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_automation_wv_workflow_status
  ON automation_workflow_versions(workflow_id, status);

CREATE INDEX IF NOT EXISTS idx_automation_wv_checksum
  ON automation_workflow_versions(checksum);

-- ============================================================
-- Source: 14_automation/001_create_automation_actions.sql
-- ============================================================

-- Normalized final definition for automation_actions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/006_automation_actions.sql

CREATE TABLE IF NOT EXISTS automation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE CASCADE,
  action_key VARCHAR(100) NOT NULL,
  action_type VARCHAR(120) NOT NULL,
  integration_key VARCHAR(80),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  risk_level automation_action_risk NOT NULL DEFAULT 'low',
  timeout_seconds INTEGER NOT NULL DEFAULT 60,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  retry_backoff_seconds INTEGER NOT NULL DEFAULT 30,
  idempotency_key_template VARCHAR(500),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_action_timeout_positive CHECK (timeout_seconds > 0),
  CONSTRAINT chk_action_max_attempts_positive CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_automation_actions_workflow_order
  ON automation_actions(workflow_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_actions_version_order
  ON automation_actions(workflow_version_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_actions_type
  ON automation_actions(action_type, is_enabled)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_actions_risk
  ON automation_actions(risk_level)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 14_automation/001_create_automation_approvals.sql
-- ============================================================

-- Normalized final definition for automation_approvals.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/009_automation_approvals.sql

CREATE TABLE IF NOT EXISTS automation_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  step_id UUID NULL,
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  rejected_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  status automation_approval_status NOT NULL DEFAULT 'pending',
  risk_level automation_action_risk NOT NULL DEFAULT 'high',
  approval_reason TEXT,
  rejection_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_approval_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT chk_approval_approved CHECK (
  status != 'approved' OR (approved_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT chk_approval_rejected CHECK (
  status != 'rejected' OR (rejected_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_automation_approvals_org_status
  ON automation_approvals(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_approvals_run
  ON automation_approvals(run_id);

CREATE INDEX IF NOT EXISTS idx_automation_approvals_step
  ON automation_approvals(step_id);

CREATE INDEX IF NOT EXISTS idx_automation_approvals_pending_expiry
  ON automation_approvals(expires_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_approvals_step_pending_unique
  ON automation_approvals(step_id)
  WHERE status = 'pending' AND step_id IS NOT NULL;

-- ============================================================
-- Source: 14_automation/001_create_automation_conditions.sql
-- ============================================================

-- Normalized final definition for automation_conditions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/005_automation_conditions.sql

CREATE TABLE IF NOT EXISTS automation_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE CASCADE,
  condition_group VARCHAR(80) NOT NULL DEFAULT 'default',
  sort_order INTEGER NOT NULL DEFAULT 0,
  left_path VARCHAR(300) NOT NULL,
  operator automation_condition_operator NOT NULL,
  right_value JSONB,
  value_type VARCHAR(30) NOT NULL DEFAULT 'json',
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_conditions_workflow_group
  ON automation_conditions(workflow_id, condition_group, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_conditions_version
  ON automation_conditions(workflow_version_id, sort_order)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 14_automation/001_create_automation_templates.sql
-- ============================================================

-- Normalized final definition for automation_templates.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/010_automation_templates.sql

CREATE TABLE IF NOT EXISTS automation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key VARCHAR(120) NOT NULL,
  scope automation_template_scope NOT NULL DEFAULT 'platform',
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  workflow_type VARCHAR(80) NOT NULL,
  category VARCHAR(80) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  minimum_plan_tier billing_plan_tier NULL,
  required_feature_key VARCHAR(100),
  tags TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_templates_platform_key
  ON automation_templates(template_key)
  WHERE deleted_at IS NULL AND scope = 'platform';

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_templates_org_key
  ON automation_templates(organization_id, template_key)
  WHERE deleted_at IS NULL AND scope = 'organization';

CREATE INDEX IF NOT EXISTS idx_automation_templates_scope_category
  ON automation_templates(scope, category, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_templates_org_category
  ON automation_templates(organization_id, category)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_templates_feature_key
  ON automation_templates(required_feature_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_templates_tags
  ON automation_templates USING GIN (tags)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_templates_metadata
  ON automation_templates USING GIN (metadata);

-- ============================================================
-- Source: 14_automation/001_create_automation_template_versions.sql
-- ============================================================

-- Normalized final definition for automation_template_versions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/011_automation_template_versions.sql

CREATE TABLE IF NOT EXISTS automation_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES automation_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  definition JSONB NOT NULL,
  trigger_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  condition_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum VARCHAR(128) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_template_versions UNIQUE (template_id, version),
  CONSTRAINT chk_template_version_definition CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT chk_template_version_trigger_summary CHECK (jsonb_typeof(trigger_summary) = 'array'),
  CONSTRAINT chk_template_version_condition_summary CHECK (jsonb_typeof(condition_summary) = 'array'),
  CONSTRAINT chk_template_version_action_summary CHECK (jsonb_typeof(action_summary) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_automation_tv_template_version
  ON automation_template_versions(template_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_automation_tv_current
  ON automation_template_versions(template_id)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_automation_tv_checksum
  ON automation_template_versions(checksum);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_tv_one_current
  ON automation_template_versions(template_id)
  WHERE is_current = TRUE;

-- ============================================================
-- Source: 14_automation/001_create_automation_triggers.sql
-- ============================================================

-- Normalized final definition for automation_triggers.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/004_automation_triggers.sql

CREATE TABLE IF NOT EXISTS automation_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE CASCADE,
  trigger_kind automation_trigger_kind NOT NULL,
  trigger_type VARCHAR(120) NOT NULL,
  source_module VARCHAR(80) NOT NULL,
  source_event VARCHAR(120),
  schedule_cron VARCHAR(120),
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  webhook_secret_hash VARCHAR(255),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  dedupe_key_template VARCHAR(500),
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_trigger_schedule_cron CHECK (
  trigger_kind != 'schedule' OR schedule_cron IS NOT NULL
  ),
  CONSTRAINT chk_trigger_event_source CHECK (
  trigger_kind != 'event' OR source_event IS NOT NULL
  ),
  CONSTRAINT chk_trigger_cooldown_nonneg CHECK (cooldown_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS idx_automation_triggers_source
  ON automation_triggers(source_module, source_event, is_enabled)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_triggers_workflow
  ON automation_triggers(workflow_id, is_enabled)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_triggers_kind_type
  ON automation_triggers(trigger_kind, trigger_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_triggers_config
  ON automation_triggers USING GIN (config);

-- ============================================================
-- Source: 14_automation/002_create_automation_runtime.sql
-- ============================================================

-- =============================================================================
-- Automation RUNTIME tables (PRIMARY database).
--
-- ROOT CAUSE THIS FIXES:
--   These four tables were previously created only in the LOG database
--   (database/migrations/logdb/08_automation_runtime/001_automation_runtime.up.sql)
--   as generic 16-column stubs that did not match the application code at all.
--   The application's AutomationRepository is constructed with the PRIMARY pool
--   (src/modules/automation/automation.module.ts -> new AutomationRepository(pool)),
--   and claimNextStep() JOINs automation_run_steps -> automation_runs ->
--   automation_workflows -> automation_actions. Those control-plane tables live in
--   the PRIMARY database, so a cross-database join is impossible: the runtime
--   tables MUST live here in PRIMARY alongside them.
--
--   Result before this migration: every inbox insert / claim / run creation /
--   step claim failed with "relation does not exist" against PRIMARY.
--
-- Column definitions below are derived directly from the SQL and row mappers in
-- src/modules/automation/repository.ts (toInboxEvent/toRun/toStep) and
-- src/modules/automation/audit.ts (toAuditRow), so the schema and code agree.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Inbox status enum (no pre-existing enum covered these values).
-- Values are exactly those written by repository.ts:
--   insertInboxEvent -> 'pending'
--   claimInboxEvents -> 'processing'
--   completeInboxEvent -> 'processed'
--   failInboxEvent -> 'retry' | 'failed'
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_inbox_status') THEN
    CREATE TYPE automation_inbox_status AS ENUM ('pending', 'processing', 'processed', 'retry', 'failed');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- automation_events_inbox — durable trigger inbox (transactional outbox pattern).
-- Written by insertInboxEvent(); consumed by claimInboxEvents() with SKIP LOCKED.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_events_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: repository.ts supports platform/system events with no org, and
  -- looks them up with `organization_id IS NOT DISTINCT FROM $2`.
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_module VARCHAR(80) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  source_event_id VARCHAR(200),
  dedupe_key VARCHAR(300) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  status automation_inbox_status NOT NULL DEFAULT 'pending',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(120),
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_inbox_attempts_non_negative CHECK (attempts >= 0)
);

-- Required by `ON CONFLICT (organization_id, dedupe_key) DO NOTHING` in
-- insertInboxEvent(). NULLS NOT DISTINCT (PG15+) is essential: without it two
-- system events (organization_id IS NULL) sharing a dedupe_key would BOTH insert,
-- silently breaking deduplication for platform-scoped events.
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_events_inbox_org_dedupe
  ON automation_events_inbox (organization_id, dedupe_key) NULLS NOT DISTINCT;

-- Serves the claimInboxEvents() ordering (ORDER BY received_at ASC) while
-- excluding already-terminal rows, which are the vast majority over time.
CREATE INDEX IF NOT EXISTS idx_automation_events_inbox_claimable
  ON automation_events_inbox (received_at)
  WHERE status IN ('pending', 'retry', 'processing');

-- Supports the retry-due predicate branch of the claim query.
CREATE INDEX IF NOT EXISTS idx_automation_events_inbox_retry_due
  ON automation_events_inbox (next_retry_at)
  WHERE status = 'retry';

CREATE INDEX IF NOT EXISTS idx_automation_events_inbox_org_received
  ON automation_events_inbox (organization_id, received_at DESC);

-- -----------------------------------------------------------------------------
-- automation_runs — one row per triggered workflow execution.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE SET NULL,
  trigger_id UUID NULL REFERENCES automation_triggers(id) ON DELETE SET NULL,
  inbox_event_id UUID NULL REFERENCES automation_events_inbox(id) ON DELETE SET NULL,
  status automation_run_status NOT NULL DEFAULT 'queued',
  trigger_type VARCHAR(120) NOT NULL,
  source_module VARCHAR(80) NOT NULL,
  source_event_id VARCHAR(200),
  dedupe_key VARCHAR(300),
  -- NOT NULL + UNIQUE: createRunWithSteps() always supplies this and relies on a
  -- unique violation (mapped to AutomationConflictError) to make run creation
  -- effectively-once for a given (org, workflow, eventType, sourceEventId).
  idempotency_key VARCHAR(300) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(80),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_run_max_attempts_positive CHECK (max_attempts > 0),
  CONSTRAINT chk_run_attempt_positive CHECK (attempt > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_runs_idempotency_key
  ON automation_runs (idempotency_key);

-- Cooldown + hourly rate-limit gate in workers.ts processInbox():
--   WHERE workflow_id = $1 AND organization_id = $2 AND created_at > NOW() - interval
CREATE INDEX IF NOT EXISTS idx_automation_runs_workflow_org_created
  ON automation_runs (workflow_id, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_org_created
  ON automation_runs (organization_id, created_at DESC);

-- Stale-run recovery sweep scans non-terminal runs only.
CREATE INDEX IF NOT EXISTS idx_automation_runs_active
  ON automation_runs (status, updated_at)
  WHERE status IN ('queued', 'running', 'waiting_approval');

CREATE INDEX IF NOT EXISTS idx_automation_runs_expiry
  ON automation_runs (expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('queued', 'running');



-- -----------------------------------------------------------------------------
-- automation_run_steps — ordered action steps within a run.
-- Claimed sequentially by claimNextStep() (FOR UPDATE OF s SKIP LOCKED).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  action_id UUID NULL REFERENCES automation_actions(id) ON DELETE SET NULL,
  step_key VARCHAR(100) NOT NULL,
  action_type VARCHAR(120) NOT NULL,
  status automation_step_status NOT NULL DEFAULT 'queued',
  sort_order INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approval_id UUID NULL REFERENCES automation_approvals(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(300),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(80),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_step_max_attempts_positive CHECK (max_attempts > 0),
  CONSTRAINT chk_step_attempt_positive CHECK (attempt > 0),
  CONSTRAINT chk_step_sort_order_non_negative CHECK (sort_order >= 0)
);

-- Matches `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL`
-- in createRunWithSteps(). The predicate must match the statement exactly.
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_run_steps_idempotency_key
  ON automation_run_steps (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- claimNextStep() orders by sort_order within a run and checks lower-order blockers.
CREATE INDEX IF NOT EXISTS idx_automation_run_steps_run_order
  ON automation_run_steps (run_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_claimable
  ON automation_run_steps (run_id, sort_order)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_timeout
  ON automation_run_steps (timeout_at)
  WHERE status = 'running' AND timeout_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_approval
  ON automation_run_steps (approval_id)
  WHERE approval_id IS NOT NULL;



-- -----------------------------------------------------------------------------
-- automation_audit_logs — immutable, append-only audit trail.
--
-- `action` is VARCHAR, deliberately NOT the pre-existing automation_audit_action
-- enum: that enum uses underscore labels ('run_queued') while the application
-- emits dotted values ('run.queued', 'run.dead_lettered' — the latter not present
-- in the enum at all). Typing this column as that enum would make every audit
-- insert fail. The app-layer AUDIT_ACTIONS union is the source of truth, and
-- keeping this VARCHAR avoids a migration for every new audit action.
--
-- FKs use ON DELETE SET NULL (never CASCADE) so deleting a workflow can never
-- erase its audit history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  workflow_id UUID NULL REFERENCES automation_workflows(id) ON DELETE SET NULL,
  run_id UUID NULL REFERENCES automation_runs(id) ON DELETE SET NULL,
  step_id UUID NULL REFERENCES automation_run_steps(id) ON DELETE SET NULL,
  approval_id UUID NULL REFERENCES automation_approvals(id) ON DELETE SET NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(40) NOT NULL DEFAULT 'user',
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id UUID,
  request_id VARCHAR(120),
  ip_address INET,
  user_agent TEXT,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- listAuditLogs() filters by org and orders by occurred_at DESC.
CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_org_occurred
  ON automation_audit_logs (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_workflow
  ON automation_audit_logs (workflow_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_run
  ON automation_audit_logs (run_id);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_action
  ON automation_audit_logs (action, occurred_at DESC);

-- ============================================================
-- Source: 14_automation/003_remove_unbacked_automation_templates.sql
-- ============================================================

-- =============================================================================
-- Remove the three platform automation templates whose purpose depends on an
-- entity that does not exist in this product.
--
-- WHY (evidence in docs/automationv2/24-action-inventory-and-decisions.md):
--   release-health-guard              uses release.guard.warn, which is a duplicate
--                                     of notification.send; its release.health_degraded
--                                     trigger also has no producer.
--   open-runbook-for-critical-service uses runbook.open; a live search for runbook%
--                                     tables returned NO TABLES — there is no runbook
--                                     entity anywhere in the schema or codebase.
--   uptime-failure-status-page-draft  uses status_page.update; status_page% returned
--                                     NO TABLES, and there is no `uptime` module in
--                                     src/modules either, so it is doubly unbacked.
--
--   All three reference action types that have been removed from ACTION_TYPES, so a
--   workflow created from these templates would now be rejected at validation time.
--   Leaving the templates in place would offer users a starting point that cannot be
--   saved, let alone executed.
--
-- SAFETY:
--   Deletes are keyed on template_key AND scope='platform', so an organization's own
--   templates are never touched. Ordering removes version rows before template rows
--   to respect the FK. Guarded so any tenant-authored workflow already created from a
--   template is unaffected: automation_workflows.template_id is ON DELETE SET NULL,
--   and no live workflows existed at the time this was written (automation_workflows
--   was empty), so no user work is lost.
--
-- Idempotent: safe to re-run; deletes simply match zero rows the second time.
-- =============================================================================

BEGIN;

DELETE FROM automation_template_versions
 WHERE template_id IN (
   SELECT id FROM automation_templates
    WHERE scope = 'platform'
      AND template_key IN (
        'release-health-guard',
        'open-runbook-for-critical-service',
        'uptime-failure-status-page-draft'
      )
 );

DELETE FROM automation_templates
 WHERE scope = 'platform'
   AND template_key IN (
     'release-health-guard',
     'open-runbook-for-critical-service',
     'uptime-failure-status-page-draft'
   );

COMMIT;

-- ============================================================
-- Source: 15_analytics/001_create_analytics_alerts.sql
-- ============================================================

-- Normalized final definition for analytics_alerts.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/15_analytics/006_create_analytics_config_tables.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  metric VARCHAR(100) NOT NULL,
  operator analytics_alert_operator NOT NULL,
  threshold NUMERIC NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  notification_channels JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org
  ON analytics_alerts(organization_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 15_analytics/001_create_analytics_daily_rollup.sql
-- ============================================================

-- Normalized final definition for analytics_daily_rollup.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket_date DATE NOT NULL,
  error_count INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  span_count INTEGER DEFAULT 0,
  trace_count INTEGER DEFAULT 0,
  metric_count INTEGER DEFAULT 0,
  log_count INTEGER DEFAULT 0,
  profile_count INTEGER DEFAULT 0,
  cron_checkin_count INTEGER DEFAULT 0,
  replay_count INTEGER DEFAULT 0,
  error_fatal_count INTEGER DEFAULT 0,
  error_error_count INTEGER DEFAULT 0,
  error_warning_count INTEGER DEFAULT 0,
  error_info_count INTEGER DEFAULT 0,
  error_debug_count INTEGER DEFAULT 0,
  request_2xx_count INTEGER DEFAULT 0,
  request_3xx_count INTEGER DEFAULT 0,
  request_4xx_count INTEGER DEFAULT 0,
  request_5xx_count INTEGER DEFAULT 0,
  request_avg_latency_ms INTEGER,
  request_p95_latency_ms INTEGER,
  request_p99_latency_ms INTEGER,
  unique_user_count INTEGER DEFAULT 0,
  active_services TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_daily_rollup_unique UNIQUE (organization_id, project_id, bucket_date)
);

-- ============================================================
-- Source: 15_analytics/001_create_analytics_dashboards.sql
-- ============================================================

-- Normalized final definition for analytics_dashboards.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/15_analytics/006_create_analytics_config_tables.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  layout JSONB DEFAULT '{}',
  widgets JSONB DEFAULT '[]',
  is_shared BOOLEAN DEFAULT FALSE,
  shared_token VARCHAR(64),
  created_by UUID NOT NULL,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dashboards_org
  ON analytics_dashboards(organization_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 15_analytics/001_create_analytics_error_groups.sql
-- ============================================================

-- Normalized final definition for analytics_error_groups.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  fingerprint VARCHAR(64) NOT NULL,
  error_name VARCHAR(256) NOT NULL,
  message_template TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  total_count INTEGER DEFAULT 0,
  today_count INTEGER DEFAULT 0,
  week_count INTEGER DEFAULT 0,
  month_count INTEGER DEFAULT 0,
  status error_group_status DEFAULT 'unresolved',
  assigned_to UUID,
  services TEXT[],
  environments TEXT[],
  releases TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_error_groups_unique UNIQUE (organization_id, project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_org_status
  ON analytics_error_groups(organization_id, status, last_seen_at DESC);

-- ============================================================
-- Source: 15_analytics/001_create_analytics_hourly_rollup.sql
-- ============================================================

-- Normalized final definition for analytics_hourly_rollup.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_hourly_rollup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket_hour TIMESTAMPTZ NOT NULL,
  error_count INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  span_count INTEGER DEFAULT 0,
  trace_count INTEGER DEFAULT 0,
  metric_count INTEGER DEFAULT 0,
  log_count INTEGER DEFAULT 0,
  profile_count INTEGER DEFAULT 0,
  cron_checkin_count INTEGER DEFAULT 0,
  replay_count INTEGER DEFAULT 0,
  error_fatal_count INTEGER DEFAULT 0,
  error_error_count INTEGER DEFAULT 0,
  error_warning_count INTEGER DEFAULT 0,
  error_info_count INTEGER DEFAULT 0,
  error_debug_count INTEGER DEFAULT 0,
  request_2xx_count INTEGER DEFAULT 0,
  request_3xx_count INTEGER DEFAULT 0,
  request_4xx_count INTEGER DEFAULT 0,
  request_5xx_count INTEGER DEFAULT 0,
  request_avg_latency_ms INTEGER,
  request_p95_latency_ms INTEGER,
  request_p99_latency_ms INTEGER,
  unique_user_count INTEGER DEFAULT 0,
  active_services TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_hourly_rollup_unique UNIQUE (organization_id, project_id, bucket_hour)
);

-- ============================================================
-- Source: 15_analytics/001_create_analytics_performance_summary.sql
-- ============================================================

-- Normalized final definition for analytics_performance_summary.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_performance_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket_date DATE NOT NULL,
  route VARCHAR(500) NOT NULL,
  method VARCHAR(10),
  p50_latency_ms INTEGER,
  p75_latency_ms INTEGER,
  p90_latency_ms INTEGER,
  p95_latency_ms INTEGER,
  p99_latency_ms INTEGER,
  request_count INTEGER DEFAULT 0,
  rpm NUMERIC,
  error_count INTEGER DEFAULT 0,
  error_rate NUMERIC,
  apdex_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_perf_summary_unique UNIQUE (organization_id, project_id, bucket_date, route, method)
);

CREATE INDEX IF NOT EXISTS idx_perf_summary_org_route
  ON analytics_performance_summary(organization_id, project_id, bucket_date DESC, route);

-- ============================================================
-- Source: 15_analytics/001_create_analytics_saved_queries.sql
-- ============================================================

-- Normalized final definition for analytics_saved_queries.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/15_analytics/006_create_analytics_config_tables.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  query_type VARCHAR(50) NOT NULL,
  query_config JSONB NOT NULL,
  visualization_type VARCHAR(50),
  visualization_config JSONB DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_saved_queries_org
  ON analytics_saved_queries(organization_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Source: 15_analytics/001_create_analytics_user_sessions.sql
-- ============================================================

-- Normalized final definition for analytics_user_sessions.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  session_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(255),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  event_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  pages TEXT[],
  is_crashed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_user_sessions_unique UNIQUE (organization_id, project_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_org
  ON analytics_user_sessions(organization_id, project_id, started_at DESC);

-- ============================================================
-- Source: 16_security/001_create_audit_logs.sql
-- ============================================================

-- Normalized final definition for audit_logs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/09_audit/001_create_audit_logs.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/09_audit/002_enhance_audit_logs.up.sql

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  org_id UUID,
  impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id UUID,
  ip_address INET,
  user_agent TEXT,
  request_id VARCHAR(64),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(32) DEFAULT 'user',
  payload JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_user_time
  ON audit_logs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_org_time
  ON audit_logs(org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_action_time
  ON audit_logs(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_logs(resource_type, resource_id)
  WHERE resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_request
  ON audit_logs(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_metadata_gin
  ON audit_logs USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org
  ON audit_logs(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_project
  ON audit_logs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor_type_id_time
  ON audit_logs(actor_type, actor_id, created_at DESC)
  WHERE actor_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_time_brin
  ON audit_logs USING BRIN (created_at);

-- ============================================================
-- Source: 16_security/001_create_feature_dependencies.sql
-- ============================================================

-- Normalized final definition for feature_dependencies.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS feature_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id UUID NOT NULL REFERENCES billing_features(id) ON DELETE CASCADE,
  depends_on_feature_id UUID NOT NULL REFERENCES billing_features(id) ON DELETE CASCADE,
  dependency_type VARCHAR(20) NOT NULL DEFAULT 'requires',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_feature_dependency_not_self CHECK (feature_id <> depends_on_feature_id),
  CONSTRAINT uq_feature_dependency UNIQUE (feature_id, depends_on_feature_id)
);

CREATE INDEX IF NOT EXISTS idx_feature_dependencies_feature ON feature_dependencies(feature_id);

CREATE INDEX IF NOT EXISTS idx_feature_dependencies_depends_on ON feature_dependencies(depends_on_feature_id);

-- ============================================================
-- Source: 16_security/001_create_tmp_enterprise_billing_feature_seed.sql
-- ============================================================

-- Normalized final definition for tmp_enterprise_billing_feature_seed.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/026_enterprise_module_billing_seed.sql

DROP TABLE IF EXISTS tmp_enterprise_billing_feature_seed;
CREATE TEMP TABLE IF NOT EXISTS tmp_enterprise_billing_feature_seed
(
  feature_key     VARCHAR(100) PRIMARY KEY,
  feature_name    VARCHAR(150) NOT NULL,
  description     TEXT,
  category        billing_feature_category NOT NULL,
  value_type      billing_feature_value_type NOT NULL,
  module          VARCHAR(50),
  is_module_root  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  free_value      TEXT NOT NULL,
  starter_value   TEXT NOT NULL,
  growth_value    TEXT NOT NULL,
  business_value  TEXT NOT NULL,
  enterprise_value TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT PRESERVE ROWS;

-- ============================================================
-- Source: 18_views/001_views.sql
-- ============================================================

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE VIEW ingestion_queue_snapshot AS
SELECT
  queue,
  job_type,
  state,
  priority_label,
  COUNT(*)::bigint AS job_count,
  COUNT(*) FILTER (WHERE attempts > 0)::bigint AS retried_count,
  COALESCE(MIN(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS oldest_age_seconds,
  COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS newest_age_seconds,
  COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS avg_age_seconds
FROM ingestion_jobs
GROUP BY queue, job_type, state, priority_label;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE VIEW project_usage_realtime AS
SELECT
  COALESCE(p.project_id, s.project_id) AS project_id,
  COALESCE(p.org_id, s.org_id) AS org_id,
  COALESCE(p.counter_type, s.counter_type) AS counter_type,
  COALESCE(p.value, 0) + COALESCE(s.unflushed_value, 0) AS total_value,
  p.period_start,
  p.period_end,
  p.updated_at AS last_flushed_at,
  NOW() AS queried_at
FROM project_usage p
FULL OUTER JOIN (
  SELECT
    project_id,
    org_id,
    counter_type,
    date_trunc('hour', created_at) AS period_start,
    SUM(increment_by) AS unflushed_value
FROM usage_counter_staging
GROUP BY project_id, org_id, counter_type, date_trunc('hour', created_at)
) s
  ON p.project_id = s.project_id
 AND p.counter_type = s.counter_type
 AND p.period_start = s.period_start;

CREATE OR REPLACE VIEW api_key_usage_hourly AS
SELECT
  api_key_id,
  project_id,
  organization_id,
  environment_id,
  date_trunc('hour', bucket) AS bucket,
  event_type_id,
  SUM(request_count)::bigint AS request_count,
  SUM(accepted_event_count)::bigint AS accepted_event_count,
  SUM(error_event_count)::bigint AS error_event_count,
  SUM(ingestion_failure_count)::bigint AS ingestion_failure_count,
  SUM(accepted_bytes)::bigint AS accepted_bytes,
  SUM(rate_limited_request_count)::bigint AS rate_limited_request_count
FROM api_key_usage_minute
GROUP BY api_key_id, project_id, organization_id, environment_id, date_trunc('hour', bucket), event_type_id;

CREATE OR REPLACE VIEW api_key_usage_monthly AS
SELECT
  api_key_id,
  project_id,
  organization_id,
  environment_id,
  date_trunc('month', bucket) AS bucket,
  event_type_id,
  SUM(request_count)::bigint AS request_count,
  SUM(accepted_event_count)::bigint AS accepted_event_count,
  SUM(error_event_count)::bigint AS error_event_count,
  SUM(ingestion_failure_count)::bigint AS ingestion_failure_count,
  SUM(accepted_bytes)::bigint AS accepted_bytes,
  SUM(rate_limited_request_count)::bigint AS rate_limited_request_count
FROM api_key_usage_daily
GROUP BY api_key_id, project_id, organization_id, environment_id, date_trunc('month', bucket), event_type_id;

-- Source: canonical_migrations_draft/19_automation/014_automation_indexes_and_views.sql
CREATE OR REPLACE VIEW v_automation_workflow_summaries AS
SELECT
  w.id,
  w.organization_id,
  w.project_id,
  w.created_by,
  w.updated_by,
  w.template_id,
  w.name,
  w.slug,
  w.description,
  w.workflow_type,
  w.scope,
  w.status,
  w.is_enabled,
  w.current_version,
  w.last_run_at,
  w.next_run_at,
  w.timezone,
  w.tags,
  w.metadata,
  w.created_at,
  w.updated_at,
  w.deleted_at,
  COALESCE(tc.trigger_count, 0) AS trigger_count,
  tc.trigger_type,
  COALESCE(ac.action_count, 0) AS action_count,
  COALESCE(ac.action_types, ARRAY[]::text[]) AS action_types,
  COALESCE(ac.action_requires_approval, ARRAY[]::boolean[]) AS action_requires_approval
FROM automation_workflows w
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS trigger_count, MIN(t.trigger_type) AS trigger_type
  FROM automation_triggers t
  WHERE t.workflow_id = w.id
    AND t.workflow_version_id IS NULL
    AND t.deleted_at IS NULL
) tc ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS action_count,
    ARRAY_AGG(a.action_type ORDER BY a.sort_order) AS action_types,
    ARRAY_AGG(a.requires_approval ORDER BY a.sort_order) AS action_requires_approval
  FROM automation_actions a
  WHERE a.workflow_id = w.id
    AND a.workflow_version_id IS NULL
    AND a.deleted_at IS NULL
    AND a.is_enabled = TRUE
) ac ON TRUE
WHERE w.deleted_at IS NULL;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE VIEW v_current_usage AS
SELECT
    organization_id,
    period_start,
    period_end,
    events_used,
    event_limit,
    (event_limit - events_used) AS remaining_events,
    ai_credits_used,
    ai_credit_limit,
    (ai_credit_limit - ai_credits_used) AS remaining_ai_credits,
    projects_used,
    members_used,
    api_keys_used,
    connectors_used,
    alert_rules_used,
    dashboards_used
FROM organization_usage_current_period;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE VIEW v_effective_entitlements AS
SELECT
    os.organization_id,
    bf.feature_key,
    COALESCE(ofo.boolean_value, pfe.boolean_value)     AS boolean_value,
    COALESCE(ofo.integer_value, pfe.integer_value)     AS integer_value,
    COALESCE(ofo.decimal_value, pfe.decimal_value)     AS decimal_value,
    COALESCE(ofo.string_value, pfe.string_value)       AS string_value
FROM organization_subscriptions os
JOIN plans p
  ON p.id = os.plan_id
JOIN plan_feature_entitlements pfe
  ON pfe.plan_id = p.id
JOIN billing_features bf
  ON bf.id = pfe.feature_id
LEFT JOIN organization_feature_overrides ofo
  ON ofo.organization_id = os.organization_id
 AND ofo.feature_id = bf.id
 AND ofo.deleted_at IS NULL
 AND (ofo.expires_at IS NULL OR ofo.expires_at > NOW())
WHERE os.status IN ('trialing','active','past_due');

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE VIEW v_subscription_summary AS
SELECT
    os.organization_id,
    p.name            AS plan_name,
    p.key             AS plan_key,
    p.tier,
    os.status,
    os.billing_interval,
    os.current_period_start,
    os.current_period_end,
    os.cancel_at_period_end
FROM organization_subscriptions os
JOIN plans p
  ON p.id = os.plan_id;

-- ============================================================
-- Source: 17_functions/001_functions.sql
-- ============================================================

-- Source: canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql
CREATE OR REPLACE FUNCTION ai_refund_credit(
  p_owner_id UUID,
  p_request_id TEXT,
  p_idempotency_key TEXT,
  p_ai_mode TEXT,
  p_amount BIGINT,
  p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  original_amount BIGINT;
  refunded_amount BIGINT;
  original_unlimited BOOLEAN;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Refund amount must be positive'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_request_id,0));

  IF EXISTS (
    SELECT 1 FROM credit_ledger
    WHERE owner_type='organization' AND owner_id=p_owner_id AND idempotency_key=p_idempotency_key
  ) THEN RETURN FALSE; END IF;

  SELECT amount,COALESCE((metadata->>'unlimited')::boolean,FALSE)
  INTO original_amount,original_unlimited
  FROM credit_ledger
  WHERE owner_type='organization' AND owner_id=p_owner_id
    AND request_id=p_request_id AND ai_mode=p_ai_mode
    AND direction='debit' AND status='completed'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF original_amount IS NULL THEN
    RAISE EXCEPTION 'No completed AI debit exists for this refund';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO refunded_amount
  FROM credit_ledger
  WHERE owner_type='organization' AND owner_id=p_owner_id
    AND request_id=p_request_id AND ai_mode=p_ai_mode
    AND direction='refund' AND status='completed';

  IF p_amount > original_amount-refunded_amount THEN
    RAISE EXCEPTION 'Refund exceeds remaining refundable AI debit';
  END IF;

  IF NOT original_unlimited THEN
    UPDATE credit_balances
    SET balance=balance+p_amount,version=version+1
    WHERE owner_type='organization' AND owner_id=p_owner_id AND unlimited=FALSE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Refund credit balance is unavailable'; END IF;
  END IF;

  INSERT INTO credit_ledger
    (owner_type,owner_id,request_id,idempotency_key,ai_mode,amount,direction,reason,status,metadata)
  VALUES
    ('organization',p_owner_id,p_request_id,p_idempotency_key,p_ai_mode,p_amount,'refund',
     LEFT(COALESCE(p_reason,'AI credit refund'),500),'completed',
     jsonb_build_object('original_debit_amount',original_amount,'unlimited',original_unlimited));
  RETURN TRUE;
END;
$$;

-- Source: canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql
CREATE OR REPLACE FUNCTION ai_release_stale_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item RECORD;
  released INTEGER := 0;
BEGIN
  PERFORM set_config('ai.allow_ledger_mutation','on',true);
  FOR item IN
    SELECT ledger_id,owner_id,amount,(metadata->>'unlimited')::boolean AS unlimited
    FROM credit_ledger
    WHERE direction='debit' AND status='pending' AND created_at < NOW()-INTERVAL '15 minutes'
    FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT COALESCE(item.unlimited,FALSE) THEN
      UPDATE credit_balances
      SET reserved_credits=GREATEST(0,reserved_credits-item.amount),version=version+1
      WHERE owner_type='organization' AND owner_id=item.owner_id;
    END IF;
    UPDATE credit_ledger SET status='failed',reason='Stale reservation automatically released'
    WHERE ledger_id=item.ledger_id;
    released := released+1;
  END LOOP;
  RETURN released;
END;
$$;

-- Source: migrations/003_project_module_refactor.sql
CREATE OR REPLACE FUNCTION bump_project_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = COALESCE(OLD.version, 1) + 1;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION consume_ai_credits(
    p_organization_id UUID,
    p_credits BIGINT
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET ai_credits_used = ai_credits_used + p_credits,
    last_ai_request_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION create_event_partitions(p_days_ahead INTEGER DEFAULT 7)
RETURNS void AS $$
BEGIN
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION create_future_monthly_partitions(
    p_months_ahead INTEGER DEFAULT 2
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_month DATE;
    i INTEGER;
BEGIN
    FOR i IN 0..p_months_ahead LOOP

        v_month :=
            (date_trunc('month', CURRENT_DATE)
             + make_interval(months => i))::DATE;

        PERFORM create_monthly_partition(
            'connector_deliveries',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_delivery_attempts',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_health_checks',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_audit_logs',
            v_month
        );

    END LOOP;
END;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION create_monthly_partition(
    p_parent_table TEXT,
    p_partition_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_partition_name TEXT;
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- Normalize to first day of month
    v_start_date := date_trunc('month', p_partition_date)::DATE;
    v_end_date := (v_start_date + INTERVAL '1 month')::DATE;

    v_partition_name :=
        format(
            '%s_%s',
            p_parent_table,
            to_char(v_start_date, 'YYYY_MM')
        );

    EXECUTE format(
        '
        CREATE TABLE IF NOT EXISTS %I
        PARTITION OF %I
        FOR VALUES FROM (%L) TO (%L)
        ',
        v_partition_name,
        p_parent_table,
        v_start_date,
        v_end_date
    );

    RAISE NOTICE 'Partition % created.', v_partition_name;

EXCEPTION
WHEN OTHERS THEN
    RAISE EXCEPTION
        'Failed creating partition for table %, month %: %',
        p_parent_table,
        v_start_date,
        SQLERRM;
END;
$$;

-- Source: canonical_migrations_draft/18_ai/003_credit_ledger.up.sql
CREATE OR REPLACE FUNCTION credit_ledger_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('ai.allow_ledger_mutation', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'credit_ledger is append-only: % is not permitted', TG_OP;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/013_configure_project_integrity.up.sql
CREATE OR REPLACE FUNCTION enforce_project_tenant_integrity() RETURNS trigger AS $$
DECLARE expected_org UUID; value_id UUID;
BEGIN
 SELECT org_id INTO expected_org FROM projects WHERE id=NEW.project_id;
 IF expected_org IS NULL OR expected_org<>NEW.organization_id THEN RAISE EXCEPTION 'project/organization tenant mismatch'; END IF;
 value_id:=NULLIF(to_jsonb(NEW)->>'environment_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_environments WHERE id=value_id AND project_id=NEW.project_id AND organization_id=NEW.organization_id AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'environment tenant mismatch'; END IF;
 value_id:=NULLIF(to_jsonb(NEW)->>'api_key_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_api_keys WHERE id=value_id AND project_id=NEW.project_id AND organization_id=NEW.organization_id)
  THEN RAISE EXCEPTION 'API key tenant mismatch'; END IF;
 value_id:=NULLIF(to_jsonb(NEW)->>'connector_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM connector_configs WHERE id=value_id AND organization_id=NEW.organization_id)
  THEN RAISE EXCEPTION 'connector tenant mismatch'; END IF;
 value_id:=NULLIF(to_jsonb(NEW)->>'project_alert_channel_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_alert_channels WHERE id=value_id AND project_id=NEW.project_id AND organization_id=NEW.organization_id AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'alert channel tenant mismatch'; END IF;
 IF TG_TABLE_NAME='project_member_alert_channel_preferences'
    AND (to_jsonb(NEW)->>'deleted_at') IS NULL AND NOT EXISTS(
   SELECT 1 FROM project_members WHERE project_id=NEW.project_id AND organization_id=NEW.organization_id
    AND user_id=(to_jsonb(NEW)->>'user_id')::uuid AND status='active') THEN
   RAISE EXCEPTION 'alert recipient is not an active project member';
 END IF;
 IF TG_TABLE_NAME='project_notification_preferences'
    AND (to_jsonb(NEW)->>'deleted_at') IS NULL AND EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(to_jsonb(NEW)->'default_member_ids') AS member(value)
   WHERE NOT EXISTS(SELECT 1 FROM project_members WHERE project_id=NEW.project_id AND organization_id=NEW.organization_id
     AND user_id=member.value::uuid AND status='active')) THEN
   RAISE EXCEPTION 'default alert recipient is not an active project member';
 END IF;
 IF TG_TABLE_NAME='project_notification_preferences'
    AND (to_jsonb(NEW)->>'deleted_at') IS NULL AND EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(to_jsonb(NEW)->'default_channel_ids') AS channel(value)
   WHERE NOT EXISTS(SELECT 1 FROM project_alert_channels WHERE id=channel.value::uuid AND project_id=NEW.project_id
     AND organization_id=NEW.organization_id AND enabled AND deleted_at IS NULL)) THEN
   RAISE EXCEPTION 'default alert channel tenant mismatch or inactive channel';
 END IF;
 IF TG_TABLE_NAME='project_connector_subscriptions'
    AND (to_jsonb(NEW)->>'deleted_at') IS NULL AND EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(to_jsonb(NEW)->'member_ids') AS member(value)
   WHERE NOT EXISTS(SELECT 1 FROM project_members WHERE project_id=NEW.project_id AND organization_id=NEW.organization_id
     AND user_id=member.value::uuid AND status='active')) THEN
   RAISE EXCEPTION 'connector alert recipient is not an active project member';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION flush_usage_counters()
RETURNS TABLE(flushed_project_id UUID, flushed_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id, project_id, org_id, api_key_id, event_type, counter_type, increment_by, created_at
    FROM usage_counter_staging
    WHERE created_at < NOW() - INTERVAL '5 seconds'
    ORDER BY id
    LIMIT 10000
    FOR UPDATE SKIP LOCKED
  ),
  aggregated AS (
    SELECT
      project_id,
      org_id,
      counter_type,
      date_trunc('hour', created_at) AS period_start,
      date_trunc('hour', created_at) + INTERVAL '1 hour' AS period_end,
      SUM(increment_by) AS total_increment
    FROM batch
    GROUP BY project_id, org_id, counter_type, date_trunc('hour', created_at)
  ),
  keyed AS (
    SELECT
      b.project_id,
      b.org_id,
      b.api_key_id,
      k.environment_id,
      COALESCE(t.id, fallback.id) AS event_type_id,
      date_trunc('minute', b.created_at) AS minute_bucket,
      date_trunc('day', b.created_at) AS day_bucket,
      SUM(b.increment_by) FILTER (WHERE b.counter_type = 'requests') AS request_count,
      SUM(b.increment_by) FILTER (WHERE b.counter_type = 'events') AS accepted_event_count,
      SUM(b.increment_by) FILTER (WHERE b.counter_type = 'errors') AS error_event_count,
      SUM(b.increment_by) FILTER (WHERE b.counter_type = 'ingestion_failures') AS ingestion_failure_count,
      SUM(b.increment_by) FILTER (WHERE b.counter_type = 'bytes_ingested') AS accepted_bytes,
      SUM(b.increment_by) FILTER (WHERE b.counter_type = 'rate_limited') AS rate_limited_request_count
    FROM batch b
    JOIN project_api_keys k ON k.id = b.api_key_id
    LEFT JOIN telemetry_event_types t ON t.name = b.event_type
    JOIN telemetry_event_types fallback ON fallback.name = '__all__'
    WHERE b.api_key_id IS NOT NULL
    GROUP BY b.project_id, b.org_id, b.api_key_id, k.environment_id, COALESCE(t.id, fallback.id),
             date_trunc('minute', b.created_at), date_trunc('day', b.created_at)
  ),
  upserted AS (
    INSERT INTO project_usage
      (project_id, org_id, counter_type, period_start, period_end, value, updated_at)
    SELECT project_id, org_id, counter_type, period_start, period_end, total_increment, NOW()
    FROM aggregated
    ON CONFLICT (project_id, counter_type, period_start)
    DO UPDATE SET value = project_usage.value + EXCLUDED.value, updated_at = NOW()
    RETURNING project_id
  ),
  upserted_api_minute AS (
    INSERT INTO api_key_usage_minute (
      api_key_id, project_id, organization_id, environment_id, bucket, event_type_id,
      request_count, accepted_event_count, error_event_count, ingestion_failure_count,
      accepted_bytes, rate_limited_request_count
    )
    SELECT
      api_key_id, project_id, org_id, environment_id, minute_bucket, event_type_id,
      COALESCE(request_count, 0), COALESCE(accepted_event_count, 0), COALESCE(error_event_count, 0),
      COALESCE(ingestion_failure_count, 0), COALESCE(accepted_bytes, 0), COALESCE(rate_limited_request_count, 0)
    FROM keyed
    ON CONFLICT (api_key_id, bucket, event_type_id) DO UPDATE SET
      request_count = api_key_usage_minute.request_count + EXCLUDED.request_count,
      accepted_event_count = api_key_usage_minute.accepted_event_count + EXCLUDED.accepted_event_count,
      error_event_count = api_key_usage_minute.error_event_count + EXCLUDED.error_event_count,
      ingestion_failure_count = api_key_usage_minute.ingestion_failure_count + EXCLUDED.ingestion_failure_count,
      accepted_bytes = api_key_usage_minute.accepted_bytes + EXCLUDED.accepted_bytes,
      rate_limited_request_count = api_key_usage_minute.rate_limited_request_count + EXCLUDED.rate_limited_request_count
    RETURNING project_id
  ),
  upserted_api_daily AS (
    INSERT INTO api_key_usage_daily (
      api_key_id, project_id, organization_id, environment_id, bucket, event_type_id,
      request_count, accepted_event_count, error_event_count, ingestion_failure_count,
      accepted_bytes, rate_limited_request_count
    )
    SELECT
      api_key_id, project_id, org_id, environment_id, day_bucket, event_type_id,
      COALESCE(SUM(request_count), 0), COALESCE(SUM(accepted_event_count), 0), COALESCE(SUM(error_event_count), 0),
      COALESCE(SUM(ingestion_failure_count), 0), COALESCE(SUM(accepted_bytes), 0), COALESCE(SUM(rate_limited_request_count), 0)
    FROM keyed
    GROUP BY api_key_id, project_id, org_id, environment_id, day_bucket, event_type_id
    ON CONFLICT (api_key_id, bucket, event_type_id) DO UPDATE SET
      request_count = api_key_usage_daily.request_count + EXCLUDED.request_count,
      accepted_event_count = api_key_usage_daily.accepted_event_count + EXCLUDED.accepted_event_count,
      error_event_count = api_key_usage_daily.error_event_count + EXCLUDED.error_event_count,
      ingestion_failure_count = api_key_usage_daily.ingestion_failure_count + EXCLUDED.ingestion_failure_count,
      accepted_bytes = api_key_usage_daily.accepted_bytes + EXCLUDED.accepted_bytes,
      rate_limited_request_count = api_key_usage_daily.rate_limited_request_count + EXCLUDED.rate_limited_request_count
    RETURNING project_id
  ),
  deleted AS (
    DELETE FROM usage_counter_staging s
    USING batch b
    WHERE s.id = b.id
    RETURNING s.id, s.project_id
  )
  SELECT d.project_id, COUNT(*)::BIGINT
  FROM deleted d
  GROUP BY d.project_id;
END;
$$ LANGUAGE plpgsql;

-- Source: canonical_migrations_draft/04_projects/022_add_project_public_id.sql
CREATE OR REPLACE FUNCTION fn_prevent_project_public_id_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.public_id IS DISTINCT FROM NEW.public_id THEN
    RAISE EXCEPTION
      'projects.public_id is immutable. Attempted change from "%" to "%".',
      OLD.public_id, NEW.public_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION generate_backup_codes_for_user(
  p_user_id UUID,
  p_count INTEGER DEFAULT 10
) RETURNS TABLE(code_plaintext TEXT, code_hash TEXT) AS $$
DECLARE
  v_code TEXT;
  v_hash TEXT;
BEGIN
  -- Generate N random backup codes and their hashes
  FOR i IN 1..p_count LOOP
    v_code := upper(encode(gen_random_bytes(10), 'hex'));
    v_hash := crypt(v_code, gen_salt('bf', 12));
    
    INSERT INTO user_backup_codes (user_id, code_hash)
    VALUES (p_user_id, v_hash);
    
    code_plaintext := v_code;
    code_hash := v_hash;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION get_effective_integer_feature(
    p_organization_id UUID,
    p_feature_key TEXT
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT integer_value
FROM v_effective_entitlements
WHERE organization_id = p_organization_id
  AND feature_key = p_feature_key
LIMIT 1;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION has_feature(
    p_organization_id UUID,
    p_feature_key TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
SELECT COALESCE(boolean_value,FALSE)
FROM v_effective_entitlements
WHERE organization_id = p_organization_id
  AND feature_key = p_feature_key
LIMIT 1;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION increment_event_usage(
    p_organization_id UUID,
    p_weighted_credits NUMERIC,
    p_raw_count BIGINT DEFAULT 1
)
RETURNS TABLE(
    events_used NUMERIC,
    event_limit BIGINT,
    overage_events NUMERIC,
    raw_events_count BIGINT,
    is_over_limit BOOLEAN
) AS $$
DECLARE
    v_events_used NUMERIC;
    v_event_limit BIGINT;
    v_overage_events NUMERIC;
    v_raw_events_count BIGINT;
BEGIN
    UPDATE organization_usage_current_period
    SET
        events_used = organization_usage_current_period.events_used + p_weighted_credits,
        raw_events_count = organization_usage_current_period.raw_events_count + p_raw_count,
        overage_events = GREATEST(0, (organization_usage_current_period.events_used + p_weighted_credits) - organization_usage_current_period.event_limit),
        last_event_at = NOW(),
        updated_at = NOW()
    WHERE organization_id = p_organization_id
      AND (period_start IS NULL OR NOW() BETWEEN period_start AND period_end)
    RETURNING
        organization_usage_current_period.events_used,
        organization_usage_current_period.event_limit,
        organization_usage_current_period.overage_events,
        organization_usage_current_period.raw_events_count
    INTO v_events_used, v_event_limit, v_overage_events, v_raw_events_count;

    IF NOT FOUND THEN
        UPDATE organization_usage_current_period
        SET
            events_used = organization_usage_current_period.events_used + p_weighted_credits,
            raw_events_count = organization_usage_current_period.raw_events_count + p_raw_count,
            overage_events = GREATEST(0, (organization_usage_current_period.events_used + p_weighted_credits) - organization_usage_current_period.event_limit),
            last_event_at = NOW(),
            updated_at = NOW()
        WHERE organization_id = p_organization_id
        RETURNING
            organization_usage_current_period.events_used,
            organization_usage_current_period.event_limit,
            organization_usage_current_period.overage_events,
            organization_usage_current_period.raw_events_count
        INTO v_events_used, v_event_limit, v_overage_events, v_raw_events_count;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No usage record found for organization %', p_organization_id;
    END IF;

    RETURN QUERY SELECT
        v_events_used,
        v_event_limit,
        v_overage_events,
        v_raw_events_count,
        (v_events_used > v_event_limit);
END;
$$ LANGUAGE plpgsql;

-- Backward-compatible overload for legacy calls with single count
CREATE OR REPLACE FUNCTION increment_event_usage(
    p_organization_id UUID,
    p_count BIGINT DEFAULT 1
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET events_used = events_used + p_count,
    raw_events_count = raw_events_count + p_count,
    last_event_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

-- Source: canonical_migrations_draft/04_projects/020_remove_sdk_config_provisioning_trigger.up.sql
-- Environment SDK config is provisioned explicitly in application-level transactions (SdkConfigProvisioner).

-- Source: canonical_migrations_draft/04_projects/021_remove_project_defaults_provisioning_trigger.up.sql
-- Project defaults are provisioned explicitly in application-level transactions (ProjectService.createProject).


-- Source: canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql
CREATE OR REPLACE FUNCTION pulse_build_sdk_config(
  p_project_id uuid,
  p_environment text,
  p_generated_at text,
  p_intent jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  base_url text := regexp_replace(COALESCE(NULLIF(current_setting('pulse.backend_url',true),''),'http://localhost:5000/api'),'/*$','');
  mandatory_headers jsonb := '["authorization","proxy-authorization","cookie","set-cookie","x-api-key"]'::jsonb;
  mandatory_fields jsonb := '["password","secret","token","apiKey","authorization","creditCard","ssn","access_token","refresh_token","client_secret"]'::jsonb;
  config jsonb;
  hash text;
BEGIN
  config := jsonb_build_object(
    'schemaVersion',1,
    'sdk',jsonb_build_object('projectId',p_project_id::text,'environment',p_environment,'release','1.0.0'),
    'features',jsonb_build_object(
      'tracing',true,'requestCapture',true,'errors',true,'metrics',true,'logging',true,
      'profiling',false,'crons',false,'sessionReplay',false,'runtimeMetrics',false,
      'eventLoopMonitoring',false,'gcMonitoring',false),
    'sampling',pulse_sdk_sampling_v2('{}'::jsonb),
    'instrumentation',jsonb_build_object(
      'http',true,'https',true,'fetch',true,'axios',false,'fastify',true,'express',true,
      'graphql',false,'prisma',false,'mongodb',false,'redis',false,'bullmq',false,
      'pg',false,'mysql2',false,'eventEmitterPatch',true),
    'privacy',jsonb_build_object(
      'capture',jsonb_build_object('headers',false,'body',false,'response',false,'query',false,'cookies',false),
      'scrubbing',jsonb_build_object('enabled',true,'headers',mandatory_headers,'fields',mandatory_fields),
      'piiDetection',jsonb_build_object('enabled',true,'maskEmails',true,'maskPhones',true,'maskIPs',true)),
    'limits',jsonb_build_object(
      'maxSpansPerTrace',2000,'maxSpanAttributes',128,'maxAttributeLength',4096,
      'maxPayloadSize',1048576,'maxQueueSize',10000,'maxMemoryMb','auto',
      'tenantGovernance',jsonb_build_object('enabled',false,'maxTenantsTracked',1000,
        'quotaPerWindow',10000,'windowDurationMs',60000,'criticalReserve',100),
      'persistenceGovernance',jsonb_build_object(
        'maxPersistPerMinute',20000,'adaptive',true,'budgetExceededLogIntervalMs',60000)),
    'killswitches',jsonb_build_object(
      'disableSDK',false,'disableTracing',false,'disableMetrics',false,'disableTransport',false,
      'disableProfiling',false,'disableErrors',false,'disableLogs',false),
    'transport',jsonb_build_object(
      'retry',jsonb_build_object('enabled',true,'maxRetries',3,'backoff','exponential','baseDelayMs',500),
      'queue',jsonb_build_object('overflowStrategy','drop_oldest','maxSize',10000,'criticalReserve',1000),
      'connections',jsonb_build_object('maxTotalConnections',50,'acquireTimeoutMs',5000),
      'keepAlive',true,
      'routes',jsonb_build_object(
        'errors',jsonb_build_object('url',base_url||'/v1/errors','batchSize',100,'flushIntervalMs',1000,'timeoutMs',5000,'compression','gzip','priority','critical'),
        'events',jsonb_build_object('url',base_url||'/v1/events','batchSize',100,'flushIntervalMs',2000,'timeoutMs',5000,'compression','gzip','priority','high'),
        'traces',jsonb_build_object('url',base_url||'/v1/traces','batchSize',500,'flushIntervalMs',5000,'timeoutMs',5000,'compression','gzip','priority','high'),
        'spans',jsonb_build_object('url',base_url||'/v1/spans','batchSize',500,'flushIntervalMs',5000,'timeoutMs',5000,'compression','gzip','priority','normal'),
        'requests',jsonb_build_object('url',base_url||'/v1/requests','batchSize',500,'flushIntervalMs',5000,'timeoutMs',5000,'compression','gzip','priority','high'),
        'metrics',jsonb_build_object('url',base_url||'/v1/metrics','batchSize',1000,'flushIntervalMs',10000,'timeoutMs',5000,'compression','gzip','priority','normal'),
        'logs',jsonb_build_object('url',base_url||'/v1/logs','batchSize',200,'flushIntervalMs',10000,'timeoutMs',5000,'compression','gzip','priority','normal'),
        'profiles',jsonb_build_object('url',base_url||'/v1/profiles','batchSize',5,'flushIntervalMs',30000,'timeoutMs',15000,'compression','gzip','priority','low'),
        'crons',jsonb_build_object('url',base_url||'/v1/checkins','batchSize',1,'flushIntervalMs',0,'timeoutMs',5000,'compression','none','priority','high'),
        'replays',jsonb_build_object('url',base_url||'/v1/replays','batchSize',5,'flushIntervalMs',10000,'timeoutMs',30000,'compression','gzip','priority','low'))),
    'runtime',jsonb_build_object('configTtlSeconds',300,'staleWhileRevalidate',true),
    'meta',jsonb_build_object('generatedAt',p_generated_at,'generatedBy','pulse-config-compiler@1','configHash',''),
    'entitlements',jsonb_build_object(
      'customSpans',true,'customMetrics',true,'profiling',false,'logging',true,'sessionReplay',false,
      'crons',false,'requestCapture',true,'tracing',true,'errors',true,'metrics',true)
  );
  config := pulse_jsonb_deep_merge(config,pulse_extract_sdk_intent(p_intent));
  config := jsonb_set(config,'{sampling}',pulse_sdk_sampling_v2(config->'sampling'),true);
  config := jsonb_set(config,'{privacy,scrubbing,headers}',pulse_jsonb_dedupe_strings(mandatory_headers,config #> '{privacy,scrubbing,headers}'),true);
  config := jsonb_set(config,'{privacy,scrubbing,fields}',pulse_jsonb_dedupe_strings(mandatory_fields,config #> '{privacy,scrubbing,fields}'),true);
  config := jsonb_set(config,'{schemaVersion}','1'::jsonb,true);
  config := jsonb_set(config,'{sdk}',jsonb_build_object('projectId',p_project_id::text,'environment',p_environment,'release','1.0.0'),true);
  config := jsonb_set(config,'{meta}',jsonb_build_object('generatedAt',p_generated_at,'generatedBy','pulse-config-compiler@1','configHash',''),true);
  config := jsonb_set(config,'{entitlements}',jsonb_build_object(
    'customSpans',true,'customMetrics',true,'profiling',false,'logging',true,'sessionReplay',false,
    'crons',false,'requestCapture',true,'tracing',true,'errors',true,'metrics',true),true);
  config := jsonb_set(config,'{transport,routes,errors,url}',to_jsonb(base_url||'/v1/errors'),true);
  config := jsonb_set(config,'{transport,routes,events,url}',to_jsonb(base_url||'/v1/events'),true);
  config := jsonb_set(config,'{transport,routes,traces,url}',to_jsonb(base_url||'/v1/traces'),true);
  config := jsonb_set(config,'{transport,routes,spans,url}',to_jsonb(base_url||'/v1/spans'),true);
  config := jsonb_set(config,'{transport,routes,requests,url}',to_jsonb(base_url||'/v1/requests'),true);
  config := jsonb_set(config,'{transport,routes,metrics,url}',to_jsonb(base_url||'/v1/metrics'),true);
  config := jsonb_set(config,'{transport,routes,logs,url}',to_jsonb(base_url||'/v1/logs'),true);
  config := jsonb_set(config,'{transport,routes,profiles,url}',to_jsonb(base_url||'/v1/profiles'),true);
  config := jsonb_set(config,'{transport,routes,crons,url}',to_jsonb(base_url||'/v1/checkins'),true);
  config := jsonb_set(config,'{transport,routes,replays,url}',to_jsonb(base_url||'/v1/replays'),true);
  hash := pulse_sdk_hash(config);
  RETURN jsonb_set(config,'{meta,configHash}',to_jsonb(hash),true);
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_canonical_jsonb(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE v_type text := jsonb_typeof(p_value); v_text text;
BEGIN
  CASE v_type
    WHEN 'object' THEN
      SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||pulse_canonical_jsonb(value),',' ORDER BY pulse_utf16_sort_key(key)),'')||'}'
        INTO v_text FROM jsonb_each(p_value);
      RETURN v_text;
    WHEN 'array' THEN
      SELECT '['||COALESCE(string_agg(pulse_canonical_jsonb(value),',' ORDER BY ordinality),'')||']'
        INTO v_text FROM jsonb_array_elements(p_value) WITH ORDINALITY;
      RETURN v_text;
    WHEN 'number' THEN
      RETURN pulse_canonical_number(p_value);
    ELSE RETURN p_value::text;
  END CASE;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_canonical_number(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  v_text text := p_value #>> '{}';
  v_sign text := '';
  v_fraction text;
  v_digits text;
  v_first integer;
  v_mantissa text;
BEGIN
  IF position('.' in v_text)>0 THEN
    v_text := regexp_replace(regexp_replace(v_text,'0+$',''),'\.$','');
  END IF;
  IF v_text='-0' THEN RETURN '0'; END IF;

  -- JSON.stringify uses scientific notation below 1e-6. SDK numbers are
  -- bounded below 1e21, so this is the only exponent threshold reachable by
  -- the schema-v1 contract.
  IF v_text ~ '^-?0\.0{6,}[1-9][0-9]*$' THEN
    IF left(v_text,1)='-' THEN
      v_sign := '-';
      v_text := substr(v_text,2);
    END IF;
    v_fraction := split_part(v_text,'.',2);
    v_first := length(v_fraction)-length(ltrim(v_fraction,'0'))+1;
    v_digits := ltrim(v_fraction,'0');
    v_mantissa := left(v_digits,1);
    IF length(v_digits)>1 THEN
      v_mantissa := v_mantissa||'.'||substr(v_digits,2);
    END IF;
    RETURN v_sign||v_mantissa||'e-'||v_first::text;
  END IF;
  RETURN v_text;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql
CREATE OR REPLACE FUNCTION pulse_extract_sdk_intent(p_source jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s jsonb := CASE WHEN jsonb_typeof(p_source)='object' THEN p_source ELSE '{}'::jsonb END;
  result jsonb := '{}'::jsonb;
  inst jsonb := '{}'::jsonb;
  routes jsonb := '{}'::jsonb;
  pii jsonb;
  conn jsonb;
  v jsonb;
  k text;
BEGIN
  result := jsonb_set(result,'{features}',pulse_jsonb_pick_keys(s->'features',ARRAY[
    'tracing','requestCapture','errors','metrics','logging','profiling','crons','sessionReplay',
    'runtimeMetrics','eventLoopMonitoring','gcMonitoring']),true);

  v := pulse_jsonb_pick_keys(s->'sampling',ARRAY[
    'errors','traces','spans','requests','metrics','logs','events','messages','profiles','replays','crons','routes'
  ]);
  IF jsonb_typeof(v->'routes')<>'object' THEN v := v-'routes'; END IF;
  result := jsonb_set(result,'{sampling}',v,true);

  FOREACH k IN ARRAY ARRAY['http','https','fetch','axios','fastify','express','graphql','prisma','mongodb','redis','bullmq','pg','mysql2','eventEmitterPatch'] LOOP
    v := s #> ARRAY['instrumentation',k];
    IF jsonb_typeof(v)='object' THEN v := v->'enabled'; END IF;
    IF jsonb_typeof(v)='boolean' THEN inst := jsonb_set(inst,ARRAY[k],v,true); END IF;
  END LOOP;
  result := jsonb_set(result,'{instrumentation}',inst,true);

  pii := COALESCE(s #> '{privacy,piiDetection}',s #> '{privacy,pii}','{}'::jsonb);
  v := jsonb_strip_nulls(jsonb_build_object(
    'enabled',pulse_sdk_scalar(pii,ARRAY['enabled'],'boolean'),
    'maskEmails',pulse_sdk_scalar(pii,ARRAY['maskEmails'],'boolean'),
    'maskPhones',COALESCE(pulse_sdk_scalar(pii,ARRAY['maskPhones'],'boolean'),pulse_sdk_scalar(pii,ARRAY['maskPhoneNumbers'],'boolean')),
    'maskIPs',pulse_sdk_scalar(pii,ARRAY['maskIPs'],'boolean')
  ));
  result := jsonb_set(result,'{privacy}',jsonb_build_object(
    'capture',pulse_jsonb_pick_keys(s #> '{privacy,capture}',ARRAY['headers','body','response','query','cookies']),
    'scrubbing',pulse_jsonb_pick_keys(s #> '{privacy,scrubbing}',ARRAY['enabled','headers','fields']),
    'piiDetection',v
  ),true);

  v := pulse_jsonb_pick_keys(s->'limits',ARRAY[
    'maxSpansPerTrace','maxSpanAttributes','maxAttributeLength','maxPayloadSize','maxQueueSize',
    'maxMemoryMb','tenantGovernance','persistenceGovernance']);
  IF jsonb_typeof(v->'tenantGovernance')='object' THEN
    v := jsonb_set(v,'{tenantGovernance}',pulse_jsonb_pick_keys(v->'tenantGovernance',ARRAY[
      'enabled','maxTenantsTracked','quotaPerWindow','windowDurationMs','criticalReserve']),true);
  ELSE v := v-'tenantGovernance'; END IF;
  IF jsonb_typeof(v->'persistenceGovernance')='object' THEN
    v := jsonb_set(v,'{persistenceGovernance}',pulse_jsonb_pick_keys(v->'persistenceGovernance',ARRAY[
      'maxPersistPerMinute','adaptive','budgetExceededLogIntervalMs']),true);
  ELSE v := v-'persistenceGovernance'; END IF;
  result := jsonb_set(result,'{limits}',v,true);

  result := jsonb_set(result,'{killswitches}',pulse_jsonb_pick_keys(s->'killswitches',ARRAY[
    'disableSDK','disableTracing','disableMetrics','disableTransport','disableProfiling','disableErrors','disableLogs']),true);

  conn := pulse_jsonb_pick_keys(s #> '{transport,connections}',ARRAY['maxTotalConnections','acquireTimeoutMs']);
  IF NOT (conn?'maxTotalConnections') AND jsonb_typeof(s #> '{transport,connections,total}')='number' THEN
    conn := jsonb_set(conn,'{maxTotalConnections}',s #> '{transport,connections,total}',true);
  END IF;
  IF jsonb_typeof(s #> '{transport,routes}')='object' THEN
    FOREACH k IN ARRAY ARRAY['errors','events','traces','spans','requests','metrics','logs','profiles','crons','replays'] LOOP
      v := pulse_jsonb_pick_keys(s #> ARRAY['transport','routes',k],ARRAY['batchSize','flushIntervalMs','timeoutMs','compression','priority']);
      IF v<>'{}'::jsonb THEN routes := jsonb_set(routes,ARRAY[k],v,true); END IF;
    END LOOP;
  END IF;
  result := jsonb_set(result,'{transport}',jsonb_strip_nulls(jsonb_build_object(
    'retry',pulse_jsonb_pick_keys(s #> '{transport,retry}',ARRAY['enabled','maxRetries','backoff','baseDelayMs']),
    'queue',pulse_jsonb_pick_keys(s #> '{transport,queue}',ARRAY['overflowStrategy','maxSize','criticalReserve']),
    'connections',conn,
    'keepAlive',pulse_sdk_scalar(s,ARRAY['transport','keepAlive'],'boolean'),
    'routes',routes
  )),true);
  result := jsonb_set(result,'{runtime}',pulse_jsonb_pick_keys(s->'runtime',ARRAY['configTtlSeconds','staleWhileRevalidate']),true);
  RETURN result;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_exact_keys(p_value jsonb, p_keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_value)='object'
     AND (SELECT count(*) FROM jsonb_object_keys(p_value))=cardinality(p_keys)
     AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE NOT (k=ANY(p_keys)));
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_all_booleans(p_value jsonb, p_keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT pulse_jsonb_exact_keys(p_value,p_keys)
     AND NOT EXISTS (SELECT 1 FROM unnest(p_keys) k WHERE jsonb_typeof(p_value->k)<>'boolean');
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_dedupe_strings(p_first jsonb, p_second jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb := '[]'::jsonb; seen text[] := ARRAY[]::text[]; v text;
BEGIN
  FOR v IN SELECT value FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(p_first)='array' THEN p_first ELSE '[]'::jsonb END ||
    CASE WHEN jsonb_typeof(p_second)='array' THEN p_second ELSE '[]'::jsonb END
  ) LOOP
    IF NOT (v=ANY(seen)) THEN seen := array_append(seen,v); result := result||to_jsonb(v); END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_deep_merge(p_base jsonb, p_overlay jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb := COALESCE(p_base,'{}'::jsonb); item record;
BEGIN
  IF jsonb_typeof(p_overlay)<>'object' THEN RETURN p_overlay; END IF;
  IF jsonb_typeof(result)<>'object' THEN result := '{}'::jsonb; END IF;
  FOR item IN SELECT key,value FROM jsonb_each(p_overlay) LOOP
    IF jsonb_typeof(result->item.key)='object' AND jsonb_typeof(item.value)='object' THEN
      result := jsonb_set(result,ARRAY[item.key],pulse_jsonb_deep_merge(result->item.key,item.value),true);
    ELSE
      result := jsonb_set(result,ARRAY[item.key],item.value,true);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_number_between(
  p_value jsonb, p_min numeric, p_max numeric, p_integer boolean DEFAULT true
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v numeric;
BEGIN
  IF jsonb_typeof(p_value)<>'number' THEN RETURN false; END IF;
  v := (p_value #>> '{}')::numeric;
  RETURN v BETWEEN p_min AND p_max AND (NOT p_integer OR v=trunc(v));
EXCEPTION WHEN others THEN RETURN false;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_pick_keys(p_value jsonb, p_keys text[])
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p_value)='object' THEN
    COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(p_value) WHERE key=ANY(p_keys)),'{}'::jsonb)
  ELSE '{}'::jsonb END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_string_array(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v jsonb;
BEGIN
  IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)>500 THEN RETURN false; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(v)<>'string' OR octet_length(v #>> '{}') NOT BETWEEN 1 AND 512 THEN RETURN false; END IF;
  END LOOP;
  RETURN (SELECT count(*)=count(DISTINCT value) FROM jsonb_array_elements_text(p_value));
END;
$$;

-- Source: canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql
CREATE OR REPLACE FUNCTION pulse_sdk_config_valid(c jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v jsonb; path text; n numeric;
BEGIN
  IF NOT pulse_jsonb_exact_keys(c,ARRAY['schemaVersion','sdk','features','sampling','instrumentation','privacy','limits','killswitches','transport','runtime','meta','entitlements']) THEN RETURN false; END IF;
  IF c->>'schemaVersion'<>'1' THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'sdk',ARRAY['projectId','environment','release'])
     OR COALESCE(c#>>'{sdk,projectId}','')='' OR octet_length(c#>>'{sdk,projectId}')>128
     OR COALESCE(c#>>'{sdk,environment}','')='' OR octet_length(c#>>'{sdk,environment}')>64
     OR COALESCE(c#>>'{sdk,release}','')='' OR octet_length(c#>>'{sdk,release}')>100 THEN RETURN false; END IF;
  IF NOT pulse_jsonb_all_booleans(c->'features',ARRAY['tracing','requestCapture','errors','metrics','logging','profiling','crons','sessionReplay','runtimeMetrics','eventLoopMonitoring','gcMonitoring']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'sampling',ARRAY['errors','traces','spans','requests','metrics','logs','events','messages','profiles','replays','crons','routes']) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['errors','traces','spans','requests','metrics','logs','events','messages','profiles','replays','crons'] LOOP
    IF NOT pulse_jsonb_number_between(c#>ARRAY['sampling',k],0,1,false) THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(c#>'{sampling,routes}')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(c#>'{sampling,routes}'))>1000 THEN RETURN false; END IF;
  FOR k,v IN SELECT key,value FROM jsonb_each(c#>'{sampling,routes}') LOOP
    IF left(k,1)<>'/' OR octet_length(k)>512 OR jsonb_typeof(v)<>'object' OR v='{}'::jsonb THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v) x WHERE NOT (x=ANY(ARRAY['errors','traces','spans','requests','metrics','logs','events','messages','profiles','replays','crons']))) THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(v) x WHERE NOT pulse_jsonb_number_between(x.value,0,1,false)) THEN RETURN false; END IF;
  END LOOP;
  IF NOT pulse_jsonb_all_booleans(c->'instrumentation',ARRAY['http','https','fetch','axios','fastify','express','graphql','prisma','mongodb','redis','bullmq','pg','mysql2','eventEmitterPatch']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'privacy',ARRAY['capture','scrubbing','piiDetection'])
     OR NOT pulse_jsonb_all_booleans(c#>'{privacy,capture}',ARRAY['headers','body','response','query','cookies'])
     OR NOT pulse_jsonb_exact_keys(c#>'{privacy,scrubbing}',ARRAY['enabled','headers','fields'])
     OR jsonb_typeof(c#>'{privacy,scrubbing,enabled}')<>'boolean'
     OR NOT pulse_jsonb_string_array(c#>'{privacy,scrubbing,headers}')
     OR NOT pulse_jsonb_string_array(c#>'{privacy,scrubbing,fields}')
     OR NOT pulse_jsonb_all_booleans(c#>'{privacy,piiDetection}',ARRAY['enabled','maskEmails','maskPhones','maskIPs']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'limits',ARRAY['maxSpansPerTrace','maxSpanAttributes','maxAttributeLength','maxPayloadSize','maxQueueSize','maxMemoryMb','tenantGovernance','persistenceGovernance']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_number_between(c#>'{limits,maxSpansPerTrace}',1,100000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxSpanAttributes}',1,1000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxAttributeLength}',1,65536,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxPayloadSize}',1024,10485760,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxQueueSize}',100,1000000,true) THEN RETURN false; END IF;
  IF NOT ((c#>'{limits,maxMemoryMb}')='"auto"'::jsonb OR pulse_jsonb_number_between(c#>'{limits,maxMemoryMb}',64,1048576,true)) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c#>'{limits,tenantGovernance}',ARRAY['enabled','maxTenantsTracked','quotaPerWindow','windowDurationMs','criticalReserve'])
     OR jsonb_typeof(c#>'{limits,tenantGovernance,enabled}')<>'boolean'
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,maxTenantsTracked}',1,1000000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,quotaPerWindow}',1,100000000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,windowDurationMs}',1000,86400000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,criticalReserve}',0,1000000,true) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c#>'{limits,persistenceGovernance}',ARRAY['maxPersistPerMinute','adaptive','budgetExceededLogIntervalMs'])
     OR NOT pulse_jsonb_number_between(c#>'{limits,persistenceGovernance,maxPersistPerMinute}',1,1000000,true)
     OR jsonb_typeof(c#>'{limits,persistenceGovernance,adaptive}')<>'boolean'
     OR NOT pulse_jsonb_number_between(c#>'{limits,persistenceGovernance,budgetExceededLogIntervalMs}',1000,600000,true) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_all_booleans(c->'killswitches',ARRAY['disableSDK','disableTracing','disableMetrics','disableTransport','disableProfiling','disableErrors','disableLogs']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'runtime',ARRAY['configTtlSeconds','staleWhileRevalidate'])
     OR NOT pulse_jsonb_number_between(c#>'{runtime,configTtlSeconds}',30,86400,true)
     OR jsonb_typeof(c#>'{runtime,staleWhileRevalidate}')<>'boolean' THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'meta',ARRAY['generatedAt','generatedBy','configHash'])
     OR COALESCE(c#>>'{meta,generatedAt}','')=''
     OR c#>>'{meta,generatedBy}'<>'pulse-config-compiler@1'
     OR COALESCE(c#>>'{meta,configHash}','') !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  IF NOT pulse_jsonb_all_booleans(c->'entitlements',ARRAY['customSpans','customMetrics','profiling','logging','sessionReplay','crons','requestCapture','tracing','errors','metrics']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'transport',ARRAY['retry','queue','connections','keepAlive','routes'])
     OR jsonb_typeof(c#>'{transport,keepAlive}')<>'boolean'
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,retry}',ARRAY['enabled','maxRetries','backoff','baseDelayMs'])
     OR jsonb_typeof(c#>'{transport,retry,enabled}')<>'boolean'
     OR NOT pulse_jsonb_number_between(c#>'{transport,retry,maxRetries}',0,10,true)
     OR NOT (c#>>'{transport,retry,backoff}'=ANY(ARRAY['exponential','linear','fixed']))
     OR NOT pulse_jsonb_number_between(c#>'{transport,retry,baseDelayMs}',10,60000,true)
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,queue}',ARRAY['overflowStrategy','maxSize','criticalReserve'])
     OR NOT (c#>>'{transport,queue,overflowStrategy}'=ANY(ARRAY['drop_oldest','drop_newest','reject']))
     OR NOT pulse_jsonb_number_between(c#>'{transport,queue,maxSize}',100,1000000,true)
     OR NOT pulse_jsonb_number_between(c#>'{transport,queue,criticalReserve}',0,100000,true)
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,connections}',ARRAY['maxTotalConnections','acquireTimeoutMs'])
     OR NOT pulse_jsonb_number_between(c#>'{transport,connections,maxTotalConnections}',1,10000,true)
     OR NOT pulse_jsonb_number_between(c#>'{transport,connections,acquireTimeoutMs}',100,60000,true)
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,routes}',ARRAY['errors','events','traces','spans','requests','metrics','logs','profiles','crons','replays']) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['errors','events','traces','spans','requests','metrics','logs','profiles','crons','replays'] LOOP
    v := c#>ARRAY['transport','routes',k];
    IF NOT pulse_jsonb_exact_keys(v,ARRAY['url','batchSize','flushIntervalMs','timeoutMs','compression','priority'])
       OR COALESCE(v->>'url','') !~ '^https?://'
       OR NOT pulse_jsonb_number_between(v->'batchSize',1,10000,true)
       OR NOT pulse_jsonb_number_between(v->'flushIntervalMs',0,300000,true)
       OR NOT pulse_jsonb_number_between(v->'timeoutMs',100,300000,true)
       OR NOT (v->>'compression'=ANY(ARRAY['gzip','none']))
       OR NOT (v->>'priority'=ANY(ARRAY['critical','high','normal','low'])) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_sdk_hash(p_config jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT encode(digest(
    pulse_canonical_jsonb(jsonb_set(p_config,'{meta}',COALESCE(p_config->'meta','{}'::jsonb)-'configHash')),
    'sha256'
  ),'hex');
$$;

-- Source: canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql
CREATE OR REPLACE FUNCTION pulse_sdk_sampling_v2(sampling jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'errors', COALESCE(sampling->'errors', '1'::jsonb),
    'traces', COALESCE(sampling->'traces', '1'::jsonb),
    'spans', COALESCE(sampling->'spans', '1'::jsonb),
    'requests', COALESCE(sampling->'requests', '1'::jsonb),
    'metrics', COALESCE(sampling->'metrics', '1'::jsonb),
    'logs', COALESCE(sampling->'logs', '1'::jsonb),
    'events', COALESCE(sampling->'events', '1'::jsonb),
    'messages', COALESCE(sampling->'messages', '1'::jsonb),
    'profiles', COALESCE(sampling->'profiles', '0.1'::jsonb),
    'replays', COALESCE(sampling->'replays', '0.1'::jsonb),
    'crons', COALESCE(sampling->'crons', '1'::jsonb),
    'routes',
      COALESCE(
        CASE
          WHEN jsonb_typeof(sampling->'routes') = 'object'
          THEN jsonb_set(
            sampling->'routes',
            '{/health}',
            COALESCE(sampling #> '{routes,/health}', '{}'::jsonb)
              || jsonb_build_object('requests',0,'traces',0,'spans',0,'metrics',0,'logs',0),
            true
          )
          ELSE NULL
        END,
        jsonb_build_object(
          '/health', jsonb_build_object('requests',0,'traces',0,'spans',0,'metrics',0,'logs',0)
        )
      )
  )
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_sdk_scalar(p_source jsonb, p_path text[], p_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v jsonb := p_source #> p_path;
BEGIN
  IF v IS NOT NULL AND jsonb_typeof(v)=p_type THEN RETURN v; END IF;
  RETURN NULL;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_utf16_sort_key(p_value text)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  result bytea := ''::bytea;
  i integer;
  cp integer;
  adjusted integer;
  high_unit integer;
  low_unit integer;
BEGIN
  FOR i IN 1..char_length(p_value) LOOP
    cp := ascii(substr(p_value,i,1));
    IF cp <= 65535 THEN
      result := result || decode(lpad(to_hex(cp),4,'0'),'hex');
    ELSE
      adjusted := cp-65536;
      high_unit := 55296+(adjusted >> 10);
      low_unit := 56320+(adjusted & 1023);
      result := result
        || decode(lpad(to_hex(high_unit),4,'0'),'hex')
        || decode(lpad(to_hex(low_unit),4,'0'),'hex');
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION refresh_hourly_rollup(
  p_org_id UUID, p_start_hour TIMESTAMPTZ, p_end_hour TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  INSERT INTO analytics_hourly_rollup (
    organization_id, project_id, bucket_hour,
    error_count, error_fatal_count, error_error_count, error_warning_count,
    error_info_count, error_debug_count
  )
  SELECT
    organization_id, project_id, DATE_TRUNC('hour', timestamp) AS bucket_hour,
    COUNT(*),
    COUNT(*) FILTER (WHERE severity = 'fatal'),
    COUNT(*) FILTER (WHERE severity = 'error'),
    COUNT(*) FILTER (WHERE severity = 'warning'),
    COUNT(*) FILTER (WHERE severity = 'info'),
    COUNT(*) FILTER (WHERE severity = 'debug')
  FROM events_errors
  WHERE organization_id = p_org_id AND timestamp >= p_start_hour AND timestamp < p_end_hour
  GROUP BY organization_id, project_id, DATE_TRUNC('hour', timestamp)
  ON CONFLICT (organization_id, project_id, bucket_hour) DO UPDATE SET
    error_count = EXCLUDED.error_count,
    error_fatal_count = EXCLUDED.error_fatal_count,
    error_error_count = EXCLUDED.error_error_count,
    error_warning_count = EXCLUDED.error_warning_count,
    error_info_count = EXCLUDED.error_info_count,
    error_debug_count = EXCLUDED.error_debug_count,
    updated_at = NOW();

  INSERT INTO analytics_hourly_rollup (
    organization_id, project_id, bucket_hour,
    request_count, request_2xx_count, request_3xx_count, request_4xx_count, request_5xx_count,
    request_avg_latency_ms, request_p95_latency_ms, request_p99_latency_ms, unique_user_count
  )
  SELECT
    organization_id, project_id, DATE_TRUNC('hour', timestamp) AS bucket_hour,
    COUNT(*),
    COUNT(*) FILTER (WHERE status_code BETWEEN 200 AND 299),
    COUNT(*) FILTER (WHERE status_code BETWEEN 300 AND 399),
    COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499),
    COUNT(*) FILTER (WHERE status_code >= 500),
    AVG(latency_ms)::INTEGER,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::INTEGER,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::INTEGER,
    COUNT(DISTINCT user_id)
  FROM events_requests
  WHERE organization_id = p_org_id AND timestamp >= p_start_hour AND timestamp < p_end_hour
  GROUP BY organization_id, project_id, DATE_TRUNC('hour', timestamp)
  ON CONFLICT (organization_id, project_id, bucket_hour) DO UPDATE SET
    request_count = EXCLUDED.request_count,
    request_2xx_count = EXCLUDED.request_2xx_count,
    request_3xx_count = EXCLUDED.request_3xx_count,
    request_4xx_count = EXCLUDED.request_4xx_count,
    request_5xx_count = EXCLUDED.request_5xx_count,
    request_avg_latency_ms = EXCLUDED.request_avg_latency_ms,
    request_p95_latency_ms = EXCLUDED.request_p95_latency_ms,
    request_p99_latency_ms = EXCLUDED.request_p99_latency_ms,
    unique_user_count = EXCLUDED.unique_user_count,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Source: canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
CREATE OR REPLACE FUNCTION reject_sdk_config_revision_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SDK configuration revisions are immutable' USING ERRCODE='55000';
END; $$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION remaining_ai_credits(
    p_organization_id UUID
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(ai_credit_limit - ai_credits_used,0)
FROM organization_usage_current_period
WHERE organization_id = p_organization_id;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION remaining_event_quota(
    p_organization_id UUID
)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(event_limit - events_used, 0)::NUMERIC
FROM organization_usage_current_period
WHERE organization_id = p_organization_id
ORDER BY period_end DESC
LIMIT 1;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION revoke_and_regenerate_backup_codes()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when a device becomes newly verified
  IF NEW.is_verified = TRUE AND (OLD.is_verified = FALSE OR OLD.is_verified IS NULL) THEN
    -- Revoke all existing unused backup codes
    DELETE FROM user_backup_codes
    WHERE user_id = NEW.user_id AND used_at IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Source: canonical_migrations_draft/19_automation/003_automation_workflow_versions.sql
CREATE OR REPLACE FUNCTION trg_fn_immutable_published_version() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'Cannot update an already-published workflow version (id=%)', OLD.id
      USING ERRCODE = '25000'; -- invalid_transaction_state
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Functions for weighted event credit accounting (migration 000005)
DROP FUNCTION IF EXISTS increment_event_usage(UUID, NUMERIC, BIGINT);
DROP FUNCTION IF EXISTS increment_event_usage(UUID, BIGINT);
DROP FUNCTION IF EXISTS increment_event_usage(UUID);
DROP FUNCTION IF EXISTS remaining_event_quota(UUID);

CREATE OR REPLACE FUNCTION increment_event_usage(
    p_organization_id UUID,
    p_weighted_credits NUMERIC,
    p_raw_count BIGINT DEFAULT 1
)
RETURNS TABLE(
    events_used NUMERIC,
    event_limit BIGINT,
    overage_events NUMERIC,
    raw_events_count BIGINT,
    is_over_limit BOOLEAN
) AS $$
DECLARE
    v_events_used NUMERIC;
    v_event_limit BIGINT;
    v_overage_events NUMERIC;
    v_raw_events_count BIGINT;
BEGIN
    UPDATE organization_usage_current_period
    SET
        events_used = organization_usage_current_period.events_used + p_weighted_credits,
        raw_events_count = organization_usage_current_period.raw_events_count + p_raw_count,
        overage_events = GREATEST(0, (organization_usage_current_period.events_used + p_weighted_credits) - organization_usage_current_period.event_limit),
        last_event_at = NOW(),
        updated_at = NOW()
    WHERE organization_id = p_organization_id
      AND (period_start IS NULL OR NOW() BETWEEN period_start AND period_end)
    RETURNING
        organization_usage_current_period.events_used,
        organization_usage_current_period.event_limit,
        organization_usage_current_period.overage_events,
        organization_usage_current_period.raw_events_count
    INTO v_events_used, v_event_limit, v_overage_events, v_raw_events_count;

    IF NOT FOUND THEN
        UPDATE organization_usage_current_period
        SET
            events_used = organization_usage_current_period.events_used + p_weighted_credits,
            raw_events_count = organization_usage_current_period.raw_events_count + p_raw_count,
            overage_events = GREATEST(0, (organization_usage_current_period.events_used + p_weighted_credits) - organization_usage_current_period.event_limit),
            last_event_at = NOW(),
            updated_at = NOW()
        WHERE organization_id = p_organization_id
        RETURNING
            organization_usage_current_period.events_used,
            organization_usage_current_period.event_limit,
            organization_usage_current_period.overage_events,
            organization_usage_current_period.raw_events_count
        INTO v_events_used, v_event_limit, v_overage_events, v_raw_events_count;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No usage record found for organization %', p_organization_id;
    END IF;

    RETURN QUERY SELECT
        v_events_used,
        v_event_limit,
        v_overage_events,
        v_raw_events_count,
        (v_events_used > v_event_limit);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_event_usage(
    p_organization_id UUID,
    p_count BIGINT DEFAULT 1
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET events_used = events_used + p_count,
    raw_events_count = raw_events_count + p_count,
    last_event_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION remaining_event_quota(
    p_organization_id UUID
)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(event_limit - events_used, 0)::NUMERIC
FROM organization_usage_current_period
WHERE organization_id = p_organization_id
ORDER BY period_end DESC
LIMIT 1;
$$;

-- RFC 9562 Monotonic UUIDv7 Generator
-- Used by primary keys to guarantee sequential right-edge B-tree index appends
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS UUID AS $$
DECLARE
  v_time NUMERIC;
  v_unix_t BIGINT;
  v_rand BYTEA;
  v_output TEXT;
BEGIN
  -- 1. Extract current epoch milliseconds
  v_time := clock_timestamp();
  v_unix_t := (EXTRACT(EPOCH FROM v_time) * 1000)::BIGINT;
  
  -- 2. Generate 10 random bytes for sequence & entropy
  v_rand := gen_random_bytes(10);
  
  -- 3. Construct RFC 9562 UUIDv7 hex representation:
  -- unix_ts_ms (48 bits / 12 hex) | ver (4 bits = '7') | rand_a (12 bits / 3 hex) | var (2 bits = '8'..'b') | rand_b (62 bits)
  v_output := lpad(to_hex(v_unix_t), 12, '0') ||
              '7' ||
              substr(encode(v_rand, 'hex'), 1, 3) ||
              to_hex((8 | (get_byte(v_rand, 2) & 3))::INT) ||
              substr(encode(v_rand, 'hex'), 5, 3) ||
              substr(encode(v_rand, 'hex'), 8, 12);
              
  RETURN v_output::UUID;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION uuidv7() RETURNS UUID AS $$
BEGIN
  RETURN uuid_generate_v7();
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ============================================================
-- Source: 17_functions/900_deferred_foreign_keys.sql
-- ============================================================

-- Deferred because user_preferences.default_org_id participates in a fresh-schema FK cycle.
ALTER TABLE user_preferences
  DROP CONSTRAINT IF EXISTS fk_user_preferences_default_org_id_organizations;
ALTER TABLE user_preferences
  ADD CONSTRAINT fk_user_preferences_default_org_id_organizations
  FOREIGN KEY (default_org_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Deferred because users.current_org_id participates in a fresh-schema FK cycle.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS fk_users_current_org_id_organizations;
ALTER TABLE users
  ADD CONSTRAINT fk_users_current_org_id_organizations
  FOREIGN KEY (current_org_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- ============================================================
-- Source: 20_seeders/001_04_projects_007_create_project_environments.sql
-- ============================================================

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

-- ============================================================
-- Source: 20_seeders/002_04_projects_012_create_project_alerting_and_routing.sql
-- ============================================================

-- Source: canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
INSERT INTO project_notification_preferences(organization_id,project_id,category)
SELECT org_id,id,'all' FROM projects ON CONFLICT DO NOTHING;

-- Source: canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
INSERT INTO project_alert_thresholds(organization_id,project_id,threshold_key,metric_name,metric_source,category,severity,comparison_operator,threshold_value,threshold_unit,evaluation_window_minutes,cooldown_minutes,consecutive_breaches)
SELECT p.org_id,p.id,t.threshold_key,t.metric_name,'project_usage','performance',t.severity,'>=',t.threshold_value,t.threshold_unit,5,15,1
FROM projects p CROSS JOIN (VALUES
 ('latency_p50','latency_ms_p50','warning',500::numeric,'ms'),
 ('latency_p75','latency_ms_p75','warning',750::numeric,'ms'),
 ('latency_p90','latency_ms_p90','warning',1000::numeric,'ms'),
 ('latency_p95','latency_ms_p95','error',1500::numeric,'ms'),
 ('latency_p99','latency_ms_p99','critical',2500::numeric,'ms'),
 ('error_rate','error_rate','error',5::numeric,'percent'),
 ('apdex','apdex','warning',0.85::numeric,'score'),
 ('event_volume_spike','total_events','warning',200::numeric,'percent'),
 ('event_volume_drop','total_events','warning',50::numeric,'percent'),
 ('failed_notification_rate','failed_notifications','error',10::numeric,'percent'),
 ('ingestion_error_rate','ingestion_errors','error',5::numeric,'percent'),
 ('rate_limit_usage','rate_limit_usage','warning',80::numeric,'percent'),
 ('ai_usage_cost','ai_cost','warning',100::numeric,'currency')
) t(threshold_key,metric_name,severity,threshold_value,threshold_unit)
WHERE NOT EXISTS(SELECT 1 FROM project_alert_thresholds x WHERE x.project_id=p.id AND x.environment_id IS NULL AND x.threshold_key=t.threshold_key AND x.deleted_at IS NULL);

-- ============================================================
-- Source: 20_seeders/003_08_alerting_025_backfill_rule_bindings.sql
-- ============================================================

-- Source: canonical_migrations_draft/08_alerting/025_backfill_rule_bindings.up.sql
INSERT INTO alert_rule_bindings (
  organization_id, rule_id, scope_type, scope_level,
  mode, enabled, priority, created_by, updated_by, notes
)
SELECT
  r.organization_id, r.id, 'organization', 0,
  'inherit', r.enabled, 100, r.created_by, r.created_by, 'backfill:v2'
FROM alert_rules r
WHERE r.deleted_at IS NULL
  AND r.project_id IS NULL
ON CONFLICT DO NOTHING;

-- Source: canonical_migrations_draft/08_alerting/025_backfill_rule_bindings.up.sql
INSERT INTO alert_rule_bindings (
  organization_id, rule_id, scope_type, scope_level, project_id,
  mode, enabled, priority, created_by, updated_by, notes
)
SELECT
  r.organization_id, r.id, 'project', 1, r.project_id,
  'override', r.enabled, 100, r.created_by, r.created_by, 'backfill:v2'
FROM alert_rules r
JOIN projects p ON p.id = r.project_id AND p.org_id = r.organization_id
WHERE r.deleted_at IS NULL
  AND r.project_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Source: canonical_migrations_draft/08_alerting/025_backfill_rule_bindings.up.sql
INSERT INTO alert_rule_revisions
  (organization_id, rule_id, revision, change_kind, snapshot, actor_user_id)
SELECT
  r.organization_id, r.id, 1, 'rule',
  jsonb_build_object(
    'rule', to_jsonb(r) - 'created_at' - 'updated_at',
    'conditions', COALESCE(
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.order_index, c.id)
         FROM alert_rule_conditions c WHERE c.rule_id = r.id), '[]'::jsonb),
    'actions', COALESCE(
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.order_index, a.id)
         FROM alert_rule_actions a WHERE a.rule_id = r.id), '[]'::jsonb),
    'bindings', COALESCE(
      (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.scope_level, b.id)
         FROM alert_rule_bindings b WHERE b.rule_id = r.id AND b.deleted_at IS NULL), '[]'::jsonb),
    'backfill', TRUE
  ),
  r.created_by
FROM alert_rules r
WHERE r.deleted_at IS NULL
ON CONFLICT (rule_id, revision) DO NOTHING;

-- ============================================================
-- Source: 20_seeders/004_11_billing_catalog_plans_and_prices.sql
-- ============================================================

-- =============================================================================
-- Seeder File: 004_11_billing_catalog_plans_and_prices.sql
-- Description: Seeds JSON-derived subscription plans and plan prices
-- Catalog Version: 2.0
-- Source: billing_catalog_response.preview.json
-- =============================================================================

WITH plan_seed(key, version, name, tier, description, trial_days, is_public, is_active, is_customizable, next_plan_key, badge, sort_order) AS (
VALUES
  ('free', 1, 'Free', 'free'::billing_plan_tier, 'Perfect for personal projects, prototypes and evaluation. One organization per user.', 0, TRUE, TRUE, FALSE, 'starter', NULL, 1),
  ('starter', 1, 'Starter', 'starter'::billing_plan_tier, 'Production-ready observability for small teams. One organization per user.', 14, TRUE, TRUE, FALSE, 'growth', 'Popular', 2),
  ('growth', 1, 'Growth', 'growth'::billing_plan_tier, 'Scaling teams requiring advanced observability and AI capabilities. One organization per user.', 14, TRUE, TRUE, FALSE, 'business', 'Recommended', 3),
  ('business', 1, 'Business', 'business'::billing_plan_tier, 'Enterprise-ready monitoring with governance, security and automation. One organization per user.', 14, TRUE, TRUE, FALSE, 'enterprise', 'Best Value', 4),
  ('enterprise', 1, 'Enterprise', 'enterprise'::billing_plan_tier, 'Custom enterprise deployment with unlimited scale and dedicated support. One organization per user.', 30, FALSE, TRUE, TRUE, NULL, NULL, 5)
)
INSERT INTO plans
  (key, version, name, tier, description, trial_days, is_public, is_active, is_customizable, next_plan_key, badge, sort_order)
SELECT key, version, name, tier, description, trial_days, is_public, is_active, is_customizable, next_plan_key, badge, sort_order
FROM plan_seed
ON CONFLICT (key, version) DO UPDATE
SET name = EXCLUDED.name,
    tier = EXCLUDED.tier,
    description = EXCLUDED.description,
    trial_days = EXCLUDED.trial_days,
    is_public = EXCLUDED.is_public,
    is_active = EXCLUDED.is_active,
    is_customizable = EXCLUDED.is_customizable,
    next_plan_key = EXCLUDED.next_plan_key,
    badge = EXCLUDED.badge,
    sort_order = EXCLUDED.sort_order,
    deleted_at = NULL,
    updated_at = NOW();

WITH price_seed(plan_key, provider, billing_interval, currency, amount_minor, is_default, metadata) AS (
VALUES
  ('free', 'system'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 0, TRUE, '{"display":"$0/mo","recommended":false}'::jsonb),
  ('free', 'system'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 0, FALSE, '{"display":"$0/year","discount":"2 months free"}'::jsonb),
  ('starter', 'stripe'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 1500, TRUE, '{"display":"$15/mo","recommended":false}'::jsonb),
  ('starter', 'stripe'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 15000, FALSE, '{"display":"$150/year","discount":"2 months free"}'::jsonb),
  ('growth', 'stripe'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 4900, TRUE, '{"display":"$49/mo","recommended":true}'::jsonb),
  ('growth', 'stripe'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 49000, FALSE, '{"display":"$490/year","discount":"2 months free"}'::jsonb),
  ('business', 'stripe'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 14900, TRUE, '{"display":"$149/mo","recommended":false}'::jsonb),
  ('business', 'stripe'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 149000, FALSE, '{"display":"$1490/year","discount":"2 months free"}'::jsonb),
  ('enterprise', 'system'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 0, TRUE, '{"display":"Contact Sales","contactSales":true}'::jsonb),
  ('enterprise', 'system'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 0, FALSE, '{"display":"Contact Sales","contactSales":true}'::jsonb)
)
INSERT INTO plan_prices
  (plan_id, provider, billing_interval, currency, amount_minor, provider_price_id, is_default, starts_at, ends_at, metadata)
SELECT p.id, ps.provider, ps.billing_interval, ps.currency, ps.amount_minor, NULL::text, ps.is_default, '-infinity'::timestamptz, NULL::timestamptz, ps.metadata
FROM price_seed ps
JOIN plans p ON p.key = ps.plan_key AND p.version = 1 AND p.deleted_at IS NULL
ON CONFLICT (plan_id, provider, billing_interval, currency, starts_at) DO UPDATE
SET amount_minor = EXCLUDED.amount_minor,
    provider_price_id = EXCLUDED.provider_price_id,
    is_default = EXCLUDED.is_default,
    ends_at = EXCLUDED.ends_at,
    metadata = EXCLUDED.metadata,
    deleted_at = NULL,
    updated_at = NOW();

-- ============================================================
-- Source: 20_seeders/005_11_billing_catalog_features.sql
-- ============================================================

-- =============================================================================
-- Seeder File: 005_11_billing_catalog_features.sql
-- Description: Seeds JSON-derived billing feature registry
-- Catalog Version: 2.0
-- Source: billing_catalog_response.preview.json
-- =============================================================================

WITH feature_seed(feature_key, feature_name, description, category, value_type, module, usage_behavior, configuration, is_public, is_module_root, sort_order, metadata) AS (
VALUES
  ('organization.enabled', 'Organization Management', 'Create and manage your organization workspace', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'organization', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 1, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('organization.max_orgs_per_user', 'Max Organizations Per User', 'Maximum number of organizations a single user can create or join', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'organization', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"organizations","scope":"user"}'::jsonb, TRUE, FALSE, 2, '{"catalog":"billing-preview-v2","scope":"user","unit":"organizations","supportsUnlimited":false}'::jsonb),
  ('projects.enabled', 'Projects Platform', 'Create projects to isolate different services or environments', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'projects', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 3, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('quota.projects', 'Projects Quota', 'Maximum number of projects per organization', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"projects","scope":"organization"}'::jsonb, TRUE, FALSE, 4, '{"catalog":"billing-preview-v2","scope":"organization","unit":"projects","supportsUnlimited":true}'::jsonb),
  ('quota.members', 'Team Members Quota', 'Maximum number of team members per organization', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"members","scope":"organization"}'::jsonb, TRUE, FALSE, 5, '{"catalog":"billing-preview-v2","scope":"organization","unit":"members","supportsUnlimited":true}'::jsonb),
  ('quota.environments', 'Environments Quota', 'Maximum number of environments per project (e.g., dev, staging, prod)', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"environments","scope":"project"}'::jsonb, TRUE, FALSE, 6, '{"catalog":"billing-preview-v2","scope":"project","unit":"environments","supportsUnlimited":true}'::jsonb),
  ('quota.api_keys', 'API Keys Quota', 'Maximum number of API keys per project for ingestion authentication', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"api_keys","scope":"project"}'::jsonb, TRUE, FALSE, 7, '{"catalog":"billing-preview-v2","scope":"project","unit":"api_keys","supportsUnlimited":true}'::jsonb),
  ('quota.monthly_events', 'Monthly Billable Credits', 'Maximum billable credits consumed per calendar month', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'overage'::billing_usage_behavior, '{"enforcementType":"overage","unit":"credits","scope":"organization"}'::jsonb, TRUE, FALSE, 8, '{"catalog":"billing-preview-v2","scope":"organization","unit":"credits","supportsUnlimited":true}'::jsonb),
  ('quota.requests_per_second', 'Rate Limit (RPS)', 'Maximum sustained ingestion rate per second', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'throttle'::billing_usage_behavior, '{"enforcementType":"throttle","unit":"requests/sec","scope":"organization"}'::jsonb, TRUE, FALSE, 9, '{"catalog":"billing-preview-v2","scope":"organization","unit":"requests/sec","supportsUnlimited":true}'::jsonb),
  ('sdk.enabled', 'SDK Ingestion', 'Use official SDKs to send data to the platform', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'sdk', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 10, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('sdk.remote_config', 'SDK Remote Config', 'Update SDK behavior remotely without redeploying', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'sdk', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"project"}'::jsonb, TRUE, FALSE, 11, '{"catalog":"billing-preview-v2","scope":"project","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('sdk.retry', 'SDK Exponential Retry', 'Automatic retry with exponential backoff on failed ingestion', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'sdk', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"project"}'::jsonb, TRUE, FALSE, 12, '{"catalog":"billing-preview-v2","scope":"project","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('sdk.batching', 'SDK Batching', 'Batch multiple events into a single network request for efficiency', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'sdk', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"project"}'::jsonb, TRUE, FALSE, 13, '{"catalog":"billing-preview-v2","scope":"project","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('sdk.offline_queue', 'SDK Offline Queue', 'Queue events locally when network is unavailable and send when back online', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'sdk', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"project"}'::jsonb, TRUE, FALSE, 14, '{"catalog":"billing-preview-v2","scope":"project","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('sdk.dynamic_sampling', 'SDK Dynamic Sampling', 'Dynamically adjust sampling rates based on server-side configuration', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'sdk', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"project"}'::jsonb, TRUE, FALSE, 15, '{"catalog":"billing-preview-v2","scope":"project","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('quota.sdk_batch_queue_size', 'SDK Batch Max Queue Size', 'Maximum number of events the SDK will hold in memory before flushing', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"events","scope":"project"}'::jsonb, TRUE, FALSE, 16, '{"catalog":"billing-preview-v2","scope":"project","unit":"events","supportsUnlimited":true}'::jsonb),
  ('quota.sdk_offline_queue_limit', 'SDK Offline Queue Limit', 'Maximum number of events the SDK will queue when offline', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"events","scope":"project"}'::jsonb, TRUE, FALSE, 17, '{"catalog":"billing-preview-v2","scope":"project","unit":"events","supportsUnlimited":true}'::jsonb),
  ('privacy.data_scrubbing', 'PII Data Scrubbing', 'Automatically scrub personally identifiable information from events', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'privacy', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 18, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('privacy.capture_headers', 'Capture HTTP Headers', 'Capture and store HTTP headers with each event', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'privacy', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"project"}'::jsonb, TRUE, FALSE, 19, '{"catalog":"billing-preview-v2","scope":"project","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('privacy.capture_body', 'Capture HTTP Body', 'Capture and store HTTP request/response bodies', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'privacy', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"project"}'::jsonb, TRUE, FALSE, 20, '{"catalog":"billing-preview-v2","scope":"project","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('privacy.capture_ip', 'Capture Client IP', 'Capture and store client IP addresses', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'privacy', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"project"}'::jsonb, TRUE, FALSE, 21, '{"catalog":"billing-preview-v2","scope":"project","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('error_tracking.enabled', 'Error Tracking', 'Track and aggregate application errors and exceptions', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'error_tracking', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 22, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('tracing.enabled', 'Distributed Tracing', 'Trace requests across services to identify latency bottlenecks', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'tracing', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 23, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('logging.enabled', 'Structured Logging', 'Ingest and search structured log data', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'logging', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 24, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('metrics.enabled', 'Custom Metrics', 'Ingest custom time-series metrics and build dashboards', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'metrics', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 25, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('profiling.enabled', 'Continuous Profiling', 'Profile CPU and memory usage in production with minimal overhead', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'profiling', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 26, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('replay.enabled', 'Session Replay', 'Record and replay user sessions to reproduce issues', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'replay', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 27, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('uptime.enabled', 'Uptime & Cron Monitoring', 'Monitor endpoint uptime and cron job execution', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'uptime', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 28, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('cron_monitoring.enabled', 'Cron Job Monitoring', 'Dedicated cron job heartbeat monitoring with alerting on missed runs', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'cron_monitoring', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 29, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('quota.retention_days', 'Default Retention Days', 'Default data retention period for all event types', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"days","scope":"organization"}'::jsonb, TRUE, FALSE, 30, '{"catalog":"billing-preview-v2","scope":"organization","unit":"days","supportsUnlimited":true}'::jsonb),
  ('quota.log_retention_days', 'Log Retention Days', 'Retention period for structured log data', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"days","scope":"organization"}'::jsonb, TRUE, FALSE, 31, '{"catalog":"billing-preview-v2","scope":"organization","unit":"days","supportsUnlimited":true}'::jsonb),
  ('quota.metric_retention_days', 'Metric Retention Days', 'Retention period for custom metrics', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"days","scope":"organization"}'::jsonb, TRUE, FALSE, 32, '{"catalog":"billing-preview-v2","scope":"organization","unit":"days","supportsUnlimited":true}'::jsonb),
  ('quota.profile_retention_days', 'Profile Retention Days', 'Retention period for continuous profiling data', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"days","scope":"organization"}'::jsonb, TRUE, FALSE, 33, '{"catalog":"billing-preview-v2","scope":"organization","unit":"days","supportsUnlimited":true}'::jsonb),
  ('quota.replay_retention_days', 'Session Replay Retention Days', 'Retention period for session replay recordings', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"days","scope":"organization"}'::jsonb, TRUE, FALSE, 34, '{"catalog":"billing-preview-v2","scope":"organization","unit":"days","supportsUnlimited":true}'::jsonb),
  ('quota.trace_retention_days', 'Trace Retention Days', 'Retention period for distributed trace data', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"days","scope":"organization"}'::jsonb, TRUE, FALSE, 35, '{"catalog":"billing-preview-v2","scope":"organization","unit":"days","supportsUnlimited":true}'::jsonb),
  ('quota.audit_log_retention_days', 'Audit Log Retention Days', 'Retention period for security audit logs', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"days","scope":"organization"}'::jsonb, TRUE, FALSE, 36, '{"catalog":"billing-preview-v2","scope":"organization","unit":"days","supportsUnlimited":true}'::jsonb),
  ('alerting.enabled', 'Alerting Platform', 'Create and manage alerts based on metric thresholds and event patterns', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'alerting', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 37, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('alerting.rules', 'Alert Rules Feature', 'Define alert rules with custom conditions and thresholds', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'alerting', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 38, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('alerting.routing.enabled', 'Advanced Alert Routing', 'Route alerts to different teams or channels based on severity or source', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'alerting', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 39, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('alerting.composite', 'Composite Alerts', 'Combine multiple conditions into a single composite alert', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'alerting', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 40, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('alerting.escalation_policies', 'Escalation Policies', 'Automatically escalate unacknowledged alerts through predefined chains', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'alerting', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 41, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('alerting.on_call', 'On-Call Schedules', 'Manage on-call rotations and schedules for incident response', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'alerting', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 42, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('alerting.incident_timeline', 'Incident Timeline', 'Track incident lifecycle from detection to resolution with timeline view', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'alerting', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 43, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('alerting.managed_email_fallback', 'Managed Email Fallback', 'Send alert notifications via managed email delivery when primary channels fail', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'alerting', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 44, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('alerting.ai_alert', 'AI Alert Insights', 'AI-powered alert correlation, noise reduction, and intelligent grouping', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'alerting', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 45, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('quota.alert_rules', 'Organization Alert Rules Quota', 'Maximum number of alert rules at organization level', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"rules","scope":"organization"}'::jsonb, TRUE, FALSE, 46, '{"catalog":"billing-preview-v2","scope":"organization","unit":"rules","supportsUnlimited":true}'::jsonb),
  ('quota.project_alert_rules', 'Project Alert Rules Quota', 'Maximum number of alert rules per project', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"rules","scope":"project"}'::jsonb, TRUE, FALSE, 47, '{"catalog":"billing-preview-v2","scope":"project","unit":"rules","supportsUnlimited":true}'::jsonb),
  ('quota.alert_channels', 'Alert Channels Quota', 'Maximum number of alert notification channels', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"channels","scope":"organization"}'::jsonb, TRUE, FALSE, 48, '{"catalog":"billing-preview-v2","scope":"organization","unit":"channels","supportsUnlimited":true}'::jsonb),
  ('quota.notification_channels', 'Notification Channels Quota', 'Maximum number of general notification channels', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"channels","scope":"organization"}'::jsonb, TRUE, FALSE, 49, '{"catalog":"billing-preview-v2","scope":"organization","unit":"channels","supportsUnlimited":true}'::jsonb),
  ('quota.project_notification_channels', 'Project Notification Channels Quota', 'Maximum number of notification channels per project', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"channels","scope":"project"}'::jsonb, TRUE, FALSE, 50, '{"catalog":"billing-preview-v2","scope":"project","unit":"channels","supportsUnlimited":true}'::jsonb),
  ('quota.routing_rules', 'Routing Rules Quota', 'Maximum number of alert routing rules at organization level', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"rules","scope":"organization"}'::jsonb, TRUE, FALSE, 51, '{"catalog":"billing-preview-v2","scope":"organization","unit":"rules","supportsUnlimited":true}'::jsonb),
  ('quota.project_routing_rules', 'Project Routing Rules Quota', 'Maximum number of routing rules per project', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"rules","scope":"project"}'::jsonb, TRUE, FALSE, 52, '{"catalog":"billing-preview-v2","scope":"project","unit":"rules","supportsUnlimited":true}'::jsonb),
  ('quota.daily_alerts', 'Daily Alert Notifications', 'Maximum number of alert notifications sent per day', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"notifications","scope":"organization"}'::jsonb, TRUE, FALSE, 53, '{"catalog":"billing-preview-v2","scope":"organization","unit":"notifications","supportsUnlimited":true}'::jsonb),
  ('quota.monthly_alerts', 'Monthly Alert Notifications', 'Maximum number of alert notifications sent per month', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'overage'::billing_usage_behavior, '{"enforcementType":"overage","unit":"notifications","scope":"organization"}'::jsonb, TRUE, FALSE, 54, '{"catalog":"billing-preview-v2","scope":"organization","unit":"notifications","supportsUnlimited":true}'::jsonb),
  ('quota.connector_sends', 'Monthly Connector Sends', 'Maximum number of messages sent through integration connectors per month', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'overage'::billing_usage_behavior, '{"enforcementType":"overage","unit":"sends","scope":"organization"}'::jsonb, TRUE, FALSE, 55, '{"catalog":"billing-preview-v2","scope":"organization","unit":"sends","supportsUnlimited":true}'::jsonb),
  ('automation.enabled', 'Automation Platform', 'Automate workflows triggered by events, alerts, or schedules', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'automation', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 56, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('quota.automation_rules', 'Automation Rules Quota', 'Maximum number of automation rules', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"rules","scope":"organization"}'::jsonb, TRUE, FALSE, 57, '{"catalog":"billing-preview-v2","scope":"organization","unit":"rules","supportsUnlimited":true}'::jsonb),
  ('dashboards.enabled', 'Dashboards Platform', 'Create and share dashboards to visualize metrics and logs', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'dashboards', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 58, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('dashboards.custom_dashboards', 'Custom Dashboards', 'Build fully custom dashboards with drag-and-drop widgets', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'dashboards', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 59, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('dashboards.custom_widgets', 'Custom Widgets', 'Create custom visualization widgets for dashboards', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'dashboards', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 60, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('dashboards.embeds', 'Dashboard Embeds', 'Embed dashboards in external applications via iframe', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'dashboards', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 61, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('dashboards.public_links', 'Public Dashboard Links', 'Share dashboards via public read-only URLs without authentication', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'dashboards', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 62, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('dashboards.scheduled_reports', 'Scheduled Reports', 'Schedule automated dashboard report generation and delivery', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'dashboards', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 63, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('quota.dashboards', 'Dashboards Quota', 'Maximum number of custom dashboards', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"dashboards","scope":"organization"}'::jsonb, TRUE, FALSE, 64, '{"catalog":"billing-preview-v2","scope":"organization","unit":"dashboards","supportsUnlimited":true}'::jsonb),
  ('quota.monthly_reports', 'Monthly Report Generation Limit', 'Maximum number of scheduled reports generated per month', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"reports","scope":"organization"}'::jsonb, TRUE, FALSE, 65, '{"catalog":"billing-preview-v2","scope":"organization","unit":"reports","supportsUnlimited":true}'::jsonb),
  ('analytics.explorer', 'Analytics Explorer', 'Ad-hoc query interface for exploring events and logs', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'analytics', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 66, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('analytics.query_builder', 'Analytics Query Builder', 'Visual query builder for complex analytics without writing code', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'analytics', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 67, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('ai.enabled', 'AI Insights Platform', 'AI-powered analysis and insights across your observability data', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'ai', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 68, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('ai.summaries', 'AI Incident & Log Summaries', 'Auto-generate human-readable summaries of incidents and log patterns', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'ai', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 69, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('ai.root_cause_analysis', 'AI Root Cause Analysis', 'AI-assisted identification of incident root causes across traces and logs', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'ai', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 70, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('ai.anomaly_detection', 'AI Anomaly Detection', 'Automatically detect anomalous patterns in metrics and logs', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'ai', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 71, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('ai.forecasting', 'AI Metric Forecasting', 'Predict future metric trends and capacity needs using historical data', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'ai', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 72, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('ai.incident_copilot', 'AI Incident Copilot', 'Real-time AI assistant during incident response with suggested actions', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'ai', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 73, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('quota.ai_credits', 'Monthly AI Credits', 'Monthly quota of AI processing credits for insights, summaries, and analysis', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"credits","scope":"organization"}'::jsonb, TRUE, FALSE, 74, '{"catalog":"billing-preview-v2","scope":"organization","unit":"credits","supportsUnlimited":true}'::jsonb),
  ('integrations.enabled', 'Integrations Platform', 'Connect external tools and services to your observability data', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 75, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.rest_api', 'REST API Access', 'Full REST API access for programmatic data ingestion and querying', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 76, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('quota.connectors', 'Connector Instances Quota', 'Maximum number of active connector instances', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"connectors","scope":"organization"}'::jsonb, TRUE, FALSE, 77, '{"catalog":"billing-preview-v2","scope":"organization","unit":"connectors","supportsUnlimited":true}'::jsonb),
  ('quota.integrations', 'Integrations Quota', 'Maximum number of third-party integrations configured', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"integrations","scope":"organization"}'::jsonb, TRUE, FALSE, 78, '{"catalog":"billing-preview-v2","scope":"organization","unit":"integrations","supportsUnlimited":true}'::jsonb),
  ('integrations.email', 'Email Connector', 'Send notifications and reports via email', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 79, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.webhook', 'Webhook Connector', 'Send event data to custom HTTP endpoints', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 80, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.slack', 'Slack Connector', 'Send alerts and summaries to Slack channels', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 81, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.discord', 'Discord Connector', 'Send alerts and summaries to Discord channels', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 82, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.microsoft_teams', 'Microsoft Teams Connector', 'Send alerts and summaries to Microsoft Teams', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 83, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.pagerduty', 'PagerDuty Connector', 'Trigger and manage PagerDuty incidents from alerts', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 84, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.sms', 'SMS Connector', 'Send critical alert notifications via SMS', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 85, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.github', 'GitHub Integration', 'Link errors to GitHub issues and track code changes', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 86, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.gitlab', 'GitLab Integration', 'Link errors to GitLab issues and track merge requests', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 87, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.bitbucket', 'Bitbucket Integration', 'Link errors to Bitbucket issues and track commits', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 88, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.jira', 'Jira Integration', 'Create and update Jira tickets from alerts and incidents', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 89, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('integrations.terraform', 'Terraform Provider', 'Manage resources via official Terraform provider', 'integration'::billing_feature_category, 'boolean'::billing_feature_value_type, 'integrations', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 90, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('security.enabled', 'Enterprise Security', 'Enterprise-grade security controls and compliance features', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'security', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 91, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('security.audit_logs', 'Audit Logs', 'Immutable audit logs of all administrative actions', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'security', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 92, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('security.sso', 'SAML 2.0 & OIDC SSO', 'Single sign-on via SAML 2.0 and OpenID Connect', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'security', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 93, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('security.scim', 'SCIM 2.0 User Provisioning', 'Automated user provisioning and deprovisioning via SCIM', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'security', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 94, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('security.custom_roles', 'Custom RBAC Roles', 'Define custom role-based access control policies', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'security', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 95, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('quota.service_accounts', 'Service Accounts Quota', 'Maximum number of API service accounts for automated access', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"accounts","scope":"organization"}'::jsonb, TRUE, FALSE, 96, '{"catalog":"billing-preview-v2","scope":"organization","unit":"accounts","supportsUnlimited":true}'::jsonb),
  ('quota.custom_roles', 'Custom Roles Quota', 'Maximum number of custom RBAC roles', 'quota'::billing_feature_category, 'integer'::billing_feature_value_type, 'quota', 'hard_limit'::billing_usage_behavior, '{"enforcementType":"hard_limit","unit":"roles","scope":"organization"}'::jsonb, TRUE, FALSE, 97, '{"catalog":"billing-preview-v2","scope":"organization","unit":"roles","supportsUnlimited":true}'::jsonb),
  ('support.dedicated', 'Dedicated Support', 'Access to dedicated customer success manager and priority support queue', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'support', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 98, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('support.sla', 'Support SLA', 'Guaranteed response time for support tickets (e.g., 99.9% uptime SLA)', 'feature'::billing_feature_category, 'string'::billing_feature_value_type, 'support', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"string","scope":"organization"}'::jsonb, TRUE, FALSE, 99, '{"catalog":"billing-preview-v2","scope":"organization","unit":"string","supportsUnlimited":false}'::jsonb),
  ('deployment.custom', 'Custom Deployment', 'On-premise, VPC, or private cloud deployment options', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'deployment', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 100, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('compliance.hipaa', 'HIPAA Compliance', 'HIPAA-compliant data handling and Business Associate Agreement', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'compliance', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 101, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb),
  ('compliance.gdpr_dpa', 'GDPR Data Processing Agreement', 'Signed Data Processing Agreement for GDPR compliance', 'feature'::billing_feature_category, 'boolean'::billing_feature_value_type, 'compliance', 'none'::billing_usage_behavior, '{"enforcementType":"none","unit":"boolean","scope":"organization"}'::jsonb, TRUE, FALSE, 102, '{"catalog":"billing-preview-v2","scope":"organization","unit":"boolean","supportsUnlimited":false}'::jsonb)
)
INSERT INTO billing_features
  (feature_key, feature_name, description, category, value_type, module, usage_behavior, configuration, is_public, is_module_root, sort_order, is_billable, metadata)
SELECT feature_key, feature_name, description, category, value_type, module, usage_behavior, configuration, is_public, is_module_root, sort_order, TRUE, metadata
FROM feature_seed
ON CONFLICT (feature_key) DO UPDATE
SET feature_name = EXCLUDED.feature_name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    value_type = EXCLUDED.value_type,
    module = EXCLUDED.module,
    usage_behavior = EXCLUDED.usage_behavior,
    configuration = EXCLUDED.configuration,
    is_public = EXCLUDED.is_public,
    is_module_root = EXCLUDED.is_module_root,
    sort_order = EXCLUDED.sort_order,
    is_billable = EXCLUDED.is_billable,
    metadata = EXCLUDED.metadata,
    deleted_at = NULL,
    updated_at = NOW();

-- ============================================================
-- Source: 20_seeders/006_11_billing_catalog_plan_entitlements.sql
-- ============================================================

-- =============================================================================
-- Seeder File: 006_11_billing_catalog_plan_entitlements.sql
-- Description: Seeds JSON-derived plan feature entitlements
-- Catalog Version: 2.0
-- Source: billing_catalog_response.preview.json
-- =============================================================================

WITH entitlement_seed(plan_key, feature_key, boolean_value, integer_value, decimal_value, string_value, metadata, configuration) AS (
VALUES
  ('free', 'organization.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'organization.max_orgs_per_user', NULL::boolean, 1, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"organizations","scope":"user","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'projects.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'quota.projects', NULL::boolean, 1, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"projects","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.members', NULL::boolean, 3, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"members","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.environments', NULL::boolean, 2, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"environments","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.api_keys', NULL::boolean, 2, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"api_keys","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.monthly_events', NULL::boolean, 10000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.requests_per_second', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"requests/sec","scope":"organization","enforcementType":"throttle"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'sdk.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'sdk.remote_config', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'sdk.retry', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'sdk.batching', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'sdk.offline_queue', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'sdk.dynamic_sampling', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'quota.sdk_batch_queue_size', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.sdk_offline_queue_limit', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'privacy.data_scrubbing', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'privacy.capture_headers', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'privacy.capture_body', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'privacy.capture_ip', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'error_tracking.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'tracing.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'logging.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'metrics.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'profiling.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'replay.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'uptime.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'cron_monitoring.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'quota.retention_days', NULL::boolean, 7, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.log_retention_days', NULL::boolean, 7, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.metric_retention_days', NULL::boolean, 7, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.profile_retention_days', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.replay_retention_days', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.trace_retention_days', NULL::boolean, 7, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.audit_log_retention_days', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'alerting.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'alerting.rules', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'alerting.routing.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'alerting.composite', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'alerting.escalation_policies', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'alerting.on_call', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'alerting.incident_timeline', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'alerting.managed_email_fallback', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'alerting.ai_alert', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'quota.alert_rules', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.project_alert_rules', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.alert_channels', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.notification_channels', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.project_notification_channels', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.routing_rules', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.project_routing_rules', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.daily_alerts', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.monthly_alerts', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.connector_sends', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"sends","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'automation.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'quota.automation_rules', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'dashboards.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'dashboards.custom_dashboards', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'dashboards.custom_widgets', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'dashboards.embeds', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'dashboards.public_links', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'dashboards.scheduled_reports', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'quota.dashboards', NULL::boolean, 1, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"dashboards","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.monthly_reports', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"reports","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'analytics.explorer', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'analytics.query_builder', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'ai.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'ai.summaries', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'ai.root_cause_analysis', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'ai.anomaly_detection', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'ai.forecasting', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'ai.incident_copilot', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'quota.ai_credits', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'integrations.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.rest_api', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'quota.connectors', NULL::boolean, 2, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"connectors","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.integrations', NULL::boolean, 2, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"integrations","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'integrations.email', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.webhook', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.slack', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.discord', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.microsoft_teams', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.pagerduty', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.sms', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.github', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.gitlab', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.bitbucket', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.jira', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'integrations.terraform', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'security.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'security.audit_logs', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'security.sso', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'security.scim', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'security.custom_roles', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'quota.service_accounts', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"accounts","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'quota.custom_roles', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"roles","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('free', 'support.dedicated', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'support.sla', NULL::boolean, NULL::bigint, NULL::numeric, NULL, '{"catalog":"billing-preview-v2","unit":"string","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'deployment.custom', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'compliance.hipaa', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('free', 'compliance.gdpr_dpa', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'organization.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'organization.max_orgs_per_user', NULL::boolean, 1, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"organizations","scope":"user","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'projects.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'quota.projects', NULL::boolean, 5, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"projects","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.members', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"members","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.environments', NULL::boolean, 5, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"environments","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.api_keys', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"api_keys","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.monthly_events', NULL::boolean, 150000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.requests_per_second', NULL::boolean, 250, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"requests/sec","scope":"organization","enforcementType":"throttle"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'sdk.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'sdk.remote_config', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'sdk.retry', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'sdk.batching', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'sdk.offline_queue', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'sdk.dynamic_sampling', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'quota.sdk_batch_queue_size', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.sdk_offline_queue_limit', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'privacy.data_scrubbing', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'privacy.capture_headers', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'privacy.capture_body', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'privacy.capture_ip', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'error_tracking.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'tracing.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'logging.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'metrics.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'profiling.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'replay.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'uptime.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'cron_monitoring.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'quota.retention_days', NULL::boolean, 30, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.log_retention_days', NULL::boolean, 30, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.metric_retention_days', NULL::boolean, 30, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.profile_retention_days', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.replay_retention_days', NULL::boolean, 7, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.trace_retention_days', NULL::boolean, 30, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.audit_log_retention_days', NULL::boolean, 30, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'alerting.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'alerting.rules', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'alerting.routing.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'alerting.composite', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'alerting.escalation_policies', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'alerting.on_call', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'alerting.incident_timeline', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'alerting.managed_email_fallback', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'alerting.ai_alert', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'quota.alert_rules', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.project_alert_rules', NULL::boolean, 5, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.alert_channels', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.notification_channels', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.project_notification_channels', NULL::boolean, 3, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.routing_rules', NULL::boolean, 2, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.project_routing_rules', NULL::boolean, 1, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.daily_alerts', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.monthly_alerts', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.connector_sends', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"sends","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'automation.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'quota.automation_rules', NULL::boolean, 5, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'dashboards.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'dashboards.custom_dashboards', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'dashboards.custom_widgets', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'dashboards.embeds', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'dashboards.public_links', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'dashboards.scheduled_reports', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'quota.dashboards', NULL::boolean, 3, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"dashboards","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.monthly_reports', NULL::boolean, 5, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"reports","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'analytics.explorer', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'analytics.query_builder', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'ai.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'ai.summaries', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'ai.root_cause_analysis', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'ai.anomaly_detection', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'ai.forecasting', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'ai.incident_copilot', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'quota.ai_credits', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'integrations.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.rest_api', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'quota.connectors', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"connectors","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.integrations', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"integrations","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'integrations.email', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.webhook', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.slack', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.discord', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.microsoft_teams', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.pagerduty', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.sms', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.github', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.gitlab', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.bitbucket', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.jira', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'integrations.terraform', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'security.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'security.audit_logs', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'security.sso', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'security.scim', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'security.custom_roles', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'quota.service_accounts', NULL::boolean, 2, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"accounts","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'quota.custom_roles', NULL::boolean, 0, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"roles","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('starter', 'support.dedicated', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'support.sla', NULL::boolean, NULL::bigint, NULL::numeric, NULL, '{"catalog":"billing-preview-v2","unit":"string","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'deployment.custom', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'compliance.hipaa', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('starter', 'compliance.gdpr_dpa', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'organization.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'organization.max_orgs_per_user', NULL::boolean, 1, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"organizations","scope":"user","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'projects.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'quota.projects', NULL::boolean, 25, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"projects","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.members', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"members","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.environments', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"environments","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.api_keys', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"api_keys","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.monthly_events', NULL::boolean, 1000000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.requests_per_second', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"requests/sec","scope":"organization","enforcementType":"throttle"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'sdk.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'sdk.remote_config', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'sdk.retry', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'sdk.batching', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'sdk.offline_queue', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'sdk.dynamic_sampling', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'quota.sdk_batch_queue_size', NULL::boolean, 10000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.sdk_offline_queue_limit', NULL::boolean, 5000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'privacy.data_scrubbing', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'privacy.capture_headers', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'privacy.capture_body', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'privacy.capture_ip', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'error_tracking.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'tracing.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'logging.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'metrics.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'profiling.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'replay.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'uptime.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'cron_monitoring.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'quota.retention_days', NULL::boolean, 90, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.log_retention_days', NULL::boolean, 90, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.metric_retention_days', NULL::boolean, 90, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.profile_retention_days', NULL::boolean, 90, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.replay_retention_days', NULL::boolean, 30, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.trace_retention_days', NULL::boolean, 90, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.audit_log_retention_days', NULL::boolean, 180, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'alerting.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'alerting.rules', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'alerting.routing.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'alerting.composite', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'alerting.escalation_policies', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'alerting.on_call', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'alerting.incident_timeline', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'alerting.managed_email_fallback', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'alerting.ai_alert', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'quota.alert_rules', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.project_alert_rules', NULL::boolean, 25, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.alert_channels', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.notification_channels', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.project_notification_channels', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.routing_rules', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.project_routing_rules', NULL::boolean, 5, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.daily_alerts', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.monthly_alerts', NULL::boolean, 10000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.connector_sends', NULL::boolean, 10000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"sends","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'automation.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'quota.automation_rules', NULL::boolean, 25, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'dashboards.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'dashboards.custom_dashboards', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'dashboards.custom_widgets', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'dashboards.embeds', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'dashboards.public_links', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'dashboards.scheduled_reports', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'quota.dashboards', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"dashboards","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.monthly_reports', NULL::boolean, 25, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"reports","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'analytics.explorer', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'analytics.query_builder', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'ai.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'ai.summaries', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'ai.root_cause_analysis', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'ai.anomaly_detection', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'ai.forecasting', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'ai.incident_copilot', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'quota.ai_credits', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'integrations.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.rest_api', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'quota.connectors', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"connectors","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.integrations', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"integrations","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'integrations.email', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.webhook', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.slack', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.discord', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.microsoft_teams', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.pagerduty', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.sms', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.github', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.gitlab', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.bitbucket', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.jira', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'integrations.terraform', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'security.enabled', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'security.audit_logs', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'security.sso', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'security.scim', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'security.custom_roles', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'quota.service_accounts', NULL::boolean, 10, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"accounts","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'quota.custom_roles', NULL::boolean, 25, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"roles","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('growth', 'support.dedicated', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'support.sla', NULL::boolean, NULL::bigint, NULL::numeric, NULL, '{"catalog":"billing-preview-v2","unit":"string","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'deployment.custom', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'compliance.hipaa', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('growth', 'compliance.gdpr_dpa', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'organization.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'organization.max_orgs_per_user', NULL::boolean, 1, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"organizations","scope":"user","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'projects.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'quota.projects', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"projects","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.members', NULL::boolean, 250, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"members","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.environments', NULL::boolean, 25, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"environments","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.api_keys', NULL::boolean, 250, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"api_keys","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.monthly_events', NULL::boolean, 8000000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.requests_per_second', NULL::boolean, 5000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"requests/sec","scope":"organization","enforcementType":"throttle"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'sdk.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'sdk.remote_config', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'sdk.retry', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'sdk.batching', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'sdk.offline_queue', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'sdk.dynamic_sampling', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'quota.sdk_batch_queue_size', NULL::boolean, 50000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.sdk_offline_queue_limit', NULL::boolean, 25000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'privacy.data_scrubbing', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'privacy.capture_headers', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'privacy.capture_body', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'privacy.capture_ip', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'error_tracking.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'tracing.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'logging.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'metrics.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'profiling.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'replay.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'uptime.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'cron_monitoring.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'quota.retention_days', NULL::boolean, 180, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.log_retention_days', NULL::boolean, 180, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.metric_retention_days', NULL::boolean, 180, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.profile_retention_days', NULL::boolean, 180, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.replay_retention_days', NULL::boolean, 90, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.trace_retention_days', NULL::boolean, 180, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.audit_log_retention_days', NULL::boolean, 365, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'alerting.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'alerting.rules', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'alerting.routing.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'alerting.composite', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'alerting.escalation_policies', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'alerting.on_call', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'alerting.incident_timeline', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'alerting.managed_email_fallback', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'alerting.ai_alert', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'quota.alert_rules', NULL::boolean, 250, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.project_alert_rules', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.alert_channels', NULL::boolean, 250, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.notification_channels', NULL::boolean, 250, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.project_notification_channels', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.routing_rules', NULL::boolean, 50, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.project_routing_rules', NULL::boolean, 25, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.daily_alerts', NULL::boolean, 10000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.monthly_alerts', NULL::boolean, 100000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.connector_sends', NULL::boolean, 100000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"sends","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'automation.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'quota.automation_rules', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'dashboards.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'dashboards.custom_dashboards', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'dashboards.custom_widgets', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'dashboards.embeds', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'dashboards.public_links', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'dashboards.scheduled_reports', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'quota.dashboards', NULL::boolean, 25, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"dashboards","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.monthly_reports', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"reports","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'analytics.explorer', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'analytics.query_builder', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'ai.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'ai.summaries', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'ai.root_cause_analysis', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'ai.anomaly_detection', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'ai.forecasting', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'ai.incident_copilot', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'quota.ai_credits', NULL::boolean, 5000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'integrations.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.rest_api', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'quota.connectors', NULL::boolean, 250, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"connectors","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.integrations', NULL::boolean, 250, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"integrations","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'integrations.email', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.webhook', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.slack', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.discord', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.microsoft_teams', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.pagerduty', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.sms', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.github', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.gitlab', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.bitbucket', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.jira', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'integrations.terraform', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'security.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'security.audit_logs', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'security.sso', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'security.scim', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'security.custom_roles', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'quota.service_accounts', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"accounts","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'quota.custom_roles', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"roles","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('business', 'support.dedicated', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'support.sla', NULL::boolean, NULL::bigint, NULL::numeric, '99.9%', '{"catalog":"billing-preview-v2","unit":"string","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'deployment.custom', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'compliance.hipaa', FALSE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('business', 'compliance.gdpr_dpa', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'organization.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'organization.max_orgs_per_user', NULL::boolean, 1, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"organizations","scope":"user","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'projects.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'quota.projects', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"projects","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.members', NULL::boolean, 10000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"members","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.environments', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"environments","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.api_keys', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"api_keys","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.monthly_events', NULL::boolean, NULL::bigint, NULL::numeric, 'Custom', '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.requests_per_second', NULL::boolean, 50000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"requests/sec","scope":"organization","enforcementType":"throttle"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'sdk.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'sdk.remote_config', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'sdk.retry', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'sdk.batching', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'sdk.offline_queue', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'sdk.dynamic_sampling', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'quota.sdk_batch_queue_size', NULL::boolean, 100000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.sdk_offline_queue_limit', NULL::boolean, 100000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"events","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'privacy.data_scrubbing', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'privacy.capture_headers', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'privacy.capture_body', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'privacy.capture_ip', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"project","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'error_tracking.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'tracing.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'logging.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'metrics.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'profiling.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'replay.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'uptime.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'cron_monitoring.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'quota.retention_days', NULL::boolean, 365, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.log_retention_days', NULL::boolean, 365, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.metric_retention_days', NULL::boolean, 365, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.profile_retention_days', NULL::boolean, 365, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.replay_retention_days', NULL::boolean, 365, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.trace_retention_days', NULL::boolean, 365, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.audit_log_retention_days', NULL::boolean, 2555, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"days","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'alerting.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'alerting.rules', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'alerting.routing.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'alerting.composite', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'alerting.escalation_policies', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'alerting.on_call', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'alerting.incident_timeline', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'alerting.managed_email_fallback', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'alerting.ai_alert', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'quota.alert_rules', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.project_alert_rules', NULL::boolean, 500, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.alert_channels', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.notification_channels', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.project_notification_channels', NULL::boolean, 250, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"channels","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.routing_rules', NULL::boolean, 200, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.project_routing_rules', NULL::boolean, 100, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"project","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.daily_alerts', NULL::boolean, 100000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.monthly_alerts', NULL::boolean, 1000000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"notifications","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.connector_sends', NULL::boolean, 1000000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"sends","scope":"organization","enforcementType":"overage"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'automation.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'quota.automation_rules', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"rules","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'dashboards.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'dashboards.custom_dashboards', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'dashboards.custom_widgets', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'dashboards.embeds', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'dashboards.public_links', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'dashboards.scheduled_reports', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'quota.dashboards', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"dashboards","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.monthly_reports', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"reports","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'analytics.explorer', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'analytics.query_builder', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'ai.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'ai.summaries', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'ai.root_cause_analysis', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'ai.anomaly_detection', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'ai.forecasting', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'ai.incident_copilot', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'quota.ai_credits', NULL::boolean, 50000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"credits","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'integrations.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.rest_api', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'quota.connectors', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"connectors","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.integrations', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"integrations","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'integrations.email', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.webhook', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.slack', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.discord', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.microsoft_teams', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.pagerduty', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.sms', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.github', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.gitlab', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.bitbucket', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.jira', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'integrations.terraform', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'security.enabled', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'security.audit_logs', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'security.sso', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'security.scim', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'security.custom_roles', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'quota.service_accounts', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"accounts","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'quota.custom_roles', NULL::boolean, 1000, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"roles","scope":"organization","enforcementType":"hard_limit"}'::jsonb, '{"supportsUnlimited":true}'::jsonb),
  ('enterprise', 'support.dedicated', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'support.sla', NULL::boolean, NULL::bigint, NULL::numeric, '99.99%', '{"catalog":"billing-preview-v2","unit":"string","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'deployment.custom', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'compliance.hipaa', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb),
  ('enterprise', 'compliance.gdpr_dpa', TRUE, NULL::bigint, NULL::numeric, NULL::text, '{"catalog":"billing-preview-v2","unit":"boolean","scope":"organization","enforcementType":"none"}'::jsonb, '{"supportsUnlimited":false}'::jsonb)
)
INSERT INTO plan_feature_entitlements
  (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value, metadata, configuration, display_value)
SELECT p.id, bf.id, es.boolean_value, es.integer_value, es.decimal_value, es.string_value, es.metadata, es.configuration,
       CASE
         WHEN es.feature_key = 'quota.monthly_events' AND es.plan_key = 'free' THEN '10K credits/mo'
         WHEN es.feature_key = 'quota.monthly_events' AND es.plan_key = 'starter' THEN '150K credits/mo'
         WHEN es.feature_key = 'quota.monthly_events' AND es.plan_key = 'growth' THEN '1M credits/mo'
         WHEN es.feature_key = 'quota.monthly_events' AND es.plan_key = 'business' THEN '8M credits/mo'
         WHEN es.feature_key = 'quota.monthly_events' AND es.plan_key = 'enterprise' THEN 'Custom'
         ELSE COALESCE(es.string_value, es.integer_value::text, es.decimal_value::text, es.boolean_value::text)
       END
FROM entitlement_seed es
JOIN plans p ON p.key = es.plan_key AND p.version = 1 AND p.deleted_at IS NULL
JOIN billing_features bf ON bf.feature_key = es.feature_key AND bf.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO UPDATE
SET boolean_value = EXCLUDED.boolean_value,
    integer_value = EXCLUDED.integer_value,
    decimal_value = EXCLUDED.decimal_value,
    string_value = EXCLUDED.string_value,
    metadata = EXCLUDED.metadata,
    configuration = EXCLUDED.configuration,
    display_value = EXCLUDED.display_value,
    deleted_at = NULL,
    updated_at = NOW();

-- ============================================================
-- Source: 20_seeders/007_11_billing_event_credit_weights.sql
-- ============================================================

-- =============================================================================
-- Seeder File: 007_11_billing_event_credit_weights.sql
-- Description: Telemetry Event Type Credit Weights for Weighted Billing System
-- Version: 1.0
-- =============================================================================

-- Ensure table exists (idempotent)
CREATE TABLE IF NOT EXISTS billing_event_credit_weights (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(64) NOT NULL UNIQUE,
    credit_weight   NUMERIC(8,4) NOT NULL,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_event_credit_weights_active
    ON billing_event_credit_weights (is_active)
    WHERE is_active = true;

COMMENT ON TABLE billing_event_credit_weights IS
'Stores the credit cost per telemetry event type for weighted credit consumption';

COMMENT ON COLUMN billing_event_credit_weights.event_type IS
'Unique telemetry event type identifier matching SDK event normalization';

COMMENT ON COLUMN billing_event_credit_weights.credit_weight IS
'Multiplier converting one raw event of this type into billable credits';

-- Seed default credit weights across all SDK telemetry event types
INSERT INTO billing_event_credit_weights (event_type, credit_weight, description, is_active)
VALUES
    ('request',       1.0000, 'Full HTTP / RPC request',                true),
    ('error',         1.5000, 'Error / Exception',                       true),
    ('trace',         0.5000, 'Distributed trace root',                 true),
    ('span',          0.2500, 'Individual span',                        true),
    ('log',           0.1200, 'Log line',                               true),
    ('metric',        0.1000, 'Metric data point',                      true),
    ('profile',       0.5000, 'Profiling sample',                       true),
    ('replay',        2.0000, 'Session replay',                         true),
    ('message',       0.3000, 'Custom message / breadcrumb',            true),
    ('cron_checkin',  0.2000, 'Cron monitor check-in heartbeat',        true)
ON CONFLICT (event_type) DO UPDATE SET
    credit_weight = EXCLUDED.credit_weight,
    description   = EXCLUDED.description,
    is_active     = EXCLUDED.is_active,
    updated_at    = NOW();

-- ============================================================
-- Source: 20_seeders/031_17_enterprise_ingestion_003_feature_flags.sql
-- ============================================================

-- Source: canonical_migrations_draft/17_enterprise_ingestion/003_feature_flags.up.sql
INSERT INTO feature_flags (key, scope, scope_id, enabled, description)
VALUES
  ('ai_alert_analysis', 'platform', NULL, FALSE,
   'AI analysis hook between alert generation and notification delivery (extension point, not implemented).'),
  ('experimental_pipelines', 'platform', NULL, FALSE,
   'Enables experimental per-type worker pipelines.'),
  ('beta_processors', 'platform', NULL, FALSE,
   'Enables beta event processors before GA.')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Source: 20_seeders/032_17_enterprise_ingestion_004_plans_seed.sql
-- ============================================================

-- Source: canonical_migrations_draft/17_enterprise_ingestion/004_plans_seed.up.sql
INSERT INTO plans (key, version, name, tier, description, trial_days, is_active, is_public, sort_order)
VALUES
  ('free',       1, 'Free',       'free',       'Community tier with shared ingestion capacity.', 0,  TRUE, TRUE, 10),
  ('starter',    1, 'Starter',    'starter',    'Entry paid tier for small teams.',               14, TRUE, TRUE, 20),
  ('growth',     1, 'Growth',     'growth',     'Scaling teams with higher event volumes.',       14, TRUE, TRUE, 30),
  ('business',   1, 'Business',   'business',   'Production workloads with priority ingestion.',  14, TRUE, TRUE, 40),
  ('enterprise', 1, 'Enterprise', 'enterprise', 'Dedicated capacity and highest ingestion priority.', 0, TRUE, TRUE, 50)
ON CONFLICT ON CONSTRAINT uq_plans_key_version DO NOTHING;

-- ============================================================
-- Source: 20_seeders/033_18_ai_004_credit_rules.sql
-- ============================================================

-- Source: canonical_migrations_draft/18_ai/004_credit_rules.up.sql
INSERT INTO credit_rules (scope, ai_mode, cost, cached_cost, partial_cost, priority, status)
SELECT 'platform', v.ai_mode, v.cost, 0, 0, 100, 'active'
FROM (VALUES
  ('AI_ERROR_EXPLANATION',      2),
  ('AI_ROOT_CAUSE_ANALYSIS',    3),
  ('AI_STACK_TRACE_ANALYSIS',   2),
  ('AI_TRACE_ANALYSIS',         3),
  ('AI_SPAN_ANALYSIS',          2),
  ('AI_SUGGESTED_FIXES',        3),
  ('AI_SQL_OPTIMIZATION',       3),
  ('AI_LOG_SUMMARY',            2),
  ('AI_DEPLOYMENT_CORRELATION', 3),
  ('AI_INCIDENT_SUMMARY',       5),
  ('AI_WEEKLY_REPORT',          5)
) AS v(ai_mode, cost)
WHERE NOT EXISTS (
  SELECT 1 FROM credit_rules cr
  WHERE cr.scope = 'platform' AND cr.ai_mode = v.ai_mode
);

-- ============================================================
-- Source: 20_seeders/034_18_ai_011_ai_model_routes.sql
-- ============================================================

-- Source: canonical_migrations_draft/18_ai/011_ai_model_routes.up.sql
INSERT INTO ai_model_routes (ai_mode, primary_model, fallback_model, temperature, max_tokens, timeout_ms, priority, status)
SELECT v.ai_mode, v.primary_model, v.fallback_model, v.temperature, v.max_tokens, 30000, 100, 'active'
FROM (VALUES
  ('AI_ERROR_EXPLANATION',      'gpt-4o-mini', 'gpt-4o',      0.30::numeric, 2048),
  ('AI_STACK_TRACE_ANALYSIS',   'gpt-4o-mini', 'gpt-4o',      0.20::numeric, 2048),
  ('AI_SPAN_ANALYSIS',          'gpt-4o-mini', 'gpt-4o',      0.20::numeric, 2048),
  ('AI_LOG_SUMMARY',            'gpt-4o-mini', 'gpt-4o',      0.30::numeric, 2048),
  ('AI_ROOT_CAUSE_ANALYSIS',    'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_TRACE_ANALYSIS',         'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_SUGGESTED_FIXES',        'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_SQL_OPTIMIZATION',       'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_DEPLOYMENT_CORRELATION', 'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_INCIDENT_SUMMARY',       'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_WEEKLY_REPORT',          'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096)
) AS v(ai_mode, primary_model, fallback_model, temperature, max_tokens)
WHERE NOT EXISTS (
  SELECT 1 FROM ai_model_routes r
  WHERE r.ai_mode = v.ai_mode AND r.plan IS NULL AND r.tenant_id IS NULL
);

-- ============================================================
-- Source: 20_seeders/035_19_automation_015_automation_default_templates_seed.sql
-- ============================================================

-- =============================================================================
-- Canonical platform automation templates (seed).
--
-- This is the single authoritative registry of platform-scoped automation
-- templates. Templates are seeded here and nowhere else; the database is the
-- source of truth that the API and UI read from.
--
-- Idempotency: every statement is an upsert keyed on a stable UUID, so this file
-- is safe to re-run. Template rows upsert on template_key; version rows upsert on
-- (template_id, version) and DO UPDATE, so a corrected definition actually rolls
-- out to already-seeded environments.
--
-- Three templates were removed because their purpose depended on an entity that
-- does not exist in this product (no runbook entity, no status-page subsystem, no
-- uptime module, and project_releases is an append-only record with nothing to
-- pause). See docs/automationv2/24-action-inventory-and-decisions.md.
-- =============================================================================
-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'alert-route-by-service-severity',
  'platform', NULL,
  'Route Alerts by Service and Severity',
  'Automatically route alerts to the correct notification channel based on service ownership and severity level.',
  'alert_routing', 'alerting',
  TRUE, TRUE, TRUE, 'starter',
  'module_alerting_features_multi_channel',
  ARRAY['alerting','routing','notifications'],
  10,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"alert_routing","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.service","operator":"exists"},{"leftPath":"$.severity","operator":"in","rightValue":["warning","error","critical","fatal"]}],"actions":[{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{"channelStrategy":"by_service_owner"}}],"safety":{"maxRunsPerHour":500,"dedupeWindowSeconds":60,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.service","operator":"exists"},{"leftPath":"$.severity","operator":"in","rightValue":["warning","error","critical","fatal"]}]'::jsonb,
  '[{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:alert_route_v1_001', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000002',
  'escalate-unresolved-critical-alert',
  'platform', NULL,
  'Escalate Unresolved Critical Alerts',
  'Automatically escalate critical alerts that remain unresolved after a configurable time window via PagerDuty and notifications.',
  'escalation', 'alerting',
  TRUE, TRUE, TRUE, 'growth',
  'module_alerting_features_escalation_policies',
  ARRAY['alerting','escalation','pagerduty'],
  20,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000002',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"escalation","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]},{"leftPath":"$.status","operator":"neq","rightValue":"resolved"}],"actions":[{"actionKey":"page_oncall","actionType":"pagerduty.trigger","riskLevel":"medium","requiresApproval":false,"config":{"waitMinutes":15}},{"actionKey":"notify_escalation","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":50,"dedupeWindowSeconds":900,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]},{"leftPath":"$.status","operator":"neq","rightValue":"resolved"}]'::jsonb,
  '[{"actionKey":"page_oncall","actionType":"pagerduty.trigger","riskLevel":"medium"},{"actionKey":"notify_escalation","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:escalate_critical_v1_002', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000003',
  'create-incident-for-critical-alert',
  'platform', NULL,
  'Create Incident for Critical Alerts',
  'Automatically create an incident when a critical or fatal alert is triggered, notifying the relevant team.',
  'incident_creation', 'incidents',
  TRUE, TRUE, TRUE, 'growth',
  'module_incident_management_enabled',
  ARRAY['incidents','alerting','critical'],
  30,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000003',
  'a0000000-0000-4000-8000-000000000003',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"incident_creation","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]}],"actions":[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":100,"dedupeWindowSeconds":300,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]}]'::jsonb,
  '[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:incident_critical_v1_003', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000004',
  'append-incident-timeline-from-alert',
  'platform', NULL,
  'Append Incident Timeline from Alert',
  'Automatically append alert events to an associated incident timeline for context enrichment.',
  'incident_timeline', 'incidents',
  TRUE, TRUE, FALSE, 'growth',
  'module_incident_management_features_timelines',
  ARRAY['incidents','timeline','alerting'],
  40,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000004',
  'a0000000-0000-4000-8000-000000000004',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"incident_timeline","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.incident_id","operator":"exists"}],"actions":[{"actionKey":"append_timeline","actionType":"incident.timeline.append","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":500,"dedupeWindowSeconds":10,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.incident_id","operator":"exists"}]'::jsonb,
  '[{"actionKey":"append_timeline","actionType":"incident.timeline.append","riskLevel":"low"}]'::jsonb,
  'sha256:timeline_append_v1_004', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000005',
  'generate-postmortem-draft',
  'platform', NULL,
  'Generate Postmortem Draft',
  'Use AI to generate a postmortem draft when a critical incident is resolved after a significant duration.',
  'postmortem', 'incidents',
  TRUE, TRUE, TRUE, 'business',
  'module_incident_management_features_postmortems',
  ARRAY['incidents','postmortem','ai'],
  50,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000005',
  'a0000000-0000-4000-8000-000000000005',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"postmortem","trigger":{"kind":"event","type":"alert.event.resolved","sourceModule":"alerting"},"conditions":[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]},{"leftPath":"$.duration_minutes","operator":"gt","rightValue":30}],"actions":[{"actionKey":"ai_summary","actionType":"ai.summary.generate","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"generate_postmortem","actionType":"incident.postmortem.generate_draft","riskLevel":"medium","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":20,"dedupeWindowSeconds":3600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.resolved","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]},{"leftPath":"$.duration_minutes","operator":"gt","rightValue":30}]'::jsonb,
  '[{"actionKey":"ai_summary","actionType":"ai.summary.generate","riskLevel":"low"},{"actionKey":"generate_postmortem","actionType":"incident.postmortem.generate_draft","riskLevel":"medium"}]'::jsonb,
  'sha256:postmortem_draft_v1_005', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000007',
  'rollback-recommendation-with-approval',
  'platform', NULL,
  'Rollback Recommendation with Approval',
  'Recommend a rollback when release health severely degrades and require human approval before any action.',
  'rollback_recommendation', 'releases',
  TRUE, TRUE, TRUE, 'business',
  'module_version_management_features_release_gates',
  ARRAY['releases','rollback','approval'],
  70,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000007',
  'a0000000-0000-4000-8000-000000000007',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"rollback_recommendation","trigger":{"kind":"event","type":"release.health_degraded","sourceModule":"releases"},"conditions":[{"leftPath":"$.degradation_severe","operator":"eq","rightValue":true},{"leftPath":"$.confidence","operator":"gte","rightValue":0.8}],"actions":[{"actionKey":"recommend_rollback","actionType":"rollback.recommend","riskLevel":"high","requiresApproval":true,"config":{}},{"actionKey":"request_approval","actionType":"approval.request","riskLevel":"high","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":10,"dedupeWindowSeconds":1800,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"release.health_degraded","sourceModule":"releases"}]'::jsonb,
  '[{"leftPath":"$.degradation_severe","operator":"eq","rightValue":true},{"leftPath":"$.confidence","operator":"gte","rightValue":0.8}]'::jsonb,
  '[{"actionKey":"recommend_rollback","actionType":"rollback.recommend","riskLevel":"high"},{"actionKey":"request_approval","actionType":"approval.request","riskLevel":"high"}]'::jsonb,
  'sha256:rollback_approval_v1_007', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000008',
  'deduplicate-noisy-alerts',
  'platform', NULL,
  'Deduplicate Noisy Alerts',
  'Automatically silence alerts with the same fingerprint when they exceed a noise threshold.',
  'noise_reduction', 'alerting',
  TRUE, TRUE, FALSE, 'growth',
  'module_alerting_features_deduplication',
  ARRAY['alerting','deduplication','noise'],
  80,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000008',
  'a0000000-0000-4000-8000-000000000008',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"noise_reduction","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.fingerprint_count","operator":"gt","rightValue":5}],"actions":[{"actionKey":"silence_alert","actionType":"alert.silence.create","riskLevel":"medium","requiresApproval":false,"config":{"durationMinutes":60}},{"actionKey":"notify_silence","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":200,"dedupeWindowSeconds":300,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.fingerprint_count","operator":"gt","rightValue":5}]'::jsonb,
  '[{"actionKey":"silence_alert","actionType":"alert.silence.create","riskLevel":"medium"},{"actionKey":"notify_silence","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:dedupe_noisy_v1_008', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000009',
  'silence-known-maintenance-window',
  'platform', NULL,
  'Silence Alerts During Maintenance Window',
  'Automatically create alert silences during scheduled maintenance windows.',
  'noise_reduction', 'alerting',
  TRUE, TRUE, FALSE, 'growth',
  'module_alerting_features_silencing',
  ARRAY['alerting','silencing','maintenance'],
  90,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000009',
  'a0000000-0000-4000-8000-000000000009',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"noise_reduction","trigger":{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler"},"conditions":[{"leftPath":"$.maintenance_window_active","operator":"eq","rightValue":true}],"actions":[{"actionKey":"silence_maintenance","actionType":"alert.silence.create","riskLevel":"medium","requiresApproval":false,"config":{"matchLabels":{"maintenance":"true"}}}],"safety":{"maxRunsPerHour":5,"dedupeWindowSeconds":3600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler"}]'::jsonb,
  '[{"leftPath":"$.maintenance_window_active","operator":"eq","rightValue":true}]'::jsonb,
  '[{"actionKey":"silence_maintenance","actionType":"alert.silence.create","riskLevel":"medium"}]'::jsonb,
  'sha256:silence_maint_v1_009', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000011',
  'retry-connector-dead-letter',
  'platform', NULL,
  'Retry Connector Dead Letter',
  'Automatically retry dead-lettered connector deliveries within a retry budget and notify on final failure.',
  'dead_letter', 'connectors',
  TRUE, TRUE, FALSE, 'starter',
  'module_connectors_enabled',
  ARRAY['connectors','dead_letter','retry'],
  110,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000011',
  'a0000000-0000-4000-8000-000000000011',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"dead_letter","trigger":{"kind":"event","type":"connector.delivery.dead_lettered","sourceModule":"connectors"},"conditions":[{"leftPath":"$.attempts","operator":"lt","rightValue":5}],"actions":[{"actionKey":"retry_delivery","actionType":"connector.delivery.retry","riskLevel":"low","requiresApproval":false,"config":{"maxRetries":3}},{"actionKey":"notify_failure","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{"onFinalFailure":true}}],"safety":{"maxRunsPerHour":200,"dedupeWindowSeconds":120,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"connector.delivery.dead_lettered","sourceModule":"connectors"}]'::jsonb,
  '[{"leftPath":"$.attempts","operator":"lt","rightValue":5}]'::jsonb,
  '[{"actionKey":"retry_delivery","actionType":"connector.delivery.retry","riskLevel":"low"},{"actionKey":"notify_failure","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:connector_dl_retry_v1_011', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000012',
  'retry-ingestion-dead-letter',
  'platform', NULL,
  'Retry Ingestion Dead Letter',
  'Notify and queue ingestion dead-letter events for retry when retryable and within retry budget.',
  'dead_letter', 'ingestion',
  TRUE, TRUE, FALSE, 'starter',
  'module_automation_enabled',
  ARRAY['ingestion','dead_letter','retry'],
  120,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000012',
  'a0000000-0000-4000-8000-000000000012',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"dead_letter","trigger":{"kind":"event","type":"ingestion.dead_letter.created","sourceModule":"ingestion"},"conditions":[{"leftPath":"$.retryable","operator":"eq","rightValue":true},{"leftPath":"$.attempts","operator":"lt","rightValue":3}],"actions":[{"actionKey":"notify_dead_letter","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"noop_retry","actionType":"noop","riskLevel":"low","requiresApproval":false,"config":{"reason":"ingestion_retry_action_pending"}}],"safety":{"maxRunsPerHour":500,"dedupeWindowSeconds":60,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"ingestion.dead_letter.created","sourceModule":"ingestion"}]'::jsonb,
  '[{"leftPath":"$.retryable","operator":"eq","rightValue":true},{"leftPath":"$.attempts","operator":"lt","rightValue":3}]'::jsonb,
  '[{"actionKey":"notify_dead_letter","actionType":"notification.send","riskLevel":"low"},{"actionKey":"noop_retry","actionType":"noop","riskLevel":"low"}]'::jsonb,
  'sha256:ingestion_dl_retry_v1_012', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000013',
  'notify-quota-threshold',
  'platform', NULL,
  'Notify on Quota Threshold Breach',
  'Send notifications when billing usage reaches 80%, 90%, or 100% of quota limits.',
  'quota', 'billing',
  TRUE, TRUE, FALSE, 'starter',
  'module_billing_ops_cost_alerts',
  ARRAY['billing','quota','notifications'],
  130,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000013',
  'a0000000-0000-4000-8000-000000000013',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"quota","trigger":{"kind":"event","type":"billing.usage.threshold_breached","sourceModule":"billing"},"conditions":[{"leftPath":"$.usage_percent","operator":"in","rightValue":[80,90,100]}],"actions":[{"actionKey":"notify_quota","actionType":"quota.notify","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":20,"dedupeWindowSeconds":3600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"billing.usage.threshold_breached","sourceModule":"billing"}]'::jsonb,
  '[{"leftPath":"$.usage_percent","operator":"in","rightValue":[80,90,100]}]'::jsonb,
  '[{"actionKey":"notify_quota","actionType":"quota.notify","riskLevel":"low"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:quota_threshold_v1_013', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000014',
  'ai-credit-usage-spike',
  'platform', NULL,
  'AI Credit Usage Spike Alert',
  'Notify when AI credit consumption spikes beyond normal usage patterns.',
  'quota', 'ai',
  TRUE, TRUE, FALSE, 'growth',
  'module_ai_insights_enabled',
  ARRAY['ai','billing','credits'],
  140,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000014',
  'a0000000-0000-4000-8000-000000000014',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"quota","trigger":{"kind":"event","type":"billing.usage.threshold_breached","sourceModule":"billing"},"conditions":[{"leftPath":"$.meter","operator":"eq","rightValue":"ai_credits"}],"actions":[{"actionKey":"notify_ai_spike","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"quota_alert","actionType":"quota.notify","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":10,"dedupeWindowSeconds":3600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"billing.usage.threshold_breached","sourceModule":"billing"}]'::jsonb,
  '[{"leftPath":"$.meter","operator":"eq","rightValue":"ai_credits"}]'::jsonb,
  '[{"actionKey":"notify_ai_spike","actionType":"notification.send","riskLevel":"low"},{"actionKey":"quota_alert","actionType":"quota.notify","riskLevel":"low"}]'::jsonb,
  'sha256:ai_credit_spike_v1_014', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000015',
  'security-api-key-anomaly',
  'platform', NULL,
  'Security API Key Anomaly Detection',
  'Notify security team when suspicious API key usage is detected with high confidence.',
  'security', 'security',
  TRUE, TRUE, TRUE, 'business',
  'module_enterprise_features_audit_logs',
  ARRAY['security','api_key','anomaly'],
  150,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000015',
  'a0000000-0000-4000-8000-000000000015',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"security","trigger":{"kind":"event","type":"security.api_key.suspicious_usage","sourceModule":"security"},"conditions":[{"leftPath":"$.confidence","operator":"gt","rightValue":0.7}],"actions":[{"actionKey":"security_notify","actionType":"security.notify","riskLevel":"medium","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":50,"dedupeWindowSeconds":600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"security.api_key.suspicious_usage","sourceModule":"security"}]'::jsonb,
  '[{"leftPath":"$.confidence","operator":"gt","rightValue":0.7}]'::jsonb,
  '[{"actionKey":"security_notify","actionType":"security.notify","riskLevel":"medium"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:security_api_key_v1_015', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000016',
  'daily-service-health-report',
  'platform', NULL,
  'Daily Service Health Report',
  'Generate and send a daily service health summary report via configured notification channels.',
  'report', 'reports',
  TRUE, TRUE, FALSE, 'growth',
  'module_analytics_features_custom_reports',
  ARRAY['reports','daily','health'],
  160,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000016',
  'a0000000-0000-4000-8000-000000000016',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"report","trigger":{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler","config":{"cron":"0 8 * * *","timezone":"UTC"}},"conditions":[],"actions":[{"actionKey":"export_report","actionType":"report.export","riskLevel":"low","requiresApproval":false,"config":{"reportType":"daily_service_health"}},{"actionKey":"notify_report","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":2,"dedupeWindowSeconds":43200,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler"}]'::jsonb,
  '[]'::jsonb,
  '[{"actionKey":"export_report","actionType":"report.export","riskLevel":"low"},{"actionKey":"notify_report","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:daily_health_v1_016', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000017',
  'weekly-release-quality-report',
  'platform', NULL,
  'Weekly Release Quality Report',
  'Generate an AI-summarized weekly report on release quality, failure rates, and rollback frequency.',
  'report', 'reports',
  TRUE, TRUE, FALSE, 'business',
  'module_ai_insights_features_weekly_report',
  ARRAY['reports','weekly','releases','ai'],
  170,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000017',
  'a0000000-0000-4000-8000-000000000017',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"report","trigger":{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler","config":{"cron":"0 9 * * 1","timezone":"UTC"}},"conditions":[{"leftPath":"$.release_data_exists","operator":"eq","rightValue":true}],"actions":[{"actionKey":"ai_summarize","actionType":"ai.summary.generate","riskLevel":"low","requiresApproval":false,"config":{"context":"weekly_releases"}},{"actionKey":"export_report","actionType":"report.export","riskLevel":"low","requiresApproval":false,"config":{"reportType":"weekly_release_quality"}},{"actionKey":"notify_report","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":1,"dedupeWindowSeconds":86400,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler"}]'::jsonb,
  '[{"leftPath":"$.release_data_exists","operator":"eq","rightValue":true}]'::jsonb,
  '[{"actionKey":"ai_summarize","actionType":"ai.summary.generate","riskLevel":"low"},{"actionKey":"export_report","actionType":"report.export","riskLevel":"low"},{"actionKey":"notify_report","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:weekly_release_v1_017', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000018',
  'slo-burn-rate-incident',
  'platform', NULL,
  'SLO Burn Rate Incident',
  'Create an incident and notify the team when SLO burn rate breaches the configured threshold.',
  'incident_creation', 'monitoring',
  TRUE, TRUE, FALSE, 'growth',
  'module_incident_management_enabled',
  ARRAY['slo','burn_rate','incidents'],
  180,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000018',
  'a0000000-0000-4000-8000-000000000018',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"incident_creation","trigger":{"kind":"event","type":"slo.burn_rate_breached","sourceModule":"monitoring"},"conditions":[{"leftPath":"$.burn_rate","operator":"gt","rightValue":1.5}],"actions":[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium","requiresApproval":false,"config":{"severity":"high"}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":20,"dedupeWindowSeconds":1800,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"slo.burn_rate_breached","sourceModule":"monitoring"}]'::jsonb,
  '[{"leftPath":"$.burn_rate","operator":"gt","rightValue":1.5}]'::jsonb,
  '[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:slo_burn_rate_v1_018', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000019',
  'cron-missed-job-escalation',
  'platform', NULL,
  'Cron Missed Job Escalation',
  'Create an incident and page on-call when a high-criticality cron job misses its expected schedule.',
  'escalation', 'monitoring',
  TRUE, TRUE, FALSE, 'growth',
  'module_cron_monitoring_enabled',
  ARRAY['cron','monitoring','escalation'],
  190,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

-- Source: canonical_migrations_draft/19_automation/015_automation_default_templates_seed.sql
INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000019',
  'a0000000-0000-4000-8000-000000000019',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"escalation","trigger":{"kind":"event","type":"cron.missed","sourceModule":"cron_monitoring"},"conditions":[{"leftPath":"$.job_criticality","operator":"eq","rightValue":"high"}],"actions":[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"page_oncall","actionType":"pagerduty.trigger","riskLevel":"medium","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":30,"dedupeWindowSeconds":900,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"cron.missed","sourceModule":"cron_monitoring"}]'::jsonb,
  '[{"leftPath":"$.job_criticality","operator":"eq","rightValue":"high"}]'::jsonb,
  '[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"},{"actionKey":"page_oncall","actionType":"pagerduty.trigger","riskLevel":"medium"}]'::jsonb,
  'sha256:cron_missed_v1_019', '{}'::jsonb
) ON CONFLICT (template_id, version) DO UPDATE
  SET is_current = EXCLUDED.is_current,
      definition = EXCLUDED.definition,
      trigger_summary = EXCLUDED.trigger_summary,
      condition_summary = EXCLUDED.condition_summary,
      action_summary = EXCLUDED.action_summary,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata;

-- ============================================================
-- Source: 20_seeders/036_migrations_002_create_all_ordered.sql
-- ============================================================

-- Source: migrations/002_create_all_ordered.sql
INSERT INTO backpressure_gauge (id, pending_depth, updated_at, last_worker_id)
VALUES (1, 0, NOW(), 'init')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Source: 20_seeders/037_migrations_003_project_module_refactor.sql
-- ============================================================

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

-- ============================================================
-- Source: 04_user/999_triggers.sql
-- ============================================================

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS auto_revoke_backup_codes ON user_mfa_devices;
CREATE TRIGGER auto_revoke_backup_codes
  AFTER UPDATE ON user_mfa_devices
  FOR EACH ROW
  WHEN (NEW.is_verified = TRUE AND OLD.is_verified = FALSE)
  EXECUTE FUNCTION revoke_and_regenerate_backup_codes();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_mfa_devices_updated_at ON user_mfa_devices;
CREATE TRIGGER trg_mfa_devices_updated_at
  BEFORE UPDATE ON user_mfa_devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Source: 05_organization/999_triggers.sql
-- ============================================================

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_alert_thresholds_updated_at ON organization_alert_thresholds;
CREATE TRIGGER trg_org_alert_thresholds_updated_at
  BEFORE UPDATE ON organization_alert_thresholds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_members_updated_at ON organization_members;
CREATE TRIGGER trg_org_members_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_settings_updated_at ON organization_settings;
CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_organization_verified_domains_updated_at ON organization_verified_domains;
CREATE TRIGGER trg_organization_verified_domains_updated_at
BEFORE UPDATE
ON organization_verified_domains
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_updated_at ON organizations;
CREATE TRIGGER trg_org_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_quota_requests_updated_at ON quota_requests;
CREATE TRIGGER trg_quota_requests_updated_at
  BEFORE UPDATE ON quota_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Source: 06_project/999_triggers.sql
-- ============================================================

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_api_keys_updated_at ON project_api_keys;
CREATE TRIGGER trg_project_api_keys_updated_at
  BEFORE UPDATE ON project_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_api_keys_version ON project_api_keys;
CREATE TRIGGER trg_project_api_keys_version
  BEFORE UPDATE ON project_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION bump_project_version();

-- Source: canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
DROP TRIGGER IF EXISTS trg_project_environment_sdk_revisions_immutable ON project_environment_sdk_config_revisions;
CREATE TRIGGER trg_project_environment_sdk_revisions_immutable
BEFORE UPDATE ON project_environment_sdk_config_revisions
FOR EACH ROW EXECUTE FUNCTION reject_sdk_config_revision_update();

-- Source: canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
DROP TRIGGER IF EXISTS trg_project_environment_sdk_configs_updated_at ON project_environment_sdk_configs;
CREATE TRIGGER trg_project_environment_sdk_configs_updated_at
BEFORE UPDATE ON project_environment_sdk_configs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_environments_updated_at ON project_environments;
CREATE TRIGGER trg_project_environments_updated_at
  BEFORE UPDATE ON project_environments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_member_invitations_updated_at ON project_member_invitations;
CREATE TRIGGER trg_project_member_invitations_updated_at
  BEFORE UPDATE ON project_member_invitations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_member_notif_prefs_updated_at ON project_member_notification_preferences;
CREATE TRIGGER trg_project_member_notif_prefs_updated_at
  BEFORE UPDATE ON project_member_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_members_updated_at ON project_members;
CREATE TRIGGER trg_project_members_updated_at
  BEFORE UPDATE ON project_members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_members_version ON project_members;
CREATE TRIGGER trg_project_members_version
  BEFORE UPDATE ON project_members
  FOR EACH ROW
  EXECUTE FUNCTION bump_project_version();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_notif_prefs_updated_at ON project_notification_preferences;
CREATE TRIGGER trg_project_notif_prefs_updated_at
  BEFORE UPDATE ON project_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_roles_updated_at ON project_roles;
CREATE TRIGGER trg_project_roles_updated_at
  BEFORE UPDATE ON project_roles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_project_usage_updated_at ON project_usage;
CREATE TRIGGER trg_project_usage_updated_at
  BEFORE UPDATE ON project_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/04_projects/021_remove_project_defaults_provisioning_trigger.up.sql
-- Project defaults are provisioned explicitly in application transactions.
DROP TRIGGER IF EXISTS trg_projects_provision_defaults ON projects;


-- Source: canonical_migrations_draft/04_projects/022_add_project_public_id.sql
DROP TRIGGER IF EXISTS trg_projects_public_id_immutable ON projects;
CREATE TRIGGER trg_projects_public_id_immutable
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_project_public_id_update();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_projects_version ON projects;
CREATE TRIGGER trg_projects_version
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION bump_project_version();

-- ============================================================
-- Source: 07_billing/999_triggers.sql
-- ============================================================

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_billing_features_updated_at ON billing_features;
CREATE TRIGGER trg_billing_features_updated_at
BEFORE UPDATE
ON billing_features
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_coupons_updated_at ON coupons;
CREATE TRIGGER trg_coupons_updated_at
BEFORE UPDATE
ON coupons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_ai/002_credit_balances.up.sql
DROP TRIGGER IF EXISTS trg_credit_balances_updated_at ON credit_balances;
CREATE TRIGGER trg_credit_balances_updated_at
  BEFORE UPDATE ON credit_balances
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_ai/003_credit_ledger.up.sql
DROP TRIGGER IF EXISTS trg_credit_ledger_append_only ON credit_ledger;
CREATE TRIGGER trg_credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW
  EXECUTE FUNCTION credit_ledger_append_only();

-- Source: canonical_migrations_draft/18_ai/004_credit_rules.up.sql
DROP TRIGGER IF EXISTS trg_credit_rules_updated_at ON credit_rules;
CREATE TRIGGER trg_credit_rules_updated_at
  BEFORE UPDATE ON credit_rules
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE
ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_organization_feature_overrides_updated_at ON organization_feature_overrides;
CREATE TRIGGER trg_organization_feature_overrides_updated_at
BEFORE UPDATE
ON organization_feature_overrides
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_organization_subscriptions_updated_at ON organization_subscriptions;
CREATE TRIGGER trg_organization_subscriptions_updated_at
BEFORE UPDATE
ON organization_subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_usage_current_period_updated_at ON organization_usage_current_period;
CREATE TRIGGER trg_org_usage_current_period_updated_at
BEFORE UPDATE
ON organization_usage_current_period
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE
ON payments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_plan_feature_entitlements_updated_at ON plan_feature_entitlements;
CREATE TRIGGER trg_plan_feature_entitlements_updated_at
BEFORE UPDATE
ON plan_feature_entitlements
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_plan_prices_updated_at ON plan_prices;
CREATE TRIGGER trg_plan_prices_updated_at
BEFORE UPDATE
ON plan_prices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_subscription_addons_updated_at ON subscription_addons;
CREATE TRIGGER trg_subscription_addons_updated_at
BEFORE UPDATE
ON subscription_addons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_usage_daily_counters_updated_at ON usage_daily_counters;
CREATE TRIGGER trg_usage_daily_counters_updated_at
BEFORE UPDATE
ON usage_daily_counters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Source: 08_connector/999_triggers.sql
-- ============================================================

-- Source: canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql
DROP TRIGGER IF EXISTS trg_connector_circuit_state_updated_at ON connector_circuit_state;
CREATE TRIGGER trg_connector_circuit_state_updated_at
  BEFORE UPDATE ON connector_circuit_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql
DROP TRIGGER IF EXISTS trg_connector_rate_buckets_updated_at ON connector_rate_buckets;
CREATE TRIGGER trg_connector_rate_buckets_updated_at
  BEFORE UPDATE ON connector_rate_buckets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_connector_subs_updated_at ON project_connector_subscriptions;
CREATE TRIGGER trg_project_connector_subs_updated_at
  BEFORE UPDATE ON project_connector_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Source: 10_notification/999_triggers.sql
-- ============================================================

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_notification_routes_updated_at ON notification_routes;
CREATE TRIGGER trg_notification_routes_updated_at
  BEFORE UPDATE ON notification_routes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Source: 09_alerting/999_triggers.sql
-- ============================================================

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_acknowledgments_updated_at ON alert_acknowledgments;
CREATE TRIGGER trg_alert_acknowledgments_updated_at
  BEFORE UPDATE ON alert_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_dead_letter_events_updated_at ON alert_dead_letter_events;
CREATE TRIGGER trg_alert_dead_letter_events_updated_at
  BEFORE UPDATE ON alert_dead_letter_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_delivery_attempts_updated_at ON alert_delivery_attempts;
CREATE TRIGGER trg_alert_delivery_attempts_updated_at
  BEFORE UPDATE ON alert_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_escalation_policies_updated_at ON alert_escalation_policies;
CREATE TRIGGER trg_alert_escalation_policies_updated_at
  BEFORE UPDATE ON alert_escalation_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_escalation_steps_updated_at ON alert_escalation_steps;
CREATE TRIGGER trg_alert_escalation_steps_updated_at
  BEFORE UPDATE ON alert_escalation_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_event_batches_updated_at ON alert_event_batches;
CREATE TRIGGER trg_alert_event_batches_updated_at
  BEFORE UPDATE ON alert_event_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_events_updated_at ON alert_events;
CREATE TRIGGER trg_alert_events_updated_at
  BEFORE UPDATE ON alert_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_routing_rules_updated_at ON alert_routing_rules;
CREATE TRIGGER trg_alert_routing_rules_updated_at
  BEFORE UPDATE ON alert_routing_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_rule_actions_updated_at ON alert_rule_actions;
CREATE TRIGGER trg_alert_rule_actions_updated_at
  BEFORE UPDATE ON alert_rule_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/08_alerting/020_create_alert_rule_bindings.up.sql
DROP TRIGGER IF EXISTS trg_alert_rule_bindings_updated_at ON alert_rule_bindings;
CREATE TRIGGER trg_alert_rule_bindings_updated_at
  BEFORE UPDATE ON alert_rule_bindings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_rule_conditions_updated_at ON alert_rule_conditions;
CREATE TRIGGER trg_alert_rule_conditions_updated_at
  BEFORE UPDATE ON alert_rule_conditions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_rules_updated_at ON alert_rules;
CREATE TRIGGER trg_alert_rules_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_silences_updated_at ON alert_silences;
CREATE TRIGGER trg_alert_silences_updated_at
  BEFORE UPDATE ON alert_silences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_templates_updated_at ON alert_templates;
CREATE TRIGGER trg_alert_templates_updated_at
  BEFORE UPDATE ON alert_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_throttle_windows_updated_at ON alert_throttle_windows;
CREATE TRIGGER trg_alert_throttle_windows_updated_at
  BEFORE UPDATE ON alert_throttle_windows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_audit_roots_updated_at ON alerting_audit_roots;
CREATE TRIGGER trg_alerting_audit_roots_updated_at
  BEFORE UPDATE ON alerting_audit_roots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql
DROP TRIGGER IF EXISTS trg_alerting_dashboard_widgets_updated_at ON alerting_dashboard_widgets;
CREATE TRIGGER trg_alerting_dashboard_widgets_updated_at
  BEFORE UPDATE ON alerting_dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql
DROP TRIGGER IF EXISTS trg_alerting_entitlements_updated_at ON alerting_entitlements;
CREATE TRIGGER trg_alerting_entitlements_updated_at
  BEFORE UPDATE ON alerting_entitlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_escalation_policies_v2_updated_at ON alerting_escalation_policies_v2;
CREATE TRIGGER trg_alerting_escalation_policies_v2_updated_at
  BEFORE UPDATE ON alerting_escalation_policies_v2
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_escalation_steps_v2_updated_at ON alerting_escalation_steps_v2;
CREATE TRIGGER trg_alerting_escalation_steps_v2_updated_at
  BEFORE UPDATE ON alerting_escalation_steps_v2
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/08_alerting/022_alerting_consolidation_support.up.sql
DROP TRIGGER IF EXISTS trg_alerting_legacy_mappings_updated_at ON alerting_legacy_mappings;
CREATE TRIGGER trg_alerting_legacy_mappings_updated_at
  BEFORE UPDATE ON alerting_legacy_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql
DROP TRIGGER IF EXISTS trg_alerting_maintenance_config_updated_at ON alerting_maintenance_config;
CREATE TRIGGER trg_alerting_maintenance_config_updated_at
  BEFORE UPDATE ON alerting_maintenance_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql
DROP TRIGGER IF EXISTS trg_alerting_notification_defaults_updated_at ON alerting_notification_defaults;
CREATE TRIGGER trg_alerting_notification_defaults_updated_at
  BEFORE UPDATE ON alerting_notification_defaults
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
DROP TRIGGER IF EXISTS trg_alerting_policy_catalog_updated_at ON alerting_policy_catalog;
CREATE TRIGGER trg_alerting_policy_catalog_updated_at
  BEFORE UPDATE ON alerting_policy_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
DROP TRIGGER IF EXISTS trg_alerting_policy_categories_updated_at ON alerting_policy_categories;
CREATE TRIGGER trg_alerting_policy_categories_updated_at
  BEFORE UPDATE ON alerting_policy_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql
DROP TRIGGER IF EXISTS trg_alerting_project_policy_overrides_updated_at ON alerting_project_policy_overrides;
CREATE TRIGGER trg_alerting_project_policy_overrides_updated_at
  BEFORE UPDATE ON alerting_project_policy_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql
DROP TRIGGER IF EXISTS trg_alerting_project_policy_subscriptions_updated_at ON alerting_project_policy_subscriptions;
CREATE TRIGGER trg_alerting_project_policy_subscriptions_updated_at
  BEFORE UPDATE ON alerting_project_policy_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/004_create_alerting_provider_catalog.up.sql
DROP TRIGGER IF EXISTS trg_alerting_provider_catalog_updated_at ON alerting_provider_catalog;
CREATE TRIGGER trg_alerting_provider_catalog_updated_at
  BEFORE UPDATE ON alerting_provider_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_routing_defaults_updated_at ON alerting_routing_defaults;
CREATE TRIGGER trg_alerting_routing_defaults_updated_at
  BEFORE UPDATE ON alerting_routing_defaults
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql
DROP TRIGGER IF EXISTS trg_alerting_saved_views_updated_at ON alerting_saved_views;
CREATE TRIGGER trg_alerting_saved_views_updated_at
  BEFORE UPDATE ON alerting_saved_views
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_search_index_metadata_updated_at ON alerting_search_index_metadata;
CREATE TRIGGER trg_alerting_search_index_metadata_updated_at
  BEFORE UPDATE ON alerting_search_index_metadata
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql
DROP TRIGGER IF EXISTS trg_alerting_settings_updated_at ON alerting_settings;
CREATE TRIGGER trg_alerting_settings_updated_at
  BEFORE UPDATE ON alerting_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql
DROP TRIGGER IF EXISTS trg_alerting_usage_counters_updated_at ON alerting_usage_counters;
CREATE TRIGGER trg_alerting_usage_counters_updated_at
  BEFORE UPDATE ON alerting_usage_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
DROP TRIGGER IF EXISTS trg_alerting_workspaces_updated_at ON alerting_workspaces;
CREATE TRIGGER trg_alerting_workspaces_updated_at
  BEFORE UPDATE ON alerting_workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Source: 11_observability/999_triggers.sql
-- ============================================================

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_ingestion_jobs_updated_at ON ingestion_jobs;
CREATE TRIGGER trg_ingestion_jobs_updated_at
  BEFORE UPDATE ON ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Source: 13_ai/999_triggers.sql
-- ============================================================

-- Source: canonical_migrations_draft/18_ai/011_ai_model_routes.up.sql
DROP TRIGGER IF EXISTS trg_ai_model_routes_updated_at ON ai_model_routes;
CREATE TRIGGER trg_ai_model_routes_updated_at
  BEFORE UPDATE ON ai_model_routes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Source: 14_automation/999_triggers.sql
-- ============================================================

-- Source: canonical_migrations_draft/19_automation/006_automation_actions.sql
DROP TRIGGER IF EXISTS trg_automation_actions_updated_at ON automation_actions;
CREATE TRIGGER trg_automation_actions_updated_at
  BEFORE UPDATE ON automation_actions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/009_automation_approvals.sql
DROP TRIGGER IF EXISTS trg_automation_approvals_updated_at ON automation_approvals;
CREATE TRIGGER trg_automation_approvals_updated_at
  BEFORE UPDATE ON automation_approvals
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/005_automation_conditions.sql
DROP TRIGGER IF EXISTS trg_automation_conditions_updated_at ON automation_conditions;
CREATE TRIGGER trg_automation_conditions_updated_at
  BEFORE UPDATE ON automation_conditions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/010_automation_templates.sql
DROP TRIGGER IF EXISTS trg_automation_templates_updated_at ON automation_templates;
CREATE TRIGGER trg_automation_templates_updated_at
  BEFORE UPDATE ON automation_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/004_automation_triggers.sql
DROP TRIGGER IF EXISTS trg_automation_triggers_updated_at ON automation_triggers;
CREATE TRIGGER trg_automation_triggers_updated_at
  BEFORE UPDATE ON automation_triggers
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/003_automation_workflow_versions.sql
DROP TRIGGER IF EXISTS trg_immutable_published_version ON automation_workflow_versions;
CREATE TRIGGER trg_immutable_published_version
  BEFORE UPDATE ON automation_workflow_versions
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_immutable_published_version();

-- Source: canonical_migrations_draft/19_automation/002_automation_workflows.sql
DROP TRIGGER IF EXISTS trg_automation_workflows_updated_at ON automation_workflows;
CREATE TRIGGER trg_automation_workflows_updated_at
  BEFORE UPDATE ON automation_workflows
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: 002_create_automation_runtime.sql
DROP TRIGGER IF EXISTS trg_automation_runs_updated_at ON automation_runs;
CREATE TRIGGER trg_automation_runs_updated_at
  BEFORE UPDATE ON automation_runs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_automation_run_steps_updated_at ON automation_run_steps;
CREATE TRIGGER trg_automation_run_steps_updated_at
  BEFORE UPDATE ON automation_run_steps
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Source: 15_analytics/999_triggers.sql
-- ============================================================

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_analytics_alerts_updated_at ON analytics_alerts;
CREATE TRIGGER trg_analytics_alerts_updated_at
  BEFORE UPDATE ON analytics_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_daily_rollup_updated_at ON analytics_daily_rollup;
CREATE TRIGGER trg_daily_rollup_updated_at
  BEFORE UPDATE ON analytics_daily_rollup
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_dashboards_updated_at ON analytics_dashboards;
CREATE TRIGGER trg_dashboards_updated_at
  BEFORE UPDATE ON analytics_dashboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_error_groups_updated_at ON analytics_error_groups;
CREATE TRIGGER trg_error_groups_updated_at
  BEFORE UPDATE ON analytics_error_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_hourly_rollup_updated_at ON analytics_hourly_rollup;
CREATE TRIGGER trg_hourly_rollup_updated_at
  BEFORE UPDATE ON analytics_hourly_rollup
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_perf_summary_updated_at ON analytics_performance_summary;
CREATE TRIGGER trg_perf_summary_updated_at
  BEFORE UPDATE ON analytics_performance_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_saved_queries_updated_at ON analytics_saved_queries;
CREATE TRIGGER trg_saved_queries_updated_at
  BEFORE UPDATE ON analytics_saved_queries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

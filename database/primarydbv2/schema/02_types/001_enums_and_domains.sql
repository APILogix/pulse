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

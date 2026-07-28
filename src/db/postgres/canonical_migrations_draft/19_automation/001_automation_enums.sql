-- =============================================================================
-- Module      : Automation
-- Migration   : 001_automation_enums.sql
-- Description : Enums used throughout the automation module
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

-- automation_workflow_status
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

-- automation_workflow_scope
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

-- automation_template_scope
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_template_scope') THEN
    CREATE TYPE automation_template_scope AS ENUM (
      'platform',
      'organization'
    );
  END IF;
END $$;

-- automation_trigger_kind
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

-- automation_condition_operator
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

-- automation_action_risk
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

-- automation_run_status
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

-- automation_step_status
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

-- automation_approval_status
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

-- automation_audit_action (using underscores for consistency with codebase)
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

COMMIT;

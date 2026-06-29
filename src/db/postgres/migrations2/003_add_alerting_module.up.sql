-- ============================================================================
-- 003_add_alerting_module.up.sql
-- ----------------------------------------------------------------------------
-- Enterprise alerting module: rules, conditions, actions, events, history,
-- silences, acknowledgments, escalation policies/steps, batch tracking,
-- delivery attempts, templates, routing rules, rule executions, and metrics.
--
-- Idempotent + safe-to-run-on-fresh-DB. Depends on:
--   * organizations(id), users(id)            (001 / orgtables.sql)
--   * connector_configs(id), notification_routes(id), connector_type enum (002)
--
-- Conventions match 002_add_notification_connectors.up.sql:
--   * Enums guarded with DO/IF NOT EXISTS so re-runs are no-ops.
--   * Partial UNIQUE INDEXes (… WHERE deleted_at IS NULL) instead of UNIQUE
--     constraints on (org, name, deleted_at) — the latter still permits
--     duplicate LIVE names because NULL <> NULL.
--   * RLS is INTENTIONALLY DISABLED (commented at the bottom). This codebase
--     isolates tenants in the service layer and never sets app.current_org_id;
--     enabling the spec's policies would filter every query to zero rows.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) Extensions + shared updated_at trigger function
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Reuse the connector module's trigger function name so a single definition
-- governs updated_at across modules; CREATE OR REPLACE makes this standalone.
CREATE OR REPLACE FUNCTION connector_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1) ENUM types (idempotent)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 2) alert_rules
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    description TEXT,
    severity alert_severity NOT NULL DEFAULT 'warning',

    enabled BOOLEAN NOT NULL DEFAULT true,
    evaluation_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (evaluation_interval_seconds > 0),
    cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
    auto_resolve_after_minutes INTEGER,
    deduplication_window_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (deduplication_window_seconds >= 0),
    deduplication_key_template VARCHAR(500) DEFAULT '{{rule_id}}:{{source}}:{{fingerprint}}',

    grouping_enabled BOOLEAN NOT NULL DEFAULT false,
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
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rule_name_per_org
  ON alert_rules(organization_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rules_org ON alert_rules(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(organization_id, enabled) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rules_severity ON alert_rules(severity) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_rules_updated_at ON alert_rules;
CREATE TRIGGER trg_alert_rules_updated_at BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 3) alert_rule_conditions
-- ----------------------------------------------------------------------------
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

    is_required BOOLEAN NOT NULL DEFAULT true,
    order_index INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_conditions_rule ON alert_rule_conditions(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_rule_conditions_group ON alert_rule_conditions(condition_group_id) WHERE condition_group_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alert_rule_conditions_updated_at ON alert_rule_conditions;
CREATE TRIGGER trg_alert_rule_conditions_updated_at BEFORE UPDATE ON alert_rule_conditions
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) alert_rule_actions
-- ----------------------------------------------------------------------------
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

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_actions_rule ON alert_rule_actions(rule_id, order_index);
CREATE INDEX IF NOT EXISTS idx_alert_rule_actions_connector ON alert_rule_actions(connector_id) WHERE connector_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alert_rule_actions_updated_at ON alert_rule_actions;
CREATE TRIGGER trg_alert_rule_actions_updated_at BEFORE UPDATE ON alert_rule_actions
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();


-- ----------------------------------------------------------------------------
-- 5) alert_events  (high-volume)
-- ----------------------------------------------------------------------------
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
    is_group_parent BOOLEAN NOT NULL DEFAULT false,
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

    CONSTRAINT valid_event_lifecycle CHECK (
      (status = 'resolved' AND resolved_at IS NOT NULL) OR (status <> 'resolved')
    )
);

-- Partial index restricted to actionable states keeps the hot index small.
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
  ON alert_events(organization_id, group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_events_next_escalation
  ON alert_events(next_escalation_at) WHERE status = 'firing' AND next_escalation_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_events_auto_resolve
  ON alert_events(auto_resolve_at) WHERE status = 'firing' AND auto_resolve_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alert_events_updated_at ON alert_events;
CREATE TRIGGER trg_alert_events_updated_at BEFORE UPDATE ON alert_events
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 6) alert_event_history (audit trail)
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_alert_event_history_event ON alert_event_history(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_org ON alert_event_history(organization_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 7) alert_silences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_silences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,

    created_by UUID NOT NULL REFERENCES users(id),
    comment TEXT,

    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,

    matchers JSONB NOT NULL DEFAULT '{}'::jsonb,

    is_active BOOLEAN NOT NULL DEFAULT true,
    expired_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_silence_duration CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_alert_silences_active
  ON alert_silences(organization_id, is_active, ends_at) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_alert_silences_rule
  ON alert_silences(rule_id, is_active) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_alert_silences_updated_at ON alert_silences;
CREATE TRIGGER trg_alert_silences_updated_at BEFORE UPDATE ON alert_silences
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 8) alert_acknowledgments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_acknowledgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    acknowledged_by UUID NOT NULL REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    comment TEXT,

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce at most ONE active acknowledgment per event. A partial unique index
-- is correct here; the spec's UNIQUE(event_id, is_active) would have wrongly
-- limited inactive acks to one per event as well.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_ack_per_event
  ON alert_acknowledgments(event_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_alert_acks_org ON alert_acknowledgments(organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_alert_acknowledgments_updated_at ON alert_acknowledgments;
CREATE TRIGGER trg_alert_acknowledgments_updated_at BEFORE UPDATE ON alert_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 9) alert_escalation_policies + steps
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_escalation_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    description TEXT,

    repeat_interval_minutes INTEGER,
    max_repeats INTEGER NOT NULL DEFAULT 0,

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_policy_name_per_org
  ON alert_escalation_policies(organization_id, lower(name)) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_escalation_policies_updated_at ON alert_escalation_policies;
CREATE TRIGGER trg_alert_escalation_policies_updated_at BEFORE UPDATE ON alert_escalation_policies
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

CREATE TABLE IF NOT EXISTS alert_escalation_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id UUID NOT NULL REFERENCES alert_escalation_policies(id) ON DELETE CASCADE,

    step_number INTEGER NOT NULL,
    wait_minutes INTEGER NOT NULL DEFAULT 5,

    connector_ids UUID[] NOT NULL DEFAULT '{}',
    route_ids UUID[] NOT NULL DEFAULT '{}',
    notify_on_call BOOLEAN NOT NULL DEFAULT false,

    custom_message_template TEXT,
    template_id UUID,

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_step_number_per_policy UNIQUE (policy_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_alert_escalation_steps_policy ON alert_escalation_steps(policy_id, step_number);

DROP TRIGGER IF EXISTS trg_alert_escalation_steps_updated_at ON alert_escalation_steps;
CREATE TRIGGER trg_alert_escalation_steps_updated_at BEFORE UPDATE ON alert_escalation_steps
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 10) alert_event_batches (pg-boss worker tracking)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_event_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    status batch_status NOT NULL DEFAULT 'pending',
    event_ids UUID[] NOT NULL DEFAULT '{}',

    worker_id VARCHAR(255),
    pg_boss_job_id VARCHAR(255),

    event_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,

    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,

    error_message TEXT,
    error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    retry_count INTEGER NOT NULL DEFAULT 0,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_batches_status
  ON alert_event_batches(status, created_at) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_alert_event_batches_org
  ON alert_event_batches(organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_alert_event_batches_updated_at ON alert_event_batches;
CREATE TRIGGER trg_alert_event_batches_updated_at BEFORE UPDATE ON alert_event_batches
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 11) alert_delivery_attempts
-- ----------------------------------------------------------------------------
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
  ON alert_delivery_attempts(status, next_retry_at) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_batch
  ON alert_delivery_attempts(batch_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_alert_delivery_attempts_updated_at ON alert_delivery_attempts;
CREATE TRIGGER trg_alert_delivery_attempts_updated_at BEFORE UPDATE ON alert_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 12) alert_templates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    template_type VARCHAR(50) NOT NULL DEFAULT 'body',

    content TEXT NOT NULL,
    variables_schema JSONB NOT NULL DEFAULT '[]'::jsonb,

    default_for_severity alert_severity,
    connector_type connector_type,
    is_default BOOLEAN NOT NULL DEFAULT false,

    sample_data JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_template_name_per_org
  ON alert_templates(organization_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_templates_org
  ON alert_templates(organization_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_templates_updated_at ON alert_templates;
CREATE TRIGGER trg_alert_templates_updated_at BEFORE UPDATE ON alert_templates
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 13) alert_routing_rules
-- ----------------------------------------------------------------------------
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

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_routing_rule_name_per_org
  ON alert_routing_rules(organization_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_routing_rules_active
  ON alert_routing_rules(organization_id, priority DESC) WHERE deleted_at IS NULL AND is_active;

DROP TRIGGER IF EXISTS trg_alert_routing_rules_updated_at ON alert_routing_rules;
CREATE TRIGGER trg_alert_routing_rules_updated_at BEFORE UPDATE ON alert_routing_rules
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 14) alert_rule_executions (performance audit)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 15) alert_metrics (pre-aggregated)
-- ----------------------------------------------------------------------------
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

-- rule_id is nullable; COALESCE to a sentinel so the unique key treats
-- "org-wide" metrics (NULL rule_id) as a single distinct bucket instead of
-- allowing unlimited NULL-keyed duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_metric_bucket
  ON alert_metrics(
    organization_id, metric_type,
    COALESCE(rule_id, '00000000-0000-0000-0000-000000000000'::uuid),
    bucket_start, granularity
  );
CREATE INDEX IF NOT EXISTS idx_alert_metrics_lookup
  ON alert_metrics(organization_id, metric_type, granularity, bucket_start DESC);

-- ----------------------------------------------------------------------------
-- 16) COMMENTS
-- ----------------------------------------------------------------------------
COMMENT ON TABLE alert_rules IS 'Core alert rule definitions with evaluation and deduplication settings';
COMMENT ON TABLE alert_rule_conditions IS 'Individual conditions that make up an alert rule evaluation criteria';
COMMENT ON TABLE alert_rule_actions IS 'Actions to take when an alert rule triggers (notify, escalate, suppress)';
COMMENT ON TABLE alert_events IS 'Individual alert occurrences with lifecycle tracking';
COMMENT ON TABLE alert_event_history IS 'Complete audit trail of all alert state changes';
COMMENT ON TABLE alert_silences IS 'Time-based suppression of alerts by rule or matcher';
COMMENT ON TABLE alert_acknowledgments IS 'User acknowledgments of active alerts with optional expiry';
COMMENT ON TABLE alert_escalation_policies IS 'Escalation policies for unacknowledged alerts';
COMMENT ON TABLE alert_escalation_steps IS 'Sequential steps within an escalation policy';
COMMENT ON TABLE alert_event_batches IS 'Batch tracking for pg-boss worker processing';
COMMENT ON TABLE alert_delivery_attempts IS 'Per-connector delivery attempts with retry tracking';
COMMENT ON TABLE alert_templates IS 'Reusable message templates for connector formatting';
COMMENT ON TABLE alert_routing_rules IS 'Dynamic routing rules for connector selection';
COMMENT ON TABLE alert_rule_executions IS 'Performance audit of rule evaluation runs';
COMMENT ON TABLE alert_metrics IS 'Pre-aggregated metrics for dashboard performance';

-- ----------------------------------------------------------------------------
-- 17) ROW LEVEL SECURITY (INTENTIONALLY DISABLED — see migration header)
-- ----------------------------------------------------------------------------
-- This codebase isolates tenants in the service layer and does NOT set a
-- per-request `app.current_org_id` GUC. Enabling the spec's policies without
-- that GUC returns zero rows for every query. To adopt DB-enforced isolation:
--   (1) run `SELECT set_config('app.current_org_id', $orgId, true)` on the
--       connection per request, then (2) uncomment and apply policies such as:
--
-- ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY org_isolation_alert_rules ON alert_rules
--   USING (organization_id = current_setting('app.current_org_id', true)::UUID);
-- ... (analogous ENABLE + POLICY for every alert_* table; child tables key off
--      their parent's organization_id via an IN (SELECT ...) subquery) ...

COMMIT;

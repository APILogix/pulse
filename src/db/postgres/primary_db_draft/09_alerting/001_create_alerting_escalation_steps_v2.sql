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

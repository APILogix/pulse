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

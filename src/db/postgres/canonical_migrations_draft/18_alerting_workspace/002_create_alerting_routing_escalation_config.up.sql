BEGIN;

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

DROP TRIGGER IF EXISTS trg_alerting_routing_defaults_updated_at ON alerting_routing_defaults;
CREATE TRIGGER trg_alerting_routing_defaults_updated_at
  BEFORE UPDATE ON alerting_routing_defaults
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_escalation_policies_v2_updated_at ON alerting_escalation_policies_v2;
CREATE TRIGGER trg_alerting_escalation_policies_v2_updated_at
  BEFORE UPDATE ON alerting_escalation_policies_v2
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_escalation_steps_v2_updated_at ON alerting_escalation_steps_v2;
CREATE TRIGGER trg_alerting_escalation_steps_v2_updated_at
  BEFORE UPDATE ON alerting_escalation_steps_v2
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE alerting_routing_defaults IS
  'Logical severity routing defaults. Connector and route references remain null until configured.';
COMMENT ON TABLE alerting_escalation_policies_v2 IS
  'Configuration-only escalation chains; execution state is runtime data and is never seeded.';

COMMIT;

BEGIN;

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

DROP TRIGGER IF EXISTS trg_alert_escalation_steps_updated_at ON alert_escalation_steps;
CREATE TRIGGER trg_alert_escalation_steps_updated_at
  BEFORE UPDATE ON alert_escalation_steps
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;

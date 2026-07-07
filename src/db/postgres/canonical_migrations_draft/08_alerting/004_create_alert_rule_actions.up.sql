BEGIN;

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

DROP TRIGGER IF EXISTS trg_alert_rule_actions_updated_at ON alert_rule_actions;
CREATE TRIGGER trg_alert_rule_actions_updated_at
  BEFORE UPDATE ON alert_rule_actions
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;

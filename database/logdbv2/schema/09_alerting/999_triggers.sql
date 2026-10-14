-- Alerting triggers
DROP TRIGGER IF EXISTS trg_alert_event_state_updated_at ON alert_event_state;
CREATE TRIGGER trg_alert_event_state_updated_at
  BEFORE UPDATE ON alert_event_state
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

DROP TRIGGER IF EXISTS trg_alert_rule_eval_state_updated_at ON alert_rule_eval_state;
CREATE TRIGGER trg_alert_rule_eval_state_updated_at
  BEFORE UPDATE ON alert_rule_eval_state
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

-- ============================================================================
-- 003_alerting_create_core_schema.down.sql
-- ----------------------------------------------------------------------------
-- Clean rollback of everything created by 003_alerting_create_core_schema.up.sql.
-- Tables are dropped in FK-safe order (children first), then the enum types.
-- The shared connector_set_updated_at() function is left intact because it is
-- owned by 002_connectors_create_notification_schema and may still be in use.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS alert_metrics              CASCADE;
DROP TABLE IF EXISTS alert_rule_executions      CASCADE;
DROP TABLE IF EXISTS alert_routing_rules        CASCADE;
DROP TABLE IF EXISTS alert_templates            CASCADE;
DROP TABLE IF EXISTS alert_delivery_attempts    CASCADE;
DROP TABLE IF EXISTS alert_event_batches        CASCADE;
DROP TABLE IF EXISTS alert_escalation_steps     CASCADE;
DROP TABLE IF EXISTS alert_escalation_policies  CASCADE;
DROP TABLE IF EXISTS alert_acknowledgments      CASCADE;
DROP TABLE IF EXISTS alert_silences             CASCADE;
DROP TABLE IF EXISTS alert_event_history        CASCADE;
DROP TABLE IF EXISTS alert_events               CASCADE;
DROP TABLE IF EXISTS alert_rule_actions         CASCADE;
DROP TABLE IF EXISTS alert_rule_conditions      CASCADE;
DROP TABLE IF EXISTS alert_rules                CASCADE;

DROP TYPE IF EXISTS metric_granularity;
DROP TYPE IF EXISTS history_action;
DROP TYPE IF EXISTS batch_status;
DROP TYPE IF EXISTS delivery_attempt_status;
DROP TYPE IF EXISTS alert_event_status;
DROP TYPE IF EXISTS alert_action_type;
DROP TYPE IF EXISTS alert_condition_operator;
DROP TYPE IF EXISTS alert_condition_type;
DROP TYPE IF EXISTS alert_status;
DROP TYPE IF EXISTS alert_severity;

COMMIT;


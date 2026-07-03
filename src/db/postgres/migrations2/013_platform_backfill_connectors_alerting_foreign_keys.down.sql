-- ============================================================================
-- 013_platform_backfill_connectors_alerting_foreign_keys.down.sql
-- ----------------------------------------------------------------------------
-- Drops the backfilled connectors/alerting foreign keys added in 013.
-- ============================================================================

BEGIN;

ALTER TABLE IF EXISTS alert_escalation_steps
  DROP CONSTRAINT IF EXISTS fk_alert_escalation_steps_template;
ALTER TABLE IF EXISTS alert_rule_actions
  DROP CONSTRAINT IF EXISTS fk_alert_rule_actions_escalation_policy;
ALTER TABLE IF EXISTS alert_rule_actions
  DROP CONSTRAINT IF EXISTS fk_alert_rule_actions_template;
ALTER TABLE IF EXISTS alert_metrics
  DROP CONSTRAINT IF EXISTS fk_alert_metrics_organization;
ALTER TABLE IF EXISTS alert_rule_executions
  DROP CONSTRAINT IF EXISTS fk_alert_rule_executions_organization;
ALTER TABLE IF EXISTS alert_routing_rules
  DROP CONSTRAINT IF EXISTS fk_alert_routing_rules_organization;
ALTER TABLE IF EXISTS alert_templates
  DROP CONSTRAINT IF EXISTS fk_alert_templates_organization;
ALTER TABLE IF EXISTS alert_delivery_attempts
  DROP CONSTRAINT IF EXISTS fk_alert_delivery_attempts_organization;
ALTER TABLE IF EXISTS alert_event_batches
  DROP CONSTRAINT IF EXISTS fk_alert_event_batches_organization;
ALTER TABLE IF EXISTS alert_escalation_policies
  DROP CONSTRAINT IF EXISTS fk_alert_escalation_policies_organization;
ALTER TABLE IF EXISTS alert_acknowledgments
  DROP CONSTRAINT IF EXISTS fk_alert_acknowledgments_organization;
ALTER TABLE IF EXISTS alert_silences
  DROP CONSTRAINT IF EXISTS fk_alert_silences_organization;
ALTER TABLE IF EXISTS alert_event_history
  DROP CONSTRAINT IF EXISTS fk_alert_event_history_organization;
ALTER TABLE IF EXISTS alert_events
  DROP CONSTRAINT IF EXISTS fk_alert_events_organization;
ALTER TABLE IF EXISTS alert_rules
  DROP CONSTRAINT IF EXISTS fk_alert_rules_organization;

ALTER TABLE IF EXISTS notification_dead_letter
  DROP CONSTRAINT IF EXISTS fk_notification_dead_letter_connector;
ALTER TABLE IF EXISTS notification_dead_letter
  DROP CONSTRAINT IF EXISTS fk_notification_dead_letter_delivery;
ALTER TABLE IF EXISTS connector_audit_logs
  DROP CONSTRAINT IF EXISTS fk_connector_audit_logs_organization;
ALTER TABLE IF EXISTS notification_dead_letter
  DROP CONSTRAINT IF EXISTS fk_notification_dead_letter_organization;
ALTER TABLE IF EXISTS notification_deliveries
  DROP CONSTRAINT IF EXISTS fk_notification_deliveries_organization;
ALTER TABLE IF EXISTS notification_routes
  DROP CONSTRAINT IF EXISTS fk_notification_routes_organization;
ALTER TABLE IF EXISTS notification_templates
  DROP CONSTRAINT IF EXISTS fk_notification_templates_organization;
ALTER TABLE IF EXISTS connector_configs
  DROP CONSTRAINT IF EXISTS fk_connector_configs_organization;

COMMIT;

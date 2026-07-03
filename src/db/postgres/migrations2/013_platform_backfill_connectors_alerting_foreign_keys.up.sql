-- ============================================================================
-- 013_platform_backfill_connectors_alerting_foreign_keys.up.sql
-- ----------------------------------------------------------------------------
-- Adds organization and forward-reference foreign keys for the connectors and
-- alerting schemas after all prerequisite tables exist in the migration chain.
-- This backfills constraints that 002/003 cannot always add during a fresh
-- bootstrap because `organizations` is created later in 006.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_connector_configs_organization') THEN
    ALTER TABLE connector_configs
      ADD CONSTRAINT fk_connector_configs_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_templates_organization') THEN
    ALTER TABLE notification_templates
      ADD CONSTRAINT fk_notification_templates_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_routes_organization') THEN
    ALTER TABLE notification_routes
      ADD CONSTRAINT fk_notification_routes_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_deliveries_organization') THEN
    ALTER TABLE notification_deliveries
      ADD CONSTRAINT fk_notification_deliveries_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_dead_letter_organization') THEN
    ALTER TABLE notification_dead_letter
      ADD CONSTRAINT fk_notification_dead_letter_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_connector_audit_logs_organization') THEN
    ALTER TABLE connector_audit_logs
      ADD CONSTRAINT fk_connector_audit_logs_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_dead_letter_delivery') THEN
    ALTER TABLE notification_dead_letter
      ADD CONSTRAINT fk_notification_dead_letter_delivery
      FOREIGN KEY (original_delivery_id) REFERENCES notification_deliveries(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_dead_letter_connector') THEN
    ALTER TABLE notification_dead_letter
      ADD CONSTRAINT fk_notification_dead_letter_connector
      FOREIGN KEY (connector_id) REFERENCES connector_configs(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_rules_organization') THEN
    ALTER TABLE alert_rules
      ADD CONSTRAINT fk_alert_rules_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_events_organization') THEN
    ALTER TABLE alert_events
      ADD CONSTRAINT fk_alert_events_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_event_history_organization') THEN
    ALTER TABLE alert_event_history
      ADD CONSTRAINT fk_alert_event_history_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_silences_organization') THEN
    ALTER TABLE alert_silences
      ADD CONSTRAINT fk_alert_silences_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_acknowledgments_organization') THEN
    ALTER TABLE alert_acknowledgments
      ADD CONSTRAINT fk_alert_acknowledgments_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_escalation_policies_organization') THEN
    ALTER TABLE alert_escalation_policies
      ADD CONSTRAINT fk_alert_escalation_policies_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_event_batches_organization') THEN
    ALTER TABLE alert_event_batches
      ADD CONSTRAINT fk_alert_event_batches_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_delivery_attempts_organization') THEN
    ALTER TABLE alert_delivery_attempts
      ADD CONSTRAINT fk_alert_delivery_attempts_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_templates_organization') THEN
    ALTER TABLE alert_templates
      ADD CONSTRAINT fk_alert_templates_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_routing_rules_organization') THEN
    ALTER TABLE alert_routing_rules
      ADD CONSTRAINT fk_alert_routing_rules_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_rule_executions_organization') THEN
    ALTER TABLE alert_rule_executions
      ADD CONSTRAINT fk_alert_rule_executions_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_metrics_organization') THEN
    ALTER TABLE alert_metrics
      ADD CONSTRAINT fk_alert_metrics_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_rule_actions_template') THEN
    ALTER TABLE alert_rule_actions
      ADD CONSTRAINT fk_alert_rule_actions_template
      FOREIGN KEY (template_id) REFERENCES alert_templates(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_rule_actions_escalation_policy') THEN
    ALTER TABLE alert_rule_actions
      ADD CONSTRAINT fk_alert_rule_actions_escalation_policy
      FOREIGN KEY (escalation_policy_id) REFERENCES alert_escalation_policies(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alert_escalation_steps_template') THEN
    ALTER TABLE alert_escalation_steps
      ADD CONSTRAINT fk_alert_escalation_steps_template
      FOREIGN KEY (template_id) REFERENCES alert_templates(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

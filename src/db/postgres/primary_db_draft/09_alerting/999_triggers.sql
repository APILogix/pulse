-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_acknowledgments_updated_at ON alert_acknowledgments;
CREATE TRIGGER trg_alert_acknowledgments_updated_at
  BEFORE UPDATE ON alert_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_dead_letter_events_updated_at ON alert_dead_letter_events;
CREATE TRIGGER trg_alert_dead_letter_events_updated_at
  BEFORE UPDATE ON alert_dead_letter_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_delivery_attempts_updated_at ON alert_delivery_attempts;
CREATE TRIGGER trg_alert_delivery_attempts_updated_at
  BEFORE UPDATE ON alert_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_escalation_policies_updated_at ON alert_escalation_policies;
CREATE TRIGGER trg_alert_escalation_policies_updated_at
  BEFORE UPDATE ON alert_escalation_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_escalation_steps_updated_at ON alert_escalation_steps;
CREATE TRIGGER trg_alert_escalation_steps_updated_at
  BEFORE UPDATE ON alert_escalation_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_event_batches_updated_at ON alert_event_batches;
CREATE TRIGGER trg_alert_event_batches_updated_at
  BEFORE UPDATE ON alert_event_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_events_updated_at ON alert_events;
CREATE TRIGGER trg_alert_events_updated_at
  BEFORE UPDATE ON alert_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_routing_rules_updated_at ON alert_routing_rules;
CREATE TRIGGER trg_alert_routing_rules_updated_at
  BEFORE UPDATE ON alert_routing_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_rule_actions_updated_at ON alert_rule_actions;
CREATE TRIGGER trg_alert_rule_actions_updated_at
  BEFORE UPDATE ON alert_rule_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/08_alerting/020_create_alert_rule_bindings.up.sql
DROP TRIGGER IF EXISTS trg_alert_rule_bindings_updated_at ON alert_rule_bindings;
CREATE TRIGGER trg_alert_rule_bindings_updated_at
  BEFORE UPDATE ON alert_rule_bindings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_rule_conditions_updated_at ON alert_rule_conditions;
CREATE TRIGGER trg_alert_rule_conditions_updated_at
  BEFORE UPDATE ON alert_rule_conditions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_rules_updated_at ON alert_rules;
CREATE TRIGGER trg_alert_rules_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_silences_updated_at ON alert_silences;
CREATE TRIGGER trg_alert_silences_updated_at
  BEFORE UPDATE ON alert_silences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_templates_updated_at ON alert_templates;
CREATE TRIGGER trg_alert_templates_updated_at
  BEFORE UPDATE ON alert_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_alert_throttle_windows_updated_at ON alert_throttle_windows;
CREATE TRIGGER trg_alert_throttle_windows_updated_at
  BEFORE UPDATE ON alert_throttle_windows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_audit_roots_updated_at ON alerting_audit_roots;
CREATE TRIGGER trg_alerting_audit_roots_updated_at
  BEFORE UPDATE ON alerting_audit_roots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql
DROP TRIGGER IF EXISTS trg_alerting_dashboard_widgets_updated_at ON alerting_dashboard_widgets;
CREATE TRIGGER trg_alerting_dashboard_widgets_updated_at
  BEFORE UPDATE ON alerting_dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql
DROP TRIGGER IF EXISTS trg_alerting_entitlements_updated_at ON alerting_entitlements;
CREATE TRIGGER trg_alerting_entitlements_updated_at
  BEFORE UPDATE ON alerting_entitlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_escalation_policies_v2_updated_at ON alerting_escalation_policies_v2;
CREATE TRIGGER trg_alerting_escalation_policies_v2_updated_at
  BEFORE UPDATE ON alerting_escalation_policies_v2
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_escalation_steps_v2_updated_at ON alerting_escalation_steps_v2;
CREATE TRIGGER trg_alerting_escalation_steps_v2_updated_at
  BEFORE UPDATE ON alerting_escalation_steps_v2
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/08_alerting/022_alerting_consolidation_support.up.sql
DROP TRIGGER IF EXISTS trg_alerting_legacy_mappings_updated_at ON alerting_legacy_mappings;
CREATE TRIGGER trg_alerting_legacy_mappings_updated_at
  BEFORE UPDATE ON alerting_legacy_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql
DROP TRIGGER IF EXISTS trg_alerting_maintenance_config_updated_at ON alerting_maintenance_config;
CREATE TRIGGER trg_alerting_maintenance_config_updated_at
  BEFORE UPDATE ON alerting_maintenance_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql
DROP TRIGGER IF EXISTS trg_alerting_notification_defaults_updated_at ON alerting_notification_defaults;
CREATE TRIGGER trg_alerting_notification_defaults_updated_at
  BEFORE UPDATE ON alerting_notification_defaults
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
DROP TRIGGER IF EXISTS trg_alerting_policy_catalog_updated_at ON alerting_policy_catalog;
CREATE TRIGGER trg_alerting_policy_catalog_updated_at
  BEFORE UPDATE ON alerting_policy_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
DROP TRIGGER IF EXISTS trg_alerting_policy_categories_updated_at ON alerting_policy_categories;
CREATE TRIGGER trg_alerting_policy_categories_updated_at
  BEFORE UPDATE ON alerting_policy_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql
DROP TRIGGER IF EXISTS trg_alerting_project_policy_overrides_updated_at ON alerting_project_policy_overrides;
CREATE TRIGGER trg_alerting_project_policy_overrides_updated_at
  BEFORE UPDATE ON alerting_project_policy_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql
DROP TRIGGER IF EXISTS trg_alerting_project_policy_subscriptions_updated_at ON alerting_project_policy_subscriptions;
CREATE TRIGGER trg_alerting_project_policy_subscriptions_updated_at
  BEFORE UPDATE ON alerting_project_policy_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/004_create_alerting_provider_catalog.up.sql
DROP TRIGGER IF EXISTS trg_alerting_provider_catalog_updated_at ON alerting_provider_catalog;
CREATE TRIGGER trg_alerting_provider_catalog_updated_at
  BEFORE UPDATE ON alerting_provider_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_routing_defaults_updated_at ON alerting_routing_defaults;
CREATE TRIGGER trg_alerting_routing_defaults_updated_at
  BEFORE UPDATE ON alerting_routing_defaults
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql
DROP TRIGGER IF EXISTS trg_alerting_saved_views_updated_at ON alerting_saved_views;
CREATE TRIGGER trg_alerting_saved_views_updated_at
  BEFORE UPDATE ON alerting_saved_views
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql
DROP TRIGGER IF EXISTS trg_alerting_search_index_metadata_updated_at ON alerting_search_index_metadata;
CREATE TRIGGER trg_alerting_search_index_metadata_updated_at
  BEFORE UPDATE ON alerting_search_index_metadata
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql
DROP TRIGGER IF EXISTS trg_alerting_settings_updated_at ON alerting_settings;
CREATE TRIGGER trg_alerting_settings_updated_at
  BEFORE UPDATE ON alerting_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql
DROP TRIGGER IF EXISTS trg_alerting_usage_counters_updated_at ON alerting_usage_counters;
CREATE TRIGGER trg_alerting_usage_counters_updated_at
  BEFORE UPDATE ON alerting_usage_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
DROP TRIGGER IF EXISTS trg_alerting_workspaces_updated_at ON alerting_workspaces;
CREATE TRIGGER trg_alerting_workspaces_updated_at
  BEFORE UPDATE ON alerting_workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

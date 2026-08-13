-- Master Canonical PostgreSQL Schema Creator
-- File: 00_create_schema.sql
-- Executes all folder-by-folder schema creation scripts in strict dependency order.

\i 00_extensions/001_extensions.sql
\i 01_schemas/001_schemas.sql
\i 02_types/001_enums_and_domains.sql
\i 03_reference/001_connector_providers.sql
\i 04_identity/001_users_and_auth.sql
\i 05_organizations/001_organizations_core.sql
\i 05_organizations/002_organization_members_invites.sql
\i 05_organizations/003_organization_sso_scim.sql
\i 05_organizations/004_organization_security_audit.sql
\i 06_projects/001_projects_and_environments.sql
\i 06_projects/002_project_members_roles.sql
\i 06_projects/003_project_api_keys.sql
\i 06_projects/004_sdk_configurations.sql
\i 07_billing/001_plans_and_features.sql
\i 07_billing/002_entitlements_and_pricing.sql
\i 07_billing/003_subscriptions_and_overrides.sql
\i 07_billing/004_invoices_and_payments.sql
\i 07_billing/005_usage_metering_views.sql
\i 08_connectors/001_connector_configs.sql
\i 08_connectors/002_project_channels.sql
\i 09_alerting/001_alert_rules_conditions.sql
\i 09_alerting/002_alert_incidents_notifications.sql
\i 09_alerting/003_escalations_and_silences.sql
\i 10_observability/001_events_and_requests.sql
\i 11_usage/001_usage_counters_staging.sql
\i 10_observability/002_errors_and_logs.sql
\i 10_observability/003_metrics_and_spans.sql
\i 10_observability/004_ingestion_queues_outbox.sql
\i 12_ai/001_ai_credit_system.sql
\i 12_ai/002_ai_requests_responses.sql
\i 12_ai/003_ai_cache_prompts_routes.sql
\i 13_automation/001_automation_workflows.sql
\i 13_automation/002_automation_runs_steps.sql
\i 14_indexes/001_tenant_isolation_indexes.sql
\i 14_indexes/002_performance_query_indexes.sql
\i 15_functions/001_helper_functions.sql
\i 16_triggers/001_updated_at_and_audit_triggers.sql
\i 17_views/001_entitlement_and_usage_views.sql
\i 18_partitions/001_partition_setup.sql
\i 19_seeders/001_billing_and_reference_seeders.sql

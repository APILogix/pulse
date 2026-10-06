# PrimaryDB v2 Manifest

## Canonical Modular Schema Architecture
All PrimaryDB schemas, tables, enums, functions, views, triggers, and seeders reside in the canonical modular folder:
`database/primarydbv2/schema/` (mirrored in `src/db/postgres/primary_db_draft/`).

### Modular Domains (22 Folders):
1. `00_extensions` - PostgreSQL extensions (uuid-ossp, pgcrypto, citext, etc.)
2. `01_schemas` - Application namespaces
3. `02_types` - Domain enums and custom composite types
4. `03_reference` - Static platform reference catalogs
5. `04_user` - User identities, sessions, verification tokens
6. `05_organization` - Organization control-plane, audit logs, memberships
7. `06_project` - Projects, environments, API keys, rotation policies, settings
8. `07_billing` - Plans, entitlements, subscriptions, invoices, credit ledger, weighted event credit billing
9. `08_connector` - Webhook, Slack, Teams, and generic connector configs
10. `10_notification` - Notification routing rules and templates (precedes alert actions)
11. `09_alerting` - Alert rules, channels, incident tracking, preferences, escalation policies
12. `11_observability` - Telemetry ingestion jobs, dead letters, metrics, event rollups
13. `12_usage` - Real-time staging counters and usage facts
14. `13_ai` - AI model routing, prompts, and inference policies
15. `14_automation` - Workflows, triggers, actions, and execution runtime
16. `15_analytics` - Dashboards, hourly/daily rollups, saved queries, error groups
17. `16_security` - Enterprise security policies and audit trails
18. `17_functions` - Stored procedures, utility triggers, and weighted credit accounting
19. `18_views` - Analytical and usage views
20. `19_partitions` - Table partitioning declarations and default partitions
21. `20_seeders` - Initial catalog and template seeds
22. `21_comments` - Data dictionary schema documentation

## Direct Index & Schema Synchronization
All performance indexes, covering indexes, and migration modifications are placed directly in their respective table schema files:
- `04_user/001_create_user_sessions.sql`: includes `idx_user_sessions_user_active_last_active` and `idx_user_sessions_purge`.
- `04_user/001_create_user_linked_identities.sql`: includes `idx_user_linked_identities_user_all`.
- `04_user/001_create_email_verifications.sql`: includes `uq_email_verifications_user_email_purpose`.
- `05_organization/001_create_organizations.sql`: includes minimal schema and `idx_organizations_owner_active`.
- `05_organization/001_create_organization_audit_logs.sql`: includes `idx_org_audit_logs_purge`.
- `06_project/001_create_project_api_keys.sql`: includes `idx_project_api_keys_env_active` and prunes redundant write-amplification indexes.
- `06_project/001_create_project_settings.sql`: includes guaranteed column defaults.
- `07_billing/001_create_organization_subscriptions.sql`: includes `idx_org_subscriptions_active_current`.
- `07_billing/001_create_organization_usage_current_period.sql`: includes `raw_events_count` and `events_used NUMERIC(14, 4)`.
- `07_billing/001_create_billing_event_credit_weights.sql`: dedicated table with `idx_billing_event_credit_weights_active`.
- `08_connector/001_create_connector_configs.sql`: includes `idx_connector_configs_org_provider_status`.
- `09_alerting/001_create_project_alert_channels.sql`: includes `idx_project_alert_channels_org_proj_enabled`.
- `09_alerting/001_create_project_member_alert_channel_preferences.sql`: includes `idx_member_alert_prefs_lookup`.
- `09_alerting/001_create_alert_events.sql`: includes `idx_alert_events_org_fingerprint_status`.
- `09_alerting/001_create_alert_delivery_attempts.sql`: includes `idx_alert_delivery_attempts_event_created`.
- `14_automation/001_create_automation_workflows.sql`: includes `idx_automation_workflows_org_updated`.
- `17_functions/001_functions.sql`: includes `increment_event_usage` and `remaining_event_quota`.

## Table-by-Table Database Creation
Instead of relying on a monolithic schema file, the table-by-table bootstrap runner creates tables individually:
```bash
# Dry run preview of table-by-table creation order
npm run db:setup:modular -- --only primary --dry-run

# Execute table-by-table creation against PostgreSQL
npm run db:setup:primary

# Or full bootstrap including both databases
npm run db:setup:modular
```

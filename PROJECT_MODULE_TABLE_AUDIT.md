# Project Module Table Audit

The canonical project schema is consolidated under:

- `src/db/postgres/canonical_migrations_draft/04_projects/`

## Project-owned tables

Core:
- `projects`
- `project_settings`
- `project_environments`
- `project_members`
- `project_releases`
- `project_api_keys`

SDK configuration:
- `project_environment_sdk_configs`
- `project_environment_sdk_config_revisions`

Usage:
- `api_key_usage_minute`, `api_key_usage_hourly`, `api_key_usage_daily`, `api_key_usage_monthly`
- `project_usage_minute`, `project_usage_hourly`, `project_usage_daily`, `project_usage_monthly`, `project_usage_current`

Alerting and routing:
- `project_alert_thresholds`
- `project_alert_channels`
- `project_member_alert_channel_preferences`
- `project_notification_preferences`
- `project_connector_subscriptions`

History:
- `project_activity`
- `project_audit_logs`

## Cross-domain integration

Project table creation remains in `04_projects`. Later modules only link their own objects:
- `06_connectors/014_link_project_routing.up.sql`
- `08_alerting/018_link_project_delivery_audit.up.sql`
- `13_ingestion/006_create_usage_counter_staging.up.sql`
- `13_ingestion/009_create_project_usage_realtime_view.up.sql`

## Drift repairs

- `008_converge_project_members.up.sql` restores `invited_by`, backfills it from legacy `added_by_user_id`, and retains direct membership.
- `009_converge_project_api_keys.up.sql` creates `rotated_at` before any backfill or lifecycle expression references it.
- `016_add_environment_runtime_configuration.up.sql` forward-adds environment limits, event controls, network policy, and alert destinations used by runtime repositories.
- Project invitations and custom roles are removed.

## Manual teardown

`04_projects/999_delete_all_project_tables.down.sql` is destructive and intentionally excluded from automatic discovery. It must only be run manually against a database whose project data may be deleted.

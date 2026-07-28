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
- `project_api_key_rotations`

SDK configuration:
- `project_environment_sdk_configs`
- `project_environment_sdk_config_revisions`

Usage:
- Physical: `api_key_usage_minute` (monthly partitions), `api_key_usage_daily` (yearly partitions)
- Read-only views: `api_key_usage_hourly`, `api_key_usage_monthly`
- Lookup: `telemetry_event_types`
- Project rollups: `project_usage_minute`, `project_usage_hourly`, `project_usage_daily`, `project_usage_monthly`, `project_usage_current`

Alerting and routing:
- `project_alert_thresholds`
- `project_alert_channels`
- `project_member_alert_channel_preferences`
- `project_notification_preferences`
- `project_connector_subscriptions`

History:
- Organization audit entries filtered by `project_id` in `organization_audit_logs`

## Cross-domain integration

Project table creation remains in `04_projects`. Later modules only link their own objects:
- `06_connectors/014_link_project_routing.up.sql`
- `08_alerting/018_link_project_delivery_audit.up.sql`
- `13_ingestion/006_create_usage_counter_staging.up.sql`
- `13_ingestion/009_create_project_usage_realtime_view.up.sql`

## Drift repairs

- `008_converge_project_members.up.sql` restores `invited_by`, backfills it from legacy `added_by_user_id`, and retains direct membership.
- `009_converge_project_api_keys.up.sql` creates `rotated_at` before any backfill or lifecycle expression references it.
- `016_add_environment_runtime_configuration.up.sql` is retained as historical forward convergence for databases that already ledgered it.
- `017_simplify_project_environments.up.sql` removes those environment-level runtime controls, creator metadata, icon, and version; adds the canonical `project_environment_type` enum; backfills existing rows; and rebuilds only lifecycle, tenant, and list/count indexes.
- `018_normalize_project_api_keys_and_usage.up.sql` is the forward upgrade for already-ledgered databases. It backfills rotation history, reduces `project_api_keys` to the 15 canonical columns, replaces four writable API-key usage grains with two partitioned physical facts plus two read-only views, interns event types, migrates legacy data, and removes non-composable percentile fields.
- The complete keep/move/remove matrix, Option A/B/C analysis, retention, billing/dashboard contracts, bottlenecks, and diagrams are in [`docs/api-key-normalization.md`](docs/api-key-normalization.md).
- Ledgered migrations `005`–`017` remain historical and are not edited to pretend existing databases have been upgraded.
- The final environment table owns only identity (`name`, SDK-facing `slug`, business `type`), user-facing description/color, lifecycle state, tenant keys, and timestamps.
- Project invitations and custom roles are removed.

## Manual teardown

`04_projects/999_delete_all_project_tables.down.sql` is destructive and intentionally excluded from automatic discovery. It must only be run manually against a database whose project data may be deleted.

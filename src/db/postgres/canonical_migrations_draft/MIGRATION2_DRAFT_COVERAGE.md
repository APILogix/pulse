# Migration2 Draft Coverage

This file tracks how the current `migrations2/*.up.sql` chain maps into
`canonical_migrations_draft/`, and which areas are still partial.

Status legend:
- `covered`: represented in the draft chain
- `partial`: only some objects or behaviors are ported
- `pending`: not yet ported into the draft chain

## Coverage Summary

| migrations2 file | Draft status | Draft target(s) |
|---|---|---|
| `001_auth_create_core_schema.up.sql` | `covered` | `00_shared/*`, `01_auth/*`, `09_audit/001_create_audit_logs.up.sql` |
| `002_connectors_create_notification_schema.up.sql` | `covered` | `06_connectors/*`, `07_notifications/*` |
| `003_alerting_create_core_schema.up.sql` | `covered` | `08_alerting/*` |
| `004_analytics_create_core_schema.up.sql` | `partial` | `14_observability/*`, `15_analytics/*` |
| `005_auth_extend_mfa_schema.up.sql` | `pending` | not yet split into draft MFA/organization follow-up files |
| `006_organizations_create_core_schema.up.sql` | `covered` | `02_organizations/*`, `03_org_identity/*` |
| `007_organizations_create_sdk_config_schema.up.sql` | `pending` | remote config domain not yet ported |
| `008_projects_create_core_schema.up.sql` | `covered` | `04_projects/*`, `05_project_credentials/*` |
| `009_ingestion_create_queue_schema.up.sql` | `covered` | `13_ingestion/001-005_*` |
| `010_ingestion_create_usage_counters_schema.up.sql` | `covered` | `13_ingestion/006-009_*` |
| `011_ingestion_create_legacy_compat_schema.up.sql` | `covered` | `16_legacy_compat/*` |
| `012_auth_harden_email_outbox_schema.up.sql` | `partial` | behavior folded into `01_auth/010_create_auth_email_outbox.up.sql`, no dedicated hardening delta yet |
| `013_platform_backfill_connectors_alerting_foreign_keys.up.sql` | `pending` | draft chain uses direct FK ownership; explicit backfill migration not yet represented |
| `014_organizations_backfill_mfa_policy_columns.up.sql` | `partial` | draft org settings include target columns, but no dedicated backfill delta exists |
| `015_billing_create_core_schema.up.sql` | `covered` | `11_billing/*` |
| `016_billing_allow_org_level_usage.up.sql` | `covered` | `11_billing/006_allow_org_level_usage_daily_counters.up.sql` |
| `017_organizations_billing_security_indexes.up.sql` | `covered` | `10_security/001_harden_organization_security_indexes.up.sql` |
| `018_backpressure_gauge.up.sql` | `covered` | `12_monitoring/001_create_backpressure_gauge.up.sql` |
| `019_enterprise_auth_scim_schema.up.sql` | `covered` | `03_org_identity/*`, `09_audit/002_enhance_audit_logs.up.sql` |
| `020_user_preferences_schema.up.sql` | `covered` | `01_auth/011_create_user_preferences.up.sql` |
| `021_projects_remove_blocked_event_types.up.sql` | `pending` | project cleanup delta not yet ported |
| `022_alerting_tenant_isolation_cleanup.up.sql` | `pending` | project/notification backfill cleanup not yet ported |
| `023_project_alerting_hardening.up.sql` | `pending` | notification project-hardening indexes not yet ported |
| `027_project_member_roles_and_status.up.sql` | `covered` | folded into `04_projects/002_create_project_members.up.sql` |
| `028_project_api_keys.up.sql` | `covered` | folded into `05_project_credentials/001_create_project_api_keys.up.sql` |
| `029_project_settings.up.sql` | `covered` | `04_projects/004_create_project_settings.up.sql` |
| `030_project_usage_tables.up.sql` | `covered` | `15_analytics/002_create_project_usage_hourly_and_daily.up.sql` |
| `031_audit_logs_enhancement.up.sql` | `covered` | `09_audit/002_enhance_audit_logs.up.sql` |

## Remaining Gaps

### High priority

- `007_organizations_create_sdk_config_schema.up.sql`
  - Remote config / SDK config domain is still missing entirely from the draft chain.
- `021_projects_remove_blocked_event_types.up.sql`
  - Project cleanup migration still needs a draft equivalent.
- `022_alerting_tenant_isolation_cleanup.up.sql`
  - Important project-notification tenancy cleanup/backfill still unrepresented.
- `023_project_alerting_hardening.up.sql`
  - Project-scoped notification indexes and delivery hardening still missing.

### Medium priority

- `005_auth_extend_mfa_schema.up.sql`
  - The draft auth/org chain includes the eventual organization settings shape, but not the dedicated MFA extension migration or `sms_mfa_otps`.
- `012_auth_harden_email_outbox_schema.up.sql`
  - The draft auth outbox includes the final index set but does not preserve the history as a separate hardening migration.
- `013_platform_backfill_connectors_alerting_foreign_keys.up.sql`
  - Because the draft chain is building a clean bootstrap path, this may stay unnecessary, but parity work should explicitly decide that.
- `014_organizations_backfill_mfa_policy_columns.up.sql`
  - Same issue as `005`: final schema shape exists, explicit backfill step does not.

### Partial observability coverage

The following `events_*` family from `004_analytics_create_core_schema.up.sql`
is still incomplete in draft form:
- `events_traces`: covered
- `events_errors`: covered
- `events_requests`: covered
- `events_spans`: covered
- `events_metrics`: covered
- `events_messages`: covered
- `events_logs`: covered
- `events_profiles`: covered
- `events_cron_checkins`: covered
- `events_replays`: covered

Still missing from the authoritative `004` draft parity:
- any explicit `events_*` object not yet copied one-to-one from `migrations2`
  - current examples: no draft `events_messages`/`events_logs` full parity comments or all columns from source beyond the drafted subset
- `analytics_alerts` table is covered inside `15_analytics/006_create_analytics_config_tables.up.sql`
- Timescale compression policy details are still simplified in the draft shim

## Intended Next Steps

1. Port `07_organizations_create_sdk_config_schema.up.sql` into a new draft remote config domain.
2. Add project/notification cleanup deltas for `021`, `022`, and `023`.
3. Add explicit draft MFA delta files for `005`, `012`, and `014` if historical parity is required.
4. Run the draft bootstrap integration test in an environment with a working container runtime and fix real DDL/order failures.

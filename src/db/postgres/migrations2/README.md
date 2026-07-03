# migrations2 - Consolidated and Corrected Schema

## Why this folder exists

The original `migrations/` folder mixed older auth, ingestion, and telemetry DDL
with conflicting or superseded definitions. The backend code now treats
`migrations2/` as the authoritative schema chain for fresh databases.

This folder is the source of truth for:
- auth
- notification connectors
- alerting
- analytics and raw SDK event storage
- MFA
- organization and project management
- ingestion queue and usage accounting
- legacy ingestion compatibility tables that still have code references

It does not need the old `migrations/` files to bootstrap a working database.

## Files

| File | Purpose |
|------|---------|
| `001_auth_create_core_schema.{up,down}.sql` | Canonical auth schema. |
| `002_connectors_create_notification_schema.{up,down}.sql` | Notification connector configs and delivery tables. |
| `003_alerting_create_core_schema.{up,down}.sql` | Alerting rules, events, routing, and delivery attempts. |
| `004_analytics_create_core_schema.{up,down}.sql` | Authoritative `events_*` telemetry schema and analytics tables. |
| `005_auth_extend_mfa_schema.{up,down}.sql` | MFA extensions. |
| `006_organizations_create_core_schema.{up,down}.sql` | Organizations, members, audit, invites, environments, quotas. |
| `007_organizations_create_sdk_config_schema.{up,down}.sql` | SDK config module schema. |
| `008_projects_create_core_schema.{up,down}.sql` | Projects, project API keys, environment config, governance. |
| `009_ingestion_create_queue_schema.{up,down}.sql` | Postgres ingestion queue, DLQ, admin logs, queue snapshot view. |
| `010_ingestion_create_usage_counters_schema.{up,down}.sql` | Usage staging, rollups, realtime view, rollup function. |
| `011_ingestion_create_legacy_compat_schema.{up,down}.sql` | Legacy ingestion table names preserved for compatibility while live ingestion writes to `events_*`. |
| `012_auth_harden_email_outbox_schema.{up,down}.sql` | Auth outbox processing-claim hardening and purge indexes. |
| `015_billing_create_core_schema.{up,down}.sql` | Canonical billing plans, subscriptions, invoices, coupons, subscription events, and daily usage counters. |

## Operational note

The migration runner should apply the `*.up.sql` files in this folder only.
The old `migrations/` directory remains reference material and backward history,
not the authoritative bootstrap path.

## How to apply

```bash
# Fresh DB
psql "$DATABASE_URL" -f migrations2/001_auth_create_core_schema.up.sql

# Continue through the remaining *.up.sql files in lexicographic order
```

For databases that already ran some older migrations, the `migrations2/` files
are written to be additive and idempotent where practical.


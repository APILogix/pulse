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
| `001_auth_canonical_consolidated.{up,down}.sql` | Canonical auth schema. |
| `002_add_notification_connectors.{up,down}.sql` | Notification connector configs and delivery tables. |
| `003_add_alerting_module.{up,down}.sql` | Alerting rules, events, routing, and delivery attempts. |
| `004_add_analytics_module.{up,down}.sql` | Authoritative `events_*` telemetry schema and analytics tables. |
| `005_add_mfa_system.{up,down}.sql` | MFA extensions. |
| `006_add_organization_module.{up,down}.sql` | Organizations, members, audit, invites, environments, quotas. |
| `007_add_sdk_config_module.{up,down}.sql` | SDK config module schema. |
| `008_add_projects_module.{up,down}.sql` | Projects, project API keys, environment config, governance. |
| `009_add_ingestion_queue_v2.{up,down}.sql` | Postgres ingestion queue, DLQ, admin logs, queue snapshot view. |
| `010_add_ingestion_usage_counters.{up,down}.sql` | Usage staging, rollups, realtime view, rollup function. |
| `011_add_legacy_ingestion_compat_tables.{up,down}.sql` | Legacy ingestion table names preserved for compatibility while live ingestion writes to `events_*`. |

## Operational note

The migration runner should apply the `*.up.sql` files in this folder only.
The old `migrations/` directory remains reference material and backward history,
not the authoritative bootstrap path.

## How to apply

```bash
# Fresh DB
psql "$DATABASE_URL" -f migrations2/001_auth_canonical_consolidated.up.sql

# Continue through the remaining *.up.sql files in lexicographic order
```

For databases that already ran some older migrations, the `migrations2/` files
are written to be additive and idempotent where practical.

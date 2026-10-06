# LogDB v2 Manifest

## Canonical Modular Schema Architecture
All LogDB schemas, tables, partitions, functions, and triggers reside in the canonical modular folder:
`database/logdbv2/schema/` (mirrored in `src/db/postgres/log_db_draft/`).

### Modular Domains (16 Folders):
1. `00_extensions` - PostgreSQL extensions (uuid-ossp, pgcrypto, btree_gist)
2. `01_types` - Sequences and enum types
3. `02_schema_notes` - LogDB data architecture and tenancy documentation
4. `03_lookup` - Cached tenant dimension lookup tables (organizations, projects, environments, api_keys)
5. `04_ingestion` - Telemetry ingestion staging queues, backpressure gauges, worker metrics
6. `05_observability` - Canonical partitioned telemetry tables (`events_requests`, `events_errors`, `events_logs`, `events_metrics`, `events_spans`, `events_traces`, `events_messages`, `events_profiles`, `events_replays`, `events_cron_checkins`)
7. `06_error_groups` - Error fingerprinting, grouping, and historical state
8. `07_analytics` - Hourly and daily analytical rollups, dashboards, anomaly detections
9. `08_connectors` - Connector delivery logs and webhook runtime audit events
10. `09_alerting` - Alerting runtime metrics, event state, notifications, dead-letter events
11. `10_ai` - AI request logs, insights, tool calls, and usage receipts
12. `11_outbox` - Telemetry and error group outbox tables
13. `12_search` - Full-text and inverted index search tables
14. `13_geo` - Geolocation lookup tables (countries, networks, locations)
15. `14_retention` - Partition retention management jobs and execution statistics
16. `15_functions` - Schema contract validation functions, trigger functions, and cleanup routines

## High-Performance Indexing & Partitioning Strategy:
- **Tenant-environment-time composite B-tree indexes** for hot analytical queries.
- **BRIN indexes** across append-heavy timestamp partitions.
- **High-performance hot-path indexes** on `events_spans`:
  - `idx_events_spans_org_trace_time_asc`
  - `idx_events_spans_org_span_id`
  - `idx_events_spans_slow_db`
  - `idx_events_spans_db_collection`
  - `idx_events_spans_org_session_time`
- **Zero redundant GIN indexes** on unqueried JSONB columns to avoid write amplification.
- **Range partitioning** with default partition declaration for all canonical telemetry tables.

## Table-by-Table Database Creation
Instead of relying on a monolithic schema file, the table-by-table bootstrap runner creates tables individually:
```bash
# Dry run preview of table-by-table creation order
npm run db:setup:modular -- --only logdb --dry-run

# Execute table-by-table creation against PostgreSQL
npm run db:setup:logdb

# Or full bootstrap including both databases
npm run db:setup:modular
```

Full architecture and audit documentation:
- [SCHEMA_RECONCILIATION.md](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/db/postgres/log_db_draft/SCHEMA_RECONCILIATION.md)
- [INDEX_STRATEGY.md](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/db/postgres/log_db_draft/INDEX_STRATEGY.md)

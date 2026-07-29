# Log Database Migrations

This folder contains the independent Log DB schema. Tables in this tree store
primary-database identifiers as plain UUID/TEXT values and intentionally avoid
foreign keys to `organizations`, `projects`, `project_api_keys`, `users`,
`subscriptions`, `connector_configs`, and `alert_rules`.

Partitioning choices:

- Usage rollups are range-partitioned by `bucket` for dashboard windows,
  worker UPSERTs, and retention pruning.
- Canonical event and legacy telemetry tables are range-partitioned by event
  time because ingestion is append-heavy and queries are time-bounded.
- Runtime/audit tables are range-partitioned by creation or occurrence time to
  isolate hot writes and allow old partitions to be dropped.
- Lookup and dimension tables are intentionally not partitioned because they are
  comparatively small, high-read reference datasets.

Indexing choices:

- Tenant/time btree indexes support common dashboard predicates.
- BRIN indexes support broad time scans with low write amplification.
- GIN indexes are limited to JSONB attributes/payloads that are expected to be
  filtered or searched.
- Worker claim indexes are partial indexes over pending/active states to keep
  queue maintenance cost bounded.

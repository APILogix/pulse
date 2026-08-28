# 06 — Database capacity

# NOT MEASURED

Current Neon compute size, connection limits, and database-level limits were **not retrieved in this session** — no live database connection was available. Per spec §13, these must be read from the actual environment/deployment configuration, never invented.

## What must be captured, and how, once access exists

| Field | How to obtain it |
| --- | --- |
| Neon compute size (CU) | Neon console → project → branch → Compute settings; or `SELECT current_setting('shared_buffers'), current_setting('max_connections');` as a proxy, cross-referenced against Neon's published CU-to-resource table (do not assume the mapping; confirm from Neon's current documentation, since it has changed over provider versions). |
| Connection limit | `SHOW max_connections;` on the target, and Neon's connection pooler (PgBouncer) limit if the app connects through the pooled endpoint rather than direct. |
| Database size / storage limits | Neon console, or `SELECT pg_database_size(current_database());` compared against the plan's storage allowance. |
| Worker replica count | Deployment configuration (`ecosystem.config.cjs` process count, or the container/K8s replica count in the actual deployment — not committed to this repository in a way that reflects live topology). |
| Pool sizes actually in effect | `INGESTION_WRITE_POOL_SIZE`, `INGESTION_DB_POOL_SIZE`, `INGESTION_WRITE_CONCURRENCY` — read from the **actual deployed** environment variables, not just the `env.ts` defaults (defaults are documented in [`04-current-capacity.md`](04-current-capacity.md); they may be overridden in production). |

## Static defaults on record (not the same as actual deployed configuration)

| Setting | Default | Source |
| --- | ---: | --- |
| `INGESTION_DB_POOL_SIZE` | 8 | `env.ts:258` |
| `INGESTION_WRITE_POOL_SIZE` | 20 | `env.ts:279` |
| `INGESTION_WRITE_CONCURRENCY` | 16 | `env.ts:283` |

These are code defaults. The prior correctness audit separately recorded (from a live schema snapshot, not this session) static fleet connection ceiling arithmetic — Primary 97, Log primary 84, Log replica 60, against a recorded conditional server capacity of 895 slots — but explicitly noted actual peak usage, provider compute size, and CPU headroom were unmeasured at that time too. That prior snapshot should not be treated as current without re-verification.

## Postgres/Neon telemetry the collector can gather, once reachable

[`metrics-collector.ts`](../../../scripts/bench/metrics-collector.ts) samples, via a read-only monitoring connection (`--db-url`):
- active/idle/total connection counts (`pg_stat_activity`)
- waiting lock count (`pg_locks`)
- current WAL LSN (for delta computation across a run)
- cumulative commits/rollbacks (`pg_stat_database`)

It does **not** currently sample Neon-specific compute/CU utilization, since that requires either the Neon API (not wired) or `pg_stat_statements`-derived CPU proxies (extension availability was previously found absent in the prior audit's capability snapshot). Adding Neon API telemetry is listed as follow-up work in [`15-regression-benchmark.md`](15-regression-benchmark.md).

## Related documents

- [Current capacity](04-current-capacity.md)
- [Bottleneck analysis](05-bottleneck-analysis.md)
- [Neon upgrade comparison](13-neon-upgrade-comparison.md)

# Query inventory

Status date: 2026-08-27. Statement counts are source-derived conventions, not server execution metrics.

## Transaction setup/control

| Classification | Statement/control | Purpose |
| --- | --- | --- |
| **MEASURED** | `BEGIN` / `COMMIT` / `ROLLBACK` | One Log DB transaction per persisted source job. |
| **MEASURED** | combined `SET LOCAL` | Synchronous commit, 2s lock timeout, 60s statement timeout, 30s idle-in-transaction timeout under defaults. |
| **MEASURED** | `SELECT pg_cancel_backend($1)::boolean AS cancelled` | Mutating backend-control query on a separate pool client during active-query abort; not a read-only diagnostic. |

## Generic typed path

**MEASURED:** non-error typed writers use one set-based multi-row `INSERT INTO events_<type> ... ON CONFLICT DO NOTHING` per grouped type.

**MEASURED:** when at least one typed row inserts, additional idempotency/outbox statements execute inside the same transaction. A fully duplicate non-error batch skips outbox/usage work.

**DERIVED:** typed INSERT count is constant with batch row count; total transaction statements depend on outbox/reservation branches. Avoid treating an approximate “five statements” convention as measured server execution.

## Trace path

| Classification | Statement | Scaling |
| --- | --- | --- |
| **MEASURED** | set-based `events_traces` header insert | One per grouped trace list. |
| **MEASURED** | `events_spans` derived-row insert | `ceil(S/978)` for `S` derived rows. |
| **MEASURED** | transactional outbox/reservation | Only for inserted telemetry, branch-dependent. |

**DERIVED:** 978 is `floor(65,535/67)`. The SQL chunk bound does not remove full-parent payload replication in every derived span.

## Error path

| Classification | Branch | Approximate source-derived scaling |
| --- | --- | --- |
| **DERIVED** | Normal grouping/regression branches | Bounded roughly 7–12 queries depending branch. |
| **DERIVED** | All duplicate | Skips inserted-error grouping/outbox/domain-event/usage work. |
| **DERIVED** | Merged-group fallback | Approximately `3N + constants/merge-chain hops`; remaining O(N) statement path. |

Exact counts vary with branch and counting convention (transaction boundaries and combined SET statement).

## Usage path

| Classification | Query group | Notes |
| --- | --- | --- |
| **MEASURED** | `ensureSchema()` DDL/check path | Runs inside one authoritative `flushPromise`; runtime DDL duplicates schema authority. |
| **MEASURED** | multi-row insert to `usage_counter_staging` | Primary DB, `UNLOGGED`; snapshot re-buffered exactly once on failure. |
| **MEASURED** | rollup queries | Scale with organizations/projects/flush passes and update billing tables transactionally. |

**DERIVED:** UsageCounter staging is post-COMMIT and not atomically tied to the Log DB typed transaction.

## DLQ/queue path

- pg-boss send/insert creates source, fairness-copy, and validation-DLQ jobs in Primary DB.
- pg-boss fetch/settlement updates `job_common` under installed library semantics.
- DLQ intake inserts/updates operational dead-letter persistence in Primary DB.
- replay-all work scales linearly with selected dead-letter rows and sends.

**MEASURED:** idle evidence recorded two `job_common` sequential scans and 222,352 tuples read against an estimate of 111,176 live rows. Diagnostics/background activity prevents workload attribution.

## Migration/admin path

| Classification | Statement | Context |
| --- | --- | --- |
| **MEASURED** | `pg_try_advisory_lock` / unlock | Fail-fast forward/rollback serialization in repository commands. |
| **MEASURED** | migration ledger reads/writes | Log DB migration tracking. |
| **MEASURED** | migration 030 duplicate/drain assertions | Preconditions before index DDL. |
| **MEASURED** | `SET LOCAL lock_timeout='5s'` + parent index DDL | Executes only in a real migration, not runner dry-run. |

Migration 030 was not run live.

## Read-only forensic/diagnostic queries

Catalog/statistics inspection used `pg_stat_activity`, `pg_stat_user_indexes`, `pg_stat_user_tables`, `pg_class`, `pg_inherits`, trigger/sequence/default catalogs, and recorded relation-size queries. Their results are point-in-time and their own activity can affect counters.

## Timeout distinctions

| Query class | Timeout authority |
| --- | --- |
| Active ingestion transaction | `SET LOCAL INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS`, default 60s. |
| Generic Log DB read wrapper | `LOG_QUERY_TIMEOUT`, default 30s. |
| Generic Log DB write wrapper | `LOG_DB_WRITE_TIMEOUT`, default 0; this does not disable the ingestion transaction's SET LOCAL timeout. |
| General Primary pool | `DB_STATEMENT_TIMEOUT_MS`, default 30s. |

A PostgreSQL statement timeout/cancel leaves an open transaction in error state until rollback; the processor catches, rolls back, releases, and fails the job.

## Measurement gaps

- no complete `pg_stat_statements` workload capture;
- no live INSERT `EXPLAIN (ANALYZE, BUFFERS, WAL)` bundle;
- no WAL/event or trigger-cost result;
- no bounded index present/absent comparison; and
- **BENCHMARK NOT EXECUTED**.

## Related documents

- [Query optimization](query-optimization.md)
- [Transaction model](transaction-model.md)
- [Connection pools](connection-pools.md)
- [Index forensics](index-forensics.md)
- [Forensic report](../performance/forensic-report.md)

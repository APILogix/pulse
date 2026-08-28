# Connection pools

Status date: 2026-08-27. Defaults are source configuration; observed sessions are short idle snapshots, not peak demand.

## Ingestion-process topology

| Classification | Pool/client group | Default max | Role |
| --- | --- | ---: | --- |
| **MEASURED** | Dedicated Primary ingestion pool | 8 | Usage staging/rollup, DLQ persistence, control queries. |
| **MEASURED** | pg-boss pool/listener | Configured separately from the dedicated Primary pool | Queue storage, fetch, scheduling, NOTIFY where enabled. |
| **MEASURED** | Shared Log DB access | Shared log configuration | Connectivity/migration/shared access. |
| **MEASURED** | Dedicated telemetry write pool | 20 | Typed/error/outbox transactions and abort-control checkout. |

API/general workers also own pools, which is why fleet ceilings cannot be calculated from the ingestion process alone.

## Important configuration distinctions

- `DB_POOL_MAX=20` is the general Primary pool default; the dedicated ingestion Primary pool uses `INGESTION_DB_POOL_SIZE=8`.
- `LOG_QUERY_TIMEOUT=30,000` and `LOG_DB_WRITE_TIMEOUT=0` apply to the generic Log DB wrapper.
- Active ingestion transactions independently apply `SET LOCAL INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS`, default 60,000 ms; they are not unbounded merely because generic `LOG_DB_WRITE_TIMEOUT` defaults to zero.
- dedicated write-pool checkout timeout comes from Log DB pool configuration; `connectWithAbort()` adds signal cancellation and late-client release.

## Write admission

```text
reserve = poolMax >= 8 ? 2 : 1
poolCeiling = max(1, poolMax - reserve)
effectivePermits = max(1, min(INGESTION_WRITE_CONCURRENCY, poolCeiling))
```

**DERIVED:** default effective permits are `min(16, 20 - 2) = 16`.

**MEASURED:** permits are acquired FIFO before checkout. The reserve leaves physical capacity for cancellation/control checkout; it is not automatically available as more transaction throughput.

**DERIVED:** this bounds ingestion transactions per process. It does not prove the entire pool/database cannot saturate through cancellation races, other users, overrides, provider behavior, or multiple processes.

## Abortable checkout

**MEASURED:** `connectWithAbort(pool, signal)` races `pool.connect()` with the signal. If the signal wins and checkout resolves later, the late client is released asynchronously.

**MEASURED:** an already-aborted job does not check out a client after waiting for admission.

## Held-client backend cancellation

1. read the checked-out target client's runtime `processID`;
2. while a query is active, obtain a separate client from reserved pool headroom;
3. execute `SELECT pg_cancel_backend($1)::boolean AS cancelled`;
4. keep the target client checked out while cancellation resolves;
5. block target-client queries after abort except `ROLLBACK`;
6. rollback if the transaction is open; and
7. release the target only afterward.

**MEASURED:** holding the target prevents PID reuse from turning a late cancel into cancellation of unrelated work. If `processID` is invalid or cancellation fails, the code logs the condition; per-statement timeout remains the active-query fallback.

**MEASURED:** if COMMIT wins the race and reports success, the application treats it as committed and completes inserted-only usage accounting.

## Per-transaction settings

| Setting | Default | Scope |
| --- | ---: | --- |
| `lock_timeout` | 2,000 ms | Lock acquisition per statement. |
| `statement_timeout` | 60,000 ms | Each transaction statement. |
| `idle_in_transaction_session_timeout` | 30,000 ms | Idle time in an open transaction. |
| `synchronous_commit` | Configured `on` in audited defaults | Commit durability. |

Statement timeout does not bound normalization, fairness, admission, checkout, all statements together, or post-COMMIT work.

## Recorded capacity and sessions

| Classification | Result |
| --- | --- |
| **MEASURED** | PostgreSQL 18.6 endpoint reported `max_connections=901`, reserved 0, superuser-reserved 6. |
| **DERIVED** | Conditional usable slots: 895 before provider/operational headroom. |
| **DERIVED** | Static default fleet ceilings: Primary 97, Log primary 84, Log replica 60. |
| **MEASURED** | Three distinct configured endpoints showed 10/10/11 observed sessions during the idle audit. |
| **UNKNOWN** | Actual peak, provider compute size/soft limits, pooler multiplexing, effective overrides, and workload CPU. |

These values do not authorize consuming 895 connections or raising any pool.

## Metrics interpretation

| Signal | Interpretation |
| --- | --- |
| `writeAdmissionWaitMs` high, checkout low | Configured admitted-write capacity is the immediate queue. |
| checkout wait high after admission | Investigate pool users, active cancellations, endpoint health, backend count, and DB CPU. |
| both low with growing pg-boss backlog | Bottleneck may be normalization, queue fetch, fairness, statement work, or process CPU; evidence required. |

## Pool/concurrency increase gate

Require a repeated isolated workload recording admission/checkout waits, active backends, DB/process CPU, RSS/heap/GC, queue drain, tenant fairness, retries/cancellations, WAL, and commit latency. Check fleet arithmetic with actual deployment counts and provider limits before changing defaults.

# BENCHMARK NOT EXECUTED

## Related documents

- [Database architecture](database-architecture.md)
- [Transaction model](transaction-model.md)
- [Neon capacity](neon-capacity.md)
- [Worker concurrency](../workers/worker-concurrency.md)
- [Forensic report](../performance/forensic-report.md)

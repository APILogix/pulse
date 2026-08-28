# Worker concurrency

Status date: 2026-08-27. Values are source defaults, not measured throughput.

## Concurrency layers

| Layer | Classification | Default ceiling/scope |
| --- | --- | --- |
| pg-boss typed delivery | **DERIVED** | 10 queues × `localConcurrency=2` callbacks × `batchSize=4` jobs = up to 80 delivered typed jobs per process. |
| DLQ intake | **DERIVED** | `localConcurrency=2` × `batchSize=10` = up to 20 delivered DLQ jobs. |
| Usage rollup | **MEASURED** | One process-local worker registration for a shared schedule. |
| Tenant fairness | **MEASURED** | Per-organization, per-process limits before DB admission. |
| Log DB write admission | **DERIVED** | `min(configured 16, pool 20 - reserve 2) = 16` transaction permits. |
| Dedicated write pool | **MEASURED** | Maximum 20 PostgreSQL clients in the ingestion write pool. |
| Primary ingestion pool | **MEASURED** | Maximum 8 clients for usage/DLQ/control work. |

`batchSize` is jobs delivered to one callback, not SQL row batch size. `localConcurrency × batchSize` describes jobs that can be active/fetched through one queue's callbacks.

## Typed delivery versus DB concurrency

**MEASURED:** all typed handlers normalize before `EventProcessor` enters the write-admission controller.

**DERIVED:** at full default typed delivery, 16 jobs can hold admission permits while up to 64 additional typed jobs can wait in FIFO admission. This is a per-process upper envelope under the current delivery settings, not an unbounded admission queue.

**MEASURED:** the permit formula is:

```text
reserve = poolMax >= 8 ? 2 : 1
poolCeiling = max(1, poolMax - reserve)
permits = max(1, min(configuredWriteConcurrency, poolCeiling))
```

The reserve is required for cancellation/control checkout such as `pg_cancel_backend`; it must not be treated as spare throughput automatically available to transactions.

**DERIVED:** the formula prevents ingestion transactions alone from consuming the full dedicated write pool. It does not prove that every possible user of the pool, provider proxy, or database fleet remains unsaturated under load.

## FIFO admission properties

- **MEASURED:** waiters are admitted in arrival order.
- **MEASURED:** permits release in `finally`.
- **MEASURED:** no admission timeout is used after a job has been durably accepted.
- **MEASURED:** already-aborted jobs reject before acquisition.
- **MEASURED:** queued aborted waiters are synchronously removed.
- **MEASURED:** if abort races after permit acquisition but before continuation, the permit is released.
- **MEASURED:** `stats()` exposes permit, in-flight, and queued state.

## Cancellation scope

**MEASURED:** installed pg-boss v12.22 assigns one shared `AbortSignal` to every job in a delivered callback batch. It aborts on handler-expiry timeout cleanup and in the shutdown `failWip()` path; it is also aborted after a successfully completed callback when the timeout promise is cleaned up, which is harmless after return.

**MEASURED:** cancellation checkpoints surround fairness, admission, checkout, transaction work, and COMMIT. A late pool checkout is released. Active PostgreSQL cancellation temporarily consumes reserved pool headroom while the target client remains held through cancellation and rollback.

**DERIVED:** cancellation can reduce expired-work overlap; it does not increase the configured 16 transaction permits.

## Settlement semantics

**MEASURED:** typed workers use `perJobResults=true`; mixed success/failure callbacks return per-job outcomes so one failed job need not retry successful batchmates.

**MEASURED:** when every job in the delivered batch fails, `settle()` throws one aggregate callback error. This preserves failure/retry but can reduce per-job diagnostics; it is a deferred lower-severity issue.

**MEASURED:** the pg-boss signal is shared by jobs in the callback batch. It must not be documented as independently cancellable per item.

## Scaling arithmetic

For `R` ingestion processes, configured source concurrency `C`, and handler batch size `B`:

```text
typed delivered jobs <= R × 10 × C × B
Log DB transactions <= R × effectiveWritePermits
write-pool clients <= R × writePoolMax
primary clients <= R × primaryPoolMax
```

These are static maxima, not capacity predictions. Default static fleet ceilings were derived as Primary 97, Log primary 84, and Log replica 60 sessions against a recorded conditional server capacity of 895; actual peak, provider limits, and CPU remain **UNKNOWN**.

## Safe tuning gates

No concurrency or pool increase is authorized until one isolated workload captures, at the same time:

1. queue enqueue/drain and retries;
2. tenant-share fairness;
3. `writeAdmissionWaitMs` and pool checkout wait;
4. database active backends and CPU;
5. process CPU/RSS/heap/GC;
6. lock/statement failures and cancellation success;
7. WAL and commit latency; and
8. repeated baseline/candidate comparisons.

# BENCHMARK NOT EXECUTED

## Related documents

- [Worker architecture](worker-architecture.md)
- [Fairness](worker-fairness.md)
- [Backpressure](worker-backpressure.md)
- [Memory model](worker-memory.md)
- [Worker lifecycle](worker-and-queue-lifecycle.md)
- [Connection pools](../database/connection-pools.md)

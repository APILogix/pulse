# Worker and queue lifecycle

## Queue catalog

| Classification | Queue | Producer/consumer purpose |
| --- | --- | --- |
| **MEASURED** | `ingest.error` | Error events and grouping path. |
| **MEASURED** | `ingest.message` | Message events. |
| **MEASURED** | `ingest.request` | Request events. |
| **MEASURED** | `ingest.span` | Standalone spans. |
| **MEASURED** | `ingest.trace` | Trace headers and nested spans. |
| **MEASURED** | `ingest.metric` | Metrics. |
| **MEASURED** | `ingest.log` | Logs. |
| **MEASURED** | `ingest.profile` | Profiles. |
| **MEASURED** | `ingest.cron_checkin` | Cron check-ins. |
| **MEASURED** | `ingest.replay` | Session replays. |
| **MEASURED** | `ingest.dlq-intake` | Validation rejects and exhausted source jobs; persists operational DLQ rows. |
| **MEASURED** | `ingest.usage-rollup` | Singleton scheduled usage/billing rollup. |

## Desired queue options and provisioning order

**MEASURED:** `provisionIngestQueues()` creates `ingest.dlq-intake` first, then all ten source queues, then `ingest.usage-rollup`.

**MEASURED:** Source options request `partition=true`, `notify=true`, configured retry limit/delay, exponential backoff, expiry, and `deadLetter='ingest.dlq-intake'`.

**MEASURED:** DLQ intake requests partition/notify, five retries, 30-second delayed backoff, and 3,600-second expiry.

**MEASURED:** Unexpected `createQueue()` errors propagate. Existing queues remain idempotent create no-ops.

**DERIVED:** DLQ-first ordering prevents a fresh source queue from referencing a dead-letter target that does not yet exist.

## Observed queue state

| Classification | Observation |
| --- | --- |
| **MEASURED** | At audit time, all 12 queues had `partition=false`, `notify=false`, and `table_name='job_common'`. |
| **MEASURED** | Three idle snapshots showed zero queued, retry, or active jobs for every ingestion queue. |
| **MEASURED** | Retained queue rows totalled 1,500: 879 usage-rollup, 239 span, 136 error, 118 trace, 60 log, 57 request, 11 DLQ intake, and zero for the others. |
| **MEASURED** | `ingest.error` had 11 retained failed jobs; no other named ingestion queue had retained failed jobs. |
| **DERIVED** | Retained history is not backlog because pending/retry/active counts were zero. |
| **UNKNOWN** | Current queue configuration and retained counts may differ from the 2026-08-27 snapshot. |

## Worker registration order

1. **MEASURED:** Provision queues.
2. **MEASURED:** Register one `pgboss.work()` pool for each of ten SDK types with per-job results and metadata.
3. **MEASURED:** Register DLQ intake with local concurrency 2 and batch size 10.
4. **MEASURED:** Register the process-local UsageRollup worker and idempotently provision the shared schedule.
5. **MEASURED:** Start usage buffering and metrics.

## Retry-safe WorkerRegistry lifecycle

| Classification | State rule |
| --- | --- |
| **MEASURED** | Concurrent `start()` calls share one `startPromise`. |
| **MEASURED** | A queue enters `registeredQueues` before awaiting `pgboss.work()`, covering partial registration followed by rejection. |
| **MEASURED** | A queue leaves the set only after `offWork(queue, { wait: true })` succeeds. |
| **MEASURED** | Failed cleanup remains tracked. The next start retries cleanup before queue provisioning or replacement registration. |
| **MEASURED** | Startup rollback attempts every tracked queue in reverse order and retains individual failures. |
| **MEASURED** | `stop()` waits for an in-progress start, stops rollup, drains queue workers, then drains usage and metrics when fully started. |
| **MEASURED** | Focused tests cover provisioning retry, partial registration, repeated `offWork` failure, replacement blocking, and eventual success. |

**DERIVED:** Duplicate local handlers cannot be introduced by a retry while an old registration may still exist.

## UsageRollup lifecycle and shared schedule

**MEASURED:** The UsageRollup worker registration is process-local; the pg-boss schedule is shared database state.

**MEASURED:** Failed startup and process shutdown call only `offWork()` for the local rollup worker. They do not call cluster-global `unschedule()`.

**MEASURED:** A failed `offWork()` keeps `workerMayBeRegistered=true`; a retry must clean it before new worker/schedule calls.

**MEASURED:** Repeated `schedule()` calls use the same queue/key and are treated as idempotent shared provisioning.

**DERIVED:** One failed or stopping replica cannot delete the healthy fleet's rollup schedule.

## Per-job ACK, retry, and DLQ behavior

| Classification | Path | Settlement |
| --- | --- | --- |
| **MEASURED** | Successful admitted job | Completed only after `EventProcessor.process()` returns post-commit. |
| **MEASURED** | Processing exception | Failed per-job result; pg-boss retries under queue policy. |
| **MEASURED** | Every item in delivered batch fails | Registry throws, preserving whole-delivery retry semantics. |
| **MEASURED** | Validation reject | Awaited `ingest.dlq-intake` send; source fails if send fails. |
| **MEASURED** | Retries/expiry exhausted | pg-boss dead-letters original job to intake. |
| **MEASURED** | DLQ persistence failure | Intake job fails instead of acknowledging a lost dead letter. |

## Tenant fairness

| Classification | Control | Behavior |
| --- | --- | --- |
| **MEASURED** | Per-process in-flight limits | free 2, starter 4, growth 8, business 16, enterprise 24. |
| **MEASURED** | Priority | Plan weight + signal urgency + 25 per deferral. |
| **MEASURED** | Deferral | Over-budget job is copied to the same queue with delay and incremented `deferCount`; original completes only after send succeeds. |
| **MEASURED** | Starvation guard | At configured max deferrals, the job is admitted despite the current process-local limit. |
| **UNKNOWN** | Fleet-wide fairness | Limits multiply with worker-process count and are not globally coordinated. |
| **UNKNOWN** | Low-share tenant throughput | No sustained noisy-neighbor benchmark was executed. |
| **DERIVED** | Global FIFO admission risk | A high-tier/noisy tenant can still dominate the shared write-admission queue after passing process-local fairness. |

## Queue drift operations

**MEASURED:** pg-boss can update some mutable options such as notify behavior, but it cannot convert an existing non-partitioned queue to a partitioned queue in place.

**MEASURED:** `scripts/rebuild-ingest-pgboss-queues.ts` is dry-run by default, rejects unknown queues, and refuses retained jobs unless `--force-delete-jobs` is supplied.

**MEASURED:** Execute mode changes partitioning by deleting and recreating each queue. The operations are sequential and not one all-queues transaction.

**MEASURED:** The rebuild allowlist includes ten source queues and DLQ intake; it does not include usage-rollup.

**DERIVED:** `--force-delete-jobs` can delete retained work/history and is not an automatic repair mechanism.

**UNKNOWN:** No approved archive/replay plan exists for destructive queue rebuild of the measured retained rows.

### Safe default inspection

```powershell
npm run ingestion:queues:rebuild
```

Expected operator behavior:

1. Inspect only; do not add `--execute`.
2. Compare the current output with source-desired options.
3. Use a notify-only non-destructive update only after testing the exact pg-boss version and preserving all queue policy fields.
4. Treat partition conversion as a maintenance project requiring producer/worker drain, retained-job archive/replay, rollback, and explicit approval.
5. Never use `--force-delete-jobs` as an unattended startup action.

## Remaining worker risks

| Classification | Risk |
| --- | --- |
| **DERIVED** | Fairness re-enqueue produces additional primary-DB queue writes and WAL under overload. |
| **DERIVED** | PM2's configured 30-second kill timeout can be shorter than a configured 60-second SQL statement timeout, limiting graceful-drain time. |
| **UNKNOWN** | Production rate of fairness deferrals, startup cleanup failures, and DLQ replays. |
| **UNVERIFIED** | Multi-replica schedule/worker lifecycle beyond focused mocks. |

## Cooperative cancellation

| Classification | Mechanism | Behavior |
| --- | --- | --- |
| **MEASURED** | pg-boss v12.22 batch signal | The same signal is attached to all jobs in one callback batch; handler-expiry cleanup and `failWip()` abort active work. Successful callback timeout cleanup aborts only after return. |
| **MEASURED** | Registry checkpoints | Before accounting, around fairness re-enqueue, and before tenant-slot acquisition. |
| **MEASURED** | Admission checkpoints | Pre-acquire, queued-waiter listener, and post-acquire continuation; no waiter/permit leak. |
| **MEASURED** | Pool checkout | Abort race releases a late client asynchronously. |
| **MEASURED** | Active query | `pg_cancel_backend(processID)` runs from reserved pool headroom while the target client remains held through cancellation and rollback. |
| **MEASURED** | Query guard | New post-abort statements reject except `ROLLBACK`. |
| **MEASURED** | COMMIT boundary | Signal checked immediately before COMMIT; successful COMMIT race still completes inserted-only usage accounting. |
| **MEASURED** | Metrics | Stable code `INGESTION_JOB_ABORTED`, classified as `job_aborted`. |

**DERIVED:** if a fairness replacement was durably sent just before abort, an extra copy/retry can exist. Idempotency makes this preferable to false completion.

## Validation and resource bounds

| Classification | Bound | Enforcement |
| --- | --- | --- |
| **MEASURED** | Event type | One of 10 SDK types; worker validation rejection requires DLQ-intake send. |
| **MEASURED** | Receipt clock | Valid durable `metadata.receivedAt`; no retry-varying current-time fallback. |
| **MEASURED** | Normal job | 200 events, about 1 MiB serialized event data, 256 KiB/event. |
| **MEASURED** | Trace graph | Maximum 10,000 nodes, depth 128, iterative traversal, cycle/shared-reference/prototype defense. |
| **DERIVED** | Span SQL chunk | `floor(65,535 / 67) = 978` rows. |
| **MEASURED** | Transaction settings | Default lock 2s, statement 60s, idle-in-transaction 30s. |
| **DERIVED** | Write admission | `min(configured 16, pool 20 - reserve 2) = 16`; FIFO and cancellation-aware. |
| **DERIVED** | Typed delivered work | Up to 80 jobs/process under default 10 × 2 × 4 settings. |
| **MEASURED** | Gateway pressure thresholds | 1,000ms event-loop delay, 0.95 utilization, 420MiB heap, 768MiB RSS, 100k/250k queue watermarks. These are reactive, not a hard queue cap. |
| **MEASURED** | Gzip | Global `@fastify/compress` supports inbound gzip with default `globalDecompression=true`; `INGESTION_GZIP_MAX_BYTES` remains unused, so its dedicated decompressed-size limit is not proven. |

## Current validation evidence

| Classification | Evidence |
| --- | --- |
| **MEASURED** | Final cancellation/usage suite: 4 files, 37 tests passed. |
| **MEASURED** | Repository ingestion report: 13 files, 92 tests passed, 1 todo; integration/load/chaos evidence absent. |
| **MEASURED** | `npm run build` passed. |
| **MEASURED** | Lifecycle semantic review approved shared-schedule preservation. |
| **UNVERIFIED** | Multi-replica lifecycle, sustained fairness/load, PostgreSQL crash/failover, and strict memory bound. |
| **UNVERIFIED** | **BENCHMARK NOT EXECUTED.** |

## Related documents

- [Worker architecture](worker-architecture.md)
- [Worker concurrency](worker-concurrency.md)
- [Worker fairness](worker-fairness.md)
- [Worker backpressure](worker-backpressure.md)
- [Worker memory](worker-memory.md)
- [Future worker optimization](worker-future-optimization.md)

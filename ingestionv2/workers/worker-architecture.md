# Worker architecture

Status date: 2026-08-27

## Worker process model

**MEASURED:** The ingestion worker runs as a dedicated OS process (`ingestion-worker-main.ts`), separate from both the API tier and the general background worker. It is configured to run under PM2.

**MEASURED:** Horizontal scaling runs multiple copies. pg-boss assigns a live claim to a worker callback, but delivery is at-least-once: expiry/failure can redeliver, and jobs in one callback batch share an AbortSignal.

## Bootstrap sequence

| Classification | Order | Step |
| --- | --- | --- |
| **MEASURED** | 1 | Create Primary DB pool (`INGESTION_DB_POOL_SIZE=8`, application_name `pulse_ingestion_workers_${NODE_ENV}`). |
| **MEASURED** | 2 | Connect shared Log DB. If `LOG_DB_AUTO_MIGRATE=true`, call the shared runner in `automatic` mode: apply unattended-safe pending files and defer `requires-operator-drain` files without executing their SQL or recording them in the ledger. |
| **MEASURED** | 3 | Warn when operator-drained migrations remain pending, then continue startup. `LOG_DB_AUTO_MIGRATE=false` skips every startup migration. |
| **MEASURED** | 4 | Start pg-boss (its own pool). |
| **MEASURED** | 5 | Create dedicated telemetry write pool (`INGESTION_WRITE_POOL_SIZE=20`). |
| **MEASURED** | 6 | Construct `WorkerRegistry(primaryPool, logger, writePool)`. |
| **MEASURED** | 7 | `WorkerRegistry.start()`: provision queues, register workers, start rollup, processor, metrics. |
| **MEASURED** | 8 | Install SIGTERM/SIGINT handlers. |
| **MEASURED** | 9 | Send `'ready'` to PM2 (`process.send?.('ready')`). |

## Startup migration modes

| Classification | Mode | Behavior |
| --- | --- | --- |
| **MEASURED** | Worker `automatic` | A pending marked file increments `skipped` and `deferred`, emits an operator-action warning, executes no file SQL, and receives no `logdb_migrations` row. The worker can start, but the schema protection remains absent until an operator rollout. |
| **MEASURED** | CLI `operator` | `npm run db:migrate:logdb` executes selected files and leaves their own drain, duplicate, timeout, and lock safeguards authoritative. Migration 030 still raises `55000` on a populated table without the session drain assertion. |
| **MEASURED** | Disabled | `LOG_DB_AUTO_MIGRATE=false` applies nothing during worker startup and assumes all schema work is managed externally. |

**MEASURED:** production launchers run `dist/shared/workers/ingestion-worker-main.js`; source changes do not affect a running deployment until `npm run build` output is deployed and the worker is restarted/reloaded.

## WorkerRegistry internal structure

```text
WorkerRegistry
├── EventProcessor (shared, reused by all type workers)
│   ├── WriteAdmissionController (FIFO semaphore)
│   ├── TelemetryWriter
│   ├── UsageCounter (process-local buffer)
│   └── ErrorIngestion/Grouping services (errors only)
├── UsageRollup (singleton cron)
├── MetricsServer (HTTP endpoint)
├── Per-type worker handlers (10 queues)
├── DLQ intake handler (1 queue)
├── Fairness state (Map<orgId, inFlight>)
└── Registered queue tracking (Set<string>)
```

## Per-type worker registration

**MEASURED:** For each of the 10 SDK event types, `WorkerRegistry.start()` calls:
```
pgboss.work(queue, {
  localConcurrency: INGESTION_TYPE_WORKER_CONCURRENCY,  // default 2
  batchSize: INGESTION_TYPE_WORKER_BATCH_SIZE,          // default 4
  perJobResults: true,
  includeMetadata: true,
}, handler)
```

**MEASURED:** The queue is added to `registeredQueues` BEFORE awaiting `pgboss.work()`, covering partial registration followed by rejection.

**MEASURED:** pg-boss v12 array-handler semantics: handlers receive an ARRAY of jobs. Individual per-job results allow one poisoned job to fail without dragging batchmates into retry.

## DLQ intake worker

**MEASURED:** Registration: `localConcurrency=2`, `batchSize=10`, `perJobResults=true`, `includeMetadata=true`.

**MEASURED:** Handles two payload shapes:
1. `DlqIntakePayload` (has `sourceQueue` field) — worker-validation rejects routed by EventProcessor.
2. Raw `IngestJobPayload` (has original job id) — retry-exhausted jobs dead-lettered by pg-boss.

**MEASURED:** Persists to Primary DB `ingestion_dead_letter_jobs` with: originalJobId, queue, jobType, orgId, projectId, payload, attempts, lastError, errorCode, failedAt.

## UsageRollup worker

**MEASURED:** Process-local worker registration; shared pg-boss schedule is cluster-global database state.

**MEASURED:** Failed startup and process shutdown call only `offWork()` for the local rollup worker. They do NOT call cluster-global `unschedule()`.

**MEASURED:** Repeated `schedule()` calls are idempotent (same queue/key).

**DERIVED:** One failed or stopping replica cannot delete the healthy fleet's rollup schedule.

## Shutdown sequence

| Classification | Order | Step |
| --- | --- | --- |
| **MEASURED** | 1 | Wait for a racing startup attempt (`startPromise`). |
| **MEASURED** | 2 | Stop process-local usage-rollup worker (preserves shared schedule). |
| **MEASURED** | 3 | `offWork(queue, { wait: true })` for all source and DLQ workers (waits for in-flight jobs). |
| **MEASURED** | 4 | Flush/stop usage counter and metrics (if fully started). |
| **MEASURED** | 5 | Stop pg-boss and close pools (in process bootstrap). |

**DERIVED:** PM2 sends SIGTERM. The 30-second kill timeout may be shorter than a worst-case 60-second SQL statement timeout.

## Per-job processing flow

```text
pg-boss delivers batch → handleIngestBatch(queue, type, jobs)
  │
  ▼ Record metrics (retry count, queue wait, ready wait)
  │
  ▼ Promise.all over per-job wrappers
  │   └── runOne(queue, type, payload, signal)
  │       ├── throwIfIngestionAborted(signal) — pre-processing check
  │       ├── Fairness gate (process-local org budget)
  │       │   ├── Under limit → proceed to EventProcessor
  │       │   └── Over limit → durable re-enqueue with deferCount+1
  │       ├── EventProcessor.process(payload, signal)
  │       └── Return per-job completed/failed result
  │
  ▼ settle(queue, outcomes)
      ├── Mixed results → return array (pg-boss settles individually)
      └── All failed → throw first error (pg-boss retries entire batch)
```

## Startup failure and retry

| Classification | Behavior |
| --- | --- |
| **MEASURED** | Concurrent `start()` calls share one `startPromise`. |
| **MEASURED** | A prior failed start leaves `registeredQueues` populated. Next start retries cleanup before provisioning. |
| **MEASURED** | Cleanup failure at retry is a hard failure; this prevents duplicate local registrations. |
| **MEASURED** | Startup rollback attempts every tracked queue in reverse order. |
| **MEASURED** | Failed `offWork` during rollback is retained in `registeredQueues`. |
| **MEASURED** | The repository ingestion report passed 13 files/92 tests with 1 todo; the focused cancellation/usage command passed 37 tests. These totals cover more than lifecycle and are not a production benchmark. |

## Signal handling

**MEASURED:** SIGTERM and SIGINT trigger `stop()` via installed signal handlers in `IngestionWorkerProcess`; `shuttingDown` prevents re-entry.

**MEASURED:** installed pg-boss v12.22 assigns one signal to the jobs in a callback batch. Handler-expiry cleanup and `failWip()` abort active work; successful callback cleanup also aborts the now-unused signal after return.

**MEASURED:** pool error handling distinguishes expected serverless disconnects from unexpected errors.

## Related documents

- [Worker concurrency](worker-concurrency.md)
- [Worker fairness](worker-fairness.md)
- [Worker backpressure](worker-backpressure.md)
- [Worker memory](worker-memory.md)
- [Future worker optimization](worker-future-optimization.md)
- [Worker and queue lifecycle](worker-and-queue-lifecycle.md)

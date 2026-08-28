# Active ingestion system architecture

## Scope and status

**MEASURED:** This document traces repository source and checked-in artifacts as of 2026-08-27. It does not prove that the working tree is deployed.

**UNKNOWN:** Live process count, effective environment overrides, pooler topology, and deployed Git revision were not captured.

## Process topology

```text
SDK
  -> Fastify API (`src/main.ts`, `src/app.ts`)
  -> ingestion routes/controller/service
  -> zero or more Primary DB pg-boss queue rows (`ingest.<type>`)
  -> dedicated ingestion-worker process
  -> WorkerRegistry
  -> EventProcessor
  -> Log DB transaction
       BEGIN
       SET LOCAL transaction controls
       typed `events_*` write / error grouping
       `telemetry_outbox` write
       COMMIT
  -> post-commit in-memory usage buffer
  -> Primary DB UNLOGGED `usage_counter_staging`
  -> usage rollup
  -> pg-boss per-job completion
```

| Classification | Component | Source authority | Responsibility |
| --- | --- | --- | --- |
| **MEASURED** | API process | `src/modules/ingestion/routes.ts`, `controller.ts`, `service.ts` | Authentication/admission, one receipt timestamp for queued payloads, type/size chunking, conditional durable enqueue, HTTP admission response. |
| **MEASURED** | pg-boss | `src/lib/pgboss.ts`, `src/modules/ingestion/queue/ingest-queues.ts` | Durable primary-DB jobs, retries, expiry, dead-letter routing, schedules. |
| **MEASURED** | Ingestion process | `src/shared/workers/ingestion-worker-main.ts` | Dedicated control pool, Log DB connection/migration check, dedicated telemetry write pool, pg-boss workers, graceful drain. |
| **MEASURED** | Worker registry | `src/modules/ingestion/workers/worker-registry.ts` | Per-type workers, process-local fairness, DLQ intake, rollup lifecycle, metrics. |
| **MEASURED** | Event processor | `src/modules/ingestion/workers/event-processor.ts` | Stable normalization/identity, worker-validation DLQ, write admission, transaction ordering, usage/metrics. |
| **MEASURED** | Telemetry writer | `src/modules/ingestion/pipeline/telemetry-writer.ts` | Typed inserts, `ON CONFLICT DO NOTHING`, trace span flattening, transactional outbox. |

## Acceptance and acknowledgement boundaries

| Classification | Boundary | Guarantee |
| --- | --- | --- |
| **MEASURED** | HTTP 202 | Admission processing completed. Each event included in `accepted` followed an awaited `enqueueIngestJobs()` result; telemetry may not yet exist. A response can be 202 with `accepted: 0` and no pg-boss insertion when every event is rejected or shed at the gateway. |
| **MEASURED** | Gateway basic-validation/shedding reject | The error is returned synchronously in response data. No source job exists, so this reject does not enter `ingest.dlq-intake` or the worker DLQ table. |
| **MEASURED** | Worker normalization reject | `EventProcessor` awaits a send to `ingest.dlq-intake`. A failed DLQ send fails the source job instead of losing the reject. |
| **MEASURED** | Fairness deferral disposition | `WorkerRegistry` awaits the replacement queue send before completing the original job. |
| **MEASURED** | Worker completion | `EventProcessor.process()` has returned after Log DB `COMMIT`; `WorkerRegistry` then returns a completed pg-boss per-job result. |
| **MEASURED** | Failure | Exceptions become failed per-job results; an all-failed delivery batch is thrown so pg-boss retries it. |

**DERIVED:** Queue durability is guaranteed for events counted as accepted, not for an HTTP response as a whole when `accepted=0`. Worker completion and fairness replacement preserve their separate durable boundaries. HTTP admission and telemetry completion remain intentionally different milestones.

## Database and pool boundaries

| Classification | Pool/state | Construction | Purpose |
| --- | --- | --- | --- |
| **MEASURED** | Primary ingestion pool | `IngestionWorkerProcess.start()`, maximum `INGESTION_DB_POOL_SIZE` | Usage staging/rollup, DLQ persistence, primary control-plane access. |
| **MEASURED** | pg-boss pool plus notify client | `src/lib/pgboss.ts` | Queue storage/delivery and LISTEN/NOTIFY. |
| **MEASURED** | Shared Log DB primary pool | `src/config/log-database.ts`; connected by worker bootstrap | Connectivity, migrations, and shared Log DB work. |
| **MEASURED** | Dedicated telemetry write pool | `createTelemetryWritePool()`; maximum `INGESTION_WRITE_POOL_SIZE` | BEGIN-to-COMMIT typed telemetry/outbox transactions. |
| **MEASURED** | Write admission | `WriteAdmissionController`; permits resolved from the actual write pool | FIFO in-memory bound before pool checkout. |

| Classification | Capacity observation |
| --- | --- |
| **MEASURED** | A direct forensic-session query reported Log DB PostgreSQL 18.6, `max_connections=901`, `reserved_connections=0`, and `superuser_reserved_connections=6`. This value is not embedded in the checked-in artifacts and must be reverified before capacity changes. |
| **DERIVED** | Conditional usable Log DB ceiling: `901 - 0 - 6 = 895`, before provider/pooler/application headroom. It is not an authorization to consume 895 sessions. |
| **UNKNOWN** | Primary DB `max_connections` and reserved-slot values were not captured. |
| **MEASURED** | Both audited connections returned database name `neondb`; endpoint identity was not captured. |
| **UNKNOWN** | Equal database names do not prove that Primary DB and Log DB are the same physical endpoint. |
| **DERIVED** | Static default PM2 configuration yields theoretical aggregate ceilings of 97 Primary sessions and 84 Log DB sessions. These are configuration arithmetic, not observed demand, and exclude unknown overrides/auxiliary clients. |
| **MEASURED** | The idle artifact observed 11 Log DB pool connections, all idle, with zero waiters in each of three short snapshots. |

## Queue-to-table route

| Classification | Signal | Queue | Typed parent |
| --- | --- | --- | --- |
| **MEASURED** | error | `ingest.error` | `events_errors` plus error-group tables |
| **MEASURED** | message | `ingest.message` | `events_messages` |
| **MEASURED** | request | `ingest.request` | `events_requests` |
| **MEASURED** | span | `ingest.span` | `events_spans` |
| **MEASURED** | trace | `ingest.trace` | `events_traces` plus flattened `events_spans` |
| **MEASURED** | metric | `ingest.metric` | `events_metrics` |
| **MEASURED** | log | `ingest.log` | `events_logs` |
| **MEASURED** | profile | `ingest.profile` | `events_profiles` |
| **MEASURED** | cron check-in | `ingest.cron_checkin` | `events_cron_checkins` |
| **MEASURED** | replay | `ingest.replay` | `events_replays` |
| **MEASURED** | worker rejects | `ingest.dlq-intake` | Primary `ingestion_dead_letter_jobs` |
| **MEASURED** | billing rollup | `ingest.usage-rollup` | Primary usage/billing tables |

## Atomic and non-atomic domains

| Classification | Domain | Atomicity |
| --- | --- | --- |
| **MEASURED** | Typed telemetry plus `telemetry_outbox` | Same checked-out Log DB client and transaction. |
| **MEASURED** | Error grouping plus error outbox | Same Log DB transaction; domain-event publication occurs after commit. |
| **MEASURED** | Usage accounting | Runs after telemetry commit through a process-local `UsageCounter`, then inserts into Primary DB `usage_counter_staging`; rollup updates billing tables separately. |
| **MEASURED** | Usage staging storage | `UsageCounter.ensureSchema()` creates `usage_counter_staging` as `UNLOGGED`; it is not PostgreSQL crash-safe and is not replicated to a standby. |
| **DERIVED** | Process-loss window | SIGKILL/OOM/process crash after Log DB commit but before a successful staging insert can undercount because redelivery sees a typed duplicate and does not reconstruct the increment. |
| **DERIVED** | Database-loss window | PostgreSQL crash recovery/restart or failover after staging but before durable rollup can lose staged counts because the table is `UNLOGGED`. An application-process restart alone does not make successfully staged rows durable against this database failure class. |
| **UNKNOWN** | Exact billing loss probability and recovery behavior | Neither kill-point nor PostgreSQL crash/restart/failover recovery was measured. |

## Active versus legacy architecture

| Classification | Path | Status |
| --- | --- | --- |
| **MEASURED** | `src/shared/workers/ingestion-worker-main.ts` -> `WorkerRegistry` -> pg-boss `ingest.*` | Active production wiring in package/compose configuration. |
| **MEASURED** | Legacy `PgQueue`, `ingestion_jobs`, `pipeline/ingestion-job-handler.ts`, `telemetry-writer.legacy.ts` | Files remain, but no production caller was found. General workers explicitly do not poll `ingestion_jobs`. |
| **UNKNOWN** | External consumers outside this repository | Not discoverable from source. |

## Cooperative cancellation and bounds

| Classification | Mechanism | Scope |
| --- | --- | --- |
| **MEASURED** | pg-boss v12.22 callback-batch signal | Same signal on jobs in one callback batch; handler-expiry cleanup and `failWip()` abort active work; post-success cleanup abort is after return. |
| **MEASURED** | Registry/admission checkpoints | Around fairness and tenant slots; pre/queued/post admission with synchronous waiter removal. |
| **MEASURED** | Abortable checkout | A checkout delivered after cancellation is released asynchronously. |
| **MEASURED** | Backend cancellation | Reserved pool client calls `pg_cancel_backend(processID)` while target client remains held until cancel + rollback. |
| **MEASURED** | Query/COMMIT guard | Post-abort queries reject except rollback; signal checked immediately before COMMIT. |
| **MEASURED** | Write admission | Default 16 permits against a 20-client pool with two-client reserve. |
| **MEASURED** | Trace validation | 10,000 nodes, depth 128, iterative cycle/shared-reference/prototype defense. |
| **DERIVED** | Span SQL chunk | `floor(65,535 / 67) = 978` rows. |
| **MEASURED** | Transaction settings | Default lock 2s, statement 60s, idle-in-transaction 30s. |

## Current validation evidence

| Classification | Validation |
| --- | --- |
| **MEASURED** | Final cancellation/usage command passed 4 files and 37 tests. |
| **MEASURED** | Repository ingestion report passed 13 files/92 tests with 1 todo; integration/load/chaos evidence was absent. |
| **MEASURED** | `npm run build` passed. |
| **MEASURED / PARTIAL** | Deployed typed conflict behavior, transactional outbox, inserted-only billing, cancellation rollback, late-checkout release, and COMMIT-race accounting have focused coverage; scoped log retry idempotency remains unmet until migration 030 is live. |
| **MEASURED** | Global `@fastify/compress` supports request gzip through its default global decompression; `INGESTION_GZIP_MAX_BYTES` is unused, so the intended dedicated limit is not proven. |
| **UNVERIFIED** | Multi-replica failover, sustained fairness/queue drain, strict memory bound, usage restart/failover, and live migration behavior. |
| **UNVERIFIED** | **BENCHMARK NOT EXECUTED.** |

## Phase-20 expanded architecture documents

- [Overview](overview.md)
- [Current architecture](current-architecture.md)
- [Target architecture](target-architecture.md)
- [Ingestion flow](ingestion-flow.md)
- [Data flow](data-flow.md)
- [Failure flow](failure-flow.md)
- [Scaling model](scaling-model.md)

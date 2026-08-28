# Current ingestion architecture

Status date: 2026-08-27. This page describes source wiring plus recorded audit observations; it does not prove production deployment of working-tree changes.

## Process model

| Classification | Process | Role |
| --- | --- | --- |
| **MEASURED** | Fastify API | Authenticate, validate, apply reactive pressure checks, durably enqueue accepted pg-boss jobs. |
| **MEASURED** | Dedicated ingestion worker | Drain typed queues, normalize, enforce process-local fairness, write telemetry/outbox, stage usage. |
| **MEASURED** | General background worker | Other tasks; does not poll the active ingestion queues. |

**MEASURED:** default deployment configuration starts one ingestion process. Process separation prevents one Node event loop from directly hosting both HTTP admission and persistence callbacks, but the processes can still contend for host CPU/memory.

## Database topology

| Classification | Database/pool | Default max | Purpose |
| --- | --- | ---: | --- |
| **MEASURED** | Primary ingestion pool | 8 | Usage staging/rollup, DLQ persistence, control work. |
| **MEASURED** | pg-boss pool | Managed/configured separately | Queue storage, delivery, scheduling. |
| **MEASURED** | Shared Log DB pool | Shared configuration | Connectivity/migration/read-oriented shared access. |
| **MEASURED** | Dedicated Log DB write pool | 20 | Typed/error/outbox transactions and cancellation-control checkout. |

**MEASURED:** the audit observed three distinct configured endpoints with 10/10/11 idle sessions. PostgreSQL 18.6 reported `max_connections=901`, reserved 0, superuser-reserved 6 on the queried endpoint.

**DERIVED:** conditional usable slots were 895. Static default fleet ceilings were Primary 97, Log primary 84, and Log replica 60; actual peak, provider compute limits, and runtime overrides remain **UNKNOWN**.

## Active component map

| Component | Source responsibility |
| --- | --- |
| `IngestionWorkerProcess` | Bootstrap, dedicated pools, migration/connectivity check, signals, shutdown. |
| `WorkerRegistry` | Ten typed workers, DLQ intake, process-local fairness, settlement, rollup lifecycle, metrics. |
| `EventProcessor` | Retry-stable normalization, cancellation, admission, transaction, post-COMMIT usage. |
| `TelemetryWriter` | Set-based typed/error writes, trace-derived spans, transactional outbox. |
| `WriteAdmissionController` | Cancellation-aware process-wide FIFO semaphore. |
| `UsageCounter` | Process-local inserted-only aggregation and Primary staging. |
| `UsageRollup` | Process-local worker for a shared pg-boss schedule. |

## Queues and concurrency

**MEASURED:** active names comprise ten `ingest.<type>` queues, `ingest.dlq-intake`, and `ingest.usage-rollup`.

**DERIVED:** default typed delivery is up to 80 jobs/process (10 × local concurrency 2 × batch size 4); DLQ delivery can add 20. Write admission allows 16 transactions against a 20-client write pool, reserving two clients at default sizing.

**MEASURED:** all 12 audited queues used `partition=false`, `notify=false`, and shared `job_common`, while source requests partition/notify for source and DLQ queues. Rebuilding partitioned queues is destructive when retained jobs/history exist and was not performed.

## Cancellation model

- **MEASURED:** pg-boss v12.22 gives all jobs in one callback batch the same signal.
- **MEASURED:** registry checks it around fairness and tenant accounting; admission removes queued aborted waiters; checkout releases late clients.
- **MEASURED:** active PostgreSQL work is cancelled using `pg_cancel_backend(processID)` from reserved pool headroom while the target client stays held through rollback.
- **MEASURED:** post-abort statements reject except `ROLLBACK`; signal is checked immediately before COMMIT.
- **MEASURED / PARTIAL:** successful COMMIT at an expiry race still runs inserted-only usage accounting; redelivery converges where a typed unique guard is deployed. The audited log guard is absent until migration 030 is deployed.

## Transaction boundary

```text
fairness → admission → checkout → BEGIN/SET LOCAL
→ typed/error + telemetry_outbox → pre-COMMIT abort check
→ COMMIT → domain event → inserted-only usage → pg-boss completion
```

ACK, outbox atomicity, retry identity, and synchronous commit were not relaxed.

## Usage accounting

**MEASURED:** `UsageCounter` single-flights schema setup/flush, coalesces a requested trailing drain, merges failed snapshots exactly once, and makes its own `stop()` fail if the final drain fails.

**DERIVED:** post-COMMIT process crash and `UNLOGGED` staging restart/failover windows remain. `WorkerRegistry.stop()` catches/logs processor-stop failure, so supervisor-visible shutdown success is not a full billing-durability guarantee.

## Legacy code

| Classification | Component | Status |
| --- | --- | --- |
| **MEASURED** | `PgQueue`, `ingestion_jobs`, `ingestion-job-handler.ts`, `telemetry-writer.legacy.ts` | Remain in the repository; no production ingestion-worker import found. |
| **UNKNOWN** | External consumers outside this repository | Not discoverable from local source. |

## Recorded idle state

- **MEASURED:** selected ingestion queues had 1,500 retained rows, including 879 rollup, 239 span, 136 error, 118 trace, 60 log, 57 request, and 11 DLQ rows.
- **MEASURED:** no pending/retry/active selected ingestion job appeared in the short idle capture.
- **MEASURED:** `pgboss.job_common` catalog estimate was 111,176 live and 1,886 dead tuples; this is broader than the 1,500 selected rows.
- **MEASURED:** these are idle/catalog observations, not workload throughput evidence.

## Known gaps

| Classification | Gap |
| --- | --- |
| **MEASURED** | Queue option drift; no destructive rebuild authorized. |
| **MEASURED** | No hard queue capacity; queue-depth decisions are cached and high-urgency traffic may continue at critical depth. |
| **MEASURED** | API/per-tenant structural concurrency/rate limits are not active on this path. |
| **MEASURED** | Global gzip decompression support exists, but `INGESTION_GZIP_MAX_BYTES` is unused and dedicated decompressed-size enforcement is unproven. |
| **MEASURED** | Telemetry maintenance uses Primary/legacy unprefixed names rather than Log DB `events_*` topology. |
| **UNKNOWN** | Fleet-wide fairness, total worker RSS, peak sessions, and effective production overrides. |
| **UNVERIFIED** | Migration 030, partition maintenance, crash/failover, load/chaos behavior. |

# BENCHMARK NOT EXECUTED

## Related documents

- [Architecture overview](overview.md)
- [Ingestion flow](ingestion-flow.md)
- [Data flow](data-flow.md)
- [Failure flow](failure-flow.md)
- [Scaling model](scaling-model.md)
- [Target architecture](target-architecture.md)
- [System architecture](system-architecture.md)

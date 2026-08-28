# Scaling model

Status date: 2026-08-27. Static arithmetic is not throughput capacity.

## Scaling axes

| Axis | Default | Scope/constraint |
| --- | ---: | --- |
| Ingestion process count | 1 configured | Each process adds queue callbacks, local fairness state, pools, and UsageCounter state. |
| Typed local concurrency | 2/type | Ten independent typed queue registrations per process. |
| Typed callback batch size | 4 jobs | Multiplies delivered/fetched jobs, memory, and callback wall time; not SQL row batch size. |
| Log DB write permits | 16 | Process-local FIFO gate. |
| Log DB write pool | 20 | Physical-client ceiling; default reserve 2 protects cancellation/control checkout. |
| Primary ingestion pool | 8 | Usage/DLQ/control access per ingestion process. |

## Per-process arithmetic

```text
typed delivered jobs <= 10 × 2 × 4 = 80
DLQ delivered jobs <= 2 × 10 = 20
concurrent typed DB transactions <= min(16, 20 - 2) = 16
typed admission waiters <= 80 - active pre-admission/transaction work
```

**DERIVED:** under full default typed delivery, up to 64 jobs can wait after 16 acquire permits. The durable pg-boss backlog has no hard capacity, but the process does not materialize that entire backlog as admission waiters.

**MEASURED / PARTIAL:** pg-boss delivery is at-least-once. A callback batch shares one abort signal; expiry/retry races can overlap attempts. Deployed typed unique guards plus outbox reservation—not an exactly-once worker claim—provide duplicate safety. The intended scoped log guard in migration 030 is not deployed.

## Fleet connection arithmetic

| Classification | Recorded/derived value |
| --- | --- |
| **MEASURED** | PostgreSQL 18.6 endpoint reported `max_connections=901`, reserved 0, superuser-reserved 6. |
| **DERIVED** | Conditional usable slots: 895 before provider/operational headroom. |
| **DERIVED** | Static default fleet ceilings: Primary 97; Log primary 84; Log replica 60. |
| **MEASURED** | Idle audit observed 10/10/11 sessions across the three configured endpoints. |
| **UNKNOWN** | Peak sessions, provider compute size, CPU, and effective production overrides. |

Adding `R` ingestion replicas contributes approximately `R × 8` Primary ingestion-pool capacity, `R × 20` dedicated write-pool capacity, plus each replica's pg-boss/shared clients. No replica increase is authorized from static math alone.

## Memory scaling

**MEASURED:** normal source jobs are capped at 200 events, about 1 MiB serialized event data, and 256 KiB/event.

**DERIVED:** typed raw-payload envelope is about 80 MiB/process; DLQ can add roughly 20 MiB on the normal shape, before normalized copies, trace clones, SQL arrays/strings, metadata, and V8 overhead.

**MEASURED/DERIVED:** trace-derived spans each store the full parent trace payload, creating O(S²) total copied payload as span count grows. Narrowing payload is deferred because analytics searches span payload text.

**DERIVED:** UsageCounter distinct-key cardinality can exceed its 10,000-entry flush threshold during prolonged staging failure. Total RSS and a strict failure-mode bound are **UNKNOWN**.

## Fairness scaling

| Classification | Property |
| --- | --- |
| **MEASURED** | Per-process organization limits: free 2, starter 4, growth 8, business 16, enterprise 24. |
| **MEASURED** | Defers up to five times for two seconds, with priority aging; then admits to avoid starvation. |
| **DERIVED** | With `R` replicas, a tenant can consume approximately `R × local limit`; no fleet coordinator or pg-boss `groupConcurrency` is configured. |
| **DERIVED** | Each deferral creates another Primary pg-boss write before original completion. |
| **UNKNOWN** | Deferral rate and low-share tenant throughput under real load. |

## Backpressure and queue scaling

- **MEASURED:** queue depth is cached/refreshed at about three seconds.
- **MEASURED:** 100k/250k watermarks trigger urgency-aware shedding; high-urgency traffic may continue at critical depth.
- **MEASURED:** there is no hard queue capacity or structurally applied `API_MAX_CONCURRENCY`/per-tenant rate limiter.
- **MEASURED:** audited queues used shared unpartitioned `job_common` with notify disabled despite source requesting partition/notify.
- **DERIVED:** queue-history growth and polling can increase work, but production throughput impact is unmeasured. A queue rebuild risks retained jobs and is not authorized.

## Source-derived SQL scaling

| Path | Classification | Scaling |
| --- | --- | --- |
| Generic non-error typed batch | **DERIVED** | One set-based typed insert plus transaction/outbox constants. |
| Trace-derived spans | **DERIVED** | `ceil(S/978)` span INSERT statements, plus trace/outbox transaction work. |
| Error normal branches | **DERIVED** | Bounded roughly 7–12 queries depending branch. |
| Error merged-group fallback | **DERIVED** | Approximately `3N + constants/merge-chain hops`; remaining O(N) statement path. |
| Non-error partial duplicates | **DERIVED** | Full scoped list reaches outbox reservation if at least one typed row inserts. |
| All-duplicate non-error batch | **MEASURED** | Skips outbox and inserted-only usage. |

## Database/topology scaling defects

- **MEASURED:** only default partitions existed in the recorded topology and they contained data.
- **MEASURED:** telemetry maintenance uses Primary DB and legacy unprefixed names, not active Log DB `events_*` tables.
- **MEASURED:** six exact index pairs exist, but no bounded usage window or write-cost benchmark authorizes removal.
- **UNVERIFIED:** migration 030 and live partition maintenance were not executed.

## Authorization gates

Before changing process count, queue partitioning, event isolation, batch size, concurrency, pools, or fairness:

1. use an isolated production-like database;
2. run repeated baseline/candidate workloads through the real worker path;
3. record tenant share, queue drain, retries, and cancellations;
4. capture process CPU/RSS/heap/GC and DB CPU/backends/locks/WAL;
5. prove ACK/idempotency/outbox/billing invariants;
6. define rollback and connection-budget headroom.

# BENCHMARK NOT EXECUTED

## Related documents

- [Architecture overview](overview.md)
- [Current architecture](current-architecture.md)
- [Target architecture](target-architecture.md)
- [Worker concurrency](../workers/worker-concurrency.md)
- [Capacity model](../performance/capacity-model.md)
- [Scaling roadmap](../roadmap/scaling-roadmap.md)

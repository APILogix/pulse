# Capacity model

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

This model describes configured ceilings and source-derived scaling only. It does not provide events/second, saturation, autoscaling, or safe-resize values.

## Per-process configured envelope

| Resource | Default | Classification |
| --- | ---: | --- |
| Typed delivered jobs | 10 × 2 callbacks × 4 jobs = 80 | **DERIVED** |
| DLQ delivered jobs | 2 callbacks × 10 jobs = 20 | **DERIVED** |
| Log DB write permits | min(16, 20 − 2) = 16 | **DERIVED** |
| Dedicated Log DB clients | 20 | **MEASURED** |
| Primary ingestion clients | 8 | **MEASURED** |
| Normal source job | 200 events, ~1 MiB serialized event data, 256 KiB/event | **MEASURED** |

**DERIVED:** typed raw-payload envelope is approximately 80 MiB/process and normal DLQ shape can add approximately 20 MiB, before object/copy/trace/SQL/V8 overhead. Total RSS is **UNKNOWN**.

## Fleet connection envelope

| Classification | Value |
| --- | --- |
| **MEASURED** | Queried PostgreSQL 18.6 endpoint: max 901, reserved 0, superuser-reserved 6. |
| **DERIVED** | Conditional usable slots: 895 before provider/operational headroom. |
| **DERIVED** | Static default fleet ceilings: Primary 97, Log primary 84, Log replica 60. |
| **MEASURED** | Idle observed sessions across configured endpoints: 10/10/11. |
| **UNKNOWN** | Peak, compute/pooler limits, endpoint mapping, and production overrides. |

## SQL/payload scaling

| Path | Classification | Scaling |
| --- | --- | --- |
| Generic typed batch | **DERIVED** | One set-based typed insert plus constant transaction/outbox branch work. |
| Trace span INSERTs | **DERIVED** | `ceil(S/978)` for `S` derived spans. |
| Trace payload bytes | **DERIVED** | O(S²) total copied payload because every derived span stores full parent trace. |
| Error normal path | **DERIVED** | Roughly 7–12 queries depending branch. |
| Error merged fallback | **DERIVED** | Approximately `3N + constants/merge hops`. |
| Partial duplicates | **DERIVED** | Full scoped list reaches outbox reservation if any non-error typed row inserts. |
| All duplicates | **MEASURED** | Outbox and usage skipped for non-error batch. |

Trace payload narrowing is deferred because analytics search relies on span payload text.

## Queue/fairness capacity

- queue watermarks: 100k high/250k critical, read from a roughly three-second cache;
- high-urgency traffic can continue at critical depth;
- no hard pg-boss queue capacity;
- no active structural `API_MAX_CONCURRENCY` or per-tenant ingestion rate limiter;
- fairness limits are process-local and multiply with replicas;
- fairness copies add Primary queue writes.

Therefore backlog/fairness capacity cannot be derived from the 16 write permits alone.

## Timeout envelope

| Control | Default | Scope |
| --- | ---: | --- |
| Lock timeout | 2 s | Each lock acquisition. |
| Statement timeout | 60 s | Each transaction statement. |
| Idle-in-transaction | 30 s | Idle interval in transaction. |
| pg-boss handler expiry | 300 s | Callback race. |
| Source retries/base delay | 3 / 5 s exponential | Attempt policy. |
| Usage flush interval | 30 s | Trigger interval, not a durability bound. |
| PM2 kill window | 30 s recorded configuration | Shutdown grace. |

Cancellation now actively cancels an in-flight backend where possible, but failure falls back to statement timeout. Total job wall time can exceed one statement timeout.

## Failure-mode bounds

| Classification | Component | Status |
| --- | --- | --- |
| **DERIVED** | Admission waiter count | Delivery-bounded (up to ~64 at defaults), not durable-backlog-sized. |
| **MEASURED** | Pool clients/transactions | Config bounded. |
| **MEASURED** | Trace node/depth | 10,000 / 128. |
| **DERIVED** | UsageCounter distinct-key map | Can exceed 10,000 threshold during prolonged DB failure. |
| **UNKNOWN** | Total RSS and GC under worst-case mixed/trace traffic | Not measured. |
| **UNKNOWN** | Sustainable queue drain and recovery time | Not measured. |

## Acceptance status

| Gate | Status |
| --- | --- |
| Static concurrency/connection arithmetic | **MET (DERIVED)** |
| Normal raw-payload envelope | **MET (DERIVED)** |
| Strict worst-case memory bound | **UNMET** |
| Single-replica throughput ceiling | **UNMET** |
| Saturation resource | **UNMET** |
| Multi-replica scaling/fairness | **UNMET** |
| Safe pool/concurrency increase | **NOT AUTHORIZED** |

## Related documents

- [Baseline](baseline.md)
- [Benchmark methodology](benchmark-methodology.md)
- [Worker memory](../workers/worker-memory.md)
- [Connection pools](../database/connection-pools.md)

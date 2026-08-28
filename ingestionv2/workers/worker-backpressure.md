# Worker backpressure

Status date: 2026-08-27. Backpressure is layered and reactive; it is not a hard end-to-end capacity guarantee.

## Layer map

```text
HTTP request
  → Fastify body/resource pressure checks
  → cached pg-boss queue-depth classification
  → per-event urgency shedding
  → durable enqueue
  → fixed pg-boss delivery envelope
  → process-local tenant fairness
  → 16-permit FIFO write admission
  → 20-client dedicated write pool
```

## Gateway controls

| Classification | Control | Recorded default/behavior |
| --- | --- | --- |
| **MEASURED** | Fastify body limit | 10 MiB request body. |
| **MEASURED** | Per-event limit | 256 KiB. |
| **MEASURED** | Job chunk | 200 events and about 1 MiB serialized event data. |
| **MEASURED** | Event-loop threshold | 1,000 ms. |
| **MEASURED** | Utilization threshold | 0.95. |
| **MEASURED** | Heap/RSS thresholds | 420 MiB / 768 MiB. |
| **MEASURED** | Queue high/critical water | 100,000 / 250,000. |
| **MEASURED** | Queue-depth cache | Background refreshed; up to roughly three seconds stale. |

**MEASURED:** shedding is urgency-aware. High-urgency business/enterprise traffic can continue at critical queue depth, so the thresholds do not form a hard queue capacity.

**MEASURED:** no queue row is created for a shed event; it remains synchronous gateway response data rather than a worker-DLQ record.

## Missing structural ingress bounds

- **MEASURED:** no hard pg-boss queue-capacity check prevents the database queue from continuing to grow.
- **MEASURED:** `IngestionRateLimiter` and organization/project rate settings are not instantiated on the active path.
- **MEASURED:** `API_MAX_CONCURRENCY` is not applied to ingestion requests.
- **DERIVED:** gateway body/resource checks and queue-depth shedding are reactive controls, not strict per-tenant enqueue or request-concurrency bounds.
- **UNKNOWN:** effective upstream load-balancer/proxy concurrency limits.

## Worker delivery and admission

**DERIVED:** default typed delivery is bounded at 80 jobs/process (10 × 2 × 4). Of those, at most 16 hold write permits and up to 64 can wait in the in-process FIFO admission queue. The database-backed pg-boss backlog can grow without a hard cap; the admission waiter queue cannot exceed currently delivered typed work under this path.

**MEASURED:** admission has no timeout. Once accepted work is durably queued, timing out solely because permits are busy would convert pressure into retries and additional queue/database work.

**MEASURED:** `writeAdmissionWaitMs` distinguishes permit pressure from `dbConnectionWaitMs` after admission:

| Signal | Interpretation |
| --- | --- |
| High admission wait, low checkout wait | Demand exceeds configured transaction permits; does not by itself prove pool failure. |
| High checkout wait after admission | Investigate pool users, cancellation/control checkout, provider connection behavior, and database saturation. |
| Growing durable queue | Enqueue rate exceeds drain rate; admission tuning alone may not help. |

## Cancellation as pressure release

- **MEASURED:** handler expiry reaches fairness, admission, checkout, and transaction checkpoints through the pg-boss signal.
- **MEASURED:** queued aborted waiters are removed immediately; they do not consume a future permit.
- **MEASURED:** late post-abort checkout is released.
- **MEASURED:** active statements are cancelled through a reserved connection while the target client remains held through rollback.
- **DERIVED:** this bounds how long known-expired work continues consuming local/DB capacity, subject to cancellation-query success and statement timeout fallback.

## Fairness interaction

**MEASURED:** process-local per-organization fairness runs before write admission. A deferred job is durably copied before the original completes.

**DERIVED:** fairness deferral itself adds a pg-boss write and Primary WAL. After the starvation cap, a noisy tenant is admitted even if above its plan limit. Fleet-wide fairness is **UNKNOWN** because limits multiply with process count.

## Failure behavior under pressure

| Classification | Condition | Behavior |
| --- | --- | --- |
| **MEASURED** | Gateway sheds | No source job; response records rejection. |
| **MEASURED** | Replacement fairness enqueue fails | Original job fails for retry; work is not falsely acknowledged. |
| **MEASURED** | Admission wait aborted | Waiter removed; job fails as `job_aborted`. |
| **MEASURED** | Active query abort | Cancel, rollback, release, retry. |
| **MEASURED / PARTIAL** | COMMIT succeeds at expiry boundary | Complete inserted-only usage accounting; redelivery deduplicates where a typed unique guard is deployed. The current log guard remains absent. |
| **UNKNOWN** | Sustained overload behavior | No load/chaos benchmark was run. |

## Operational gates

Do not raise queue, worker, admission, or pool limits independently. Require a repeated isolated workload with queue drain, tenant shares, admission/checkout waits, database CPU/backends, process memory, WAL, retry/cancel rates, and error rates.

# BENCHMARK NOT EXECUTED

## Related documents

- [Worker concurrency](worker-concurrency.md)
- [Worker fairness](worker-fairness.md)
- [Worker memory](worker-memory.md)
- [Worker lifecycle](worker-and-queue-lifecycle.md)
- [Capacity model](../performance/capacity-model.md)
- [Operations monitoring](../operations/monitoring.md)

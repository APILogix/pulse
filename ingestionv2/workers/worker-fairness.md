# Worker fairness

Status date: 2026-08-27

## Fairness model

**MEASURED:** The ingestion worker implements process-local tenant fairness. It limits how many jobs from a single organization may be processed concurrently within one worker process.

## Per-process in-flight limits by plan tier

| Classification | Plan tier | Concurrent in-flight jobs per org |
| --- | --- | --- |
| **MEASURED** | free | 2 |
| **MEASURED** | starter | 4 |
| **MEASURED** | growth | 8 |
| **MEASURED** | business | 16 |
| **MEASURED** | enterprise | 24 |

**MEASURED:** Plan tier is resolved by `normalizePlanTier()` from the job payload metadata.

## Priority calculation

**MEASURED:** Job priority is calculated by `jobPriority()`:
- Plan weight (higher tier = higher priority).
- Signal urgency component.
- `+25` per deferral count (age boost / starvation guard).

## Deferral mechanism

```text
Job arrives at fairness gate
  │
  ▼ Check: org in-flight count >= TENANT_INFLIGHT_LIMIT[planTier]?
  │
  ├── NO → Increment in-flight, proceed to EventProcessor
  │         └── Decrement in-flight in `finally`
  │
  └── YES → Check: deferCount >= INGESTION_FAIRNESS_MAX_DEFERS?
             │
             ├── YES (starvation guard) → Admit despite limit
             │
             └── NO → Durable re-enqueue:
                       ├── Copy payload with metadata.deferCount + 1
                       ├── Delay: INGESTION_FAIRNESS_DEFER_DELAY_SECONDS (default 2s)
                       ├── Priority: boosted by +25 per deferral
                       ├── AWAIT the replacement send (must succeed)
                       │   ├── Send succeeds → original job completes (no processing)
                       │   └── Send fails → original job fails (pg-boss retries)
                       └── Nothing is lost: the copy carries the work forward
```

## Configuration

| Classification | Variable | Default | Range |
| --- | --- | --- | --- |
| **MEASURED** | `INGESTION_FAIRNESS_MAX_DEFERS` | 5 | 0–20 |
| **MEASURED** | `INGESTION_FAIRNESS_DEFER_DELAY_SECONDS` | 2 | 1–60 |

## Deferral durability contract

| Classification | Invariant |
| --- | --- |
| **MEASURED** | Original job completes ONLY AFTER the replacement queue send succeeds. |
| **MEASURED** | A failed replacement send fails the original job (exception propagates, pg-boss retries the original). |
| **DERIVED** | No work is lost by deferral: either the replacement is durably queued, or the original enters retry. |

## State management

**MEASURED:** `this.inFlight = new Map<string, number>()` — maps organization ID to current in-flight count.

**MEASURED:** The in-flight counter is incremented before processing and decremented in `finally`, ensuring correct bookkeeping regardless of success or failure.

## Scope limitations

| Classification | Limitation |
| --- | --- |
| **DERIVED** | Limits are per-process, not fleet-wide. With N worker processes, an org can have up to `N × limit` jobs in flight globally. |
| **DERIVED** | Fairness operates BEFORE write admission. An admitted job still competes in the shared FIFO write-admission queue. A high-tier/noisy tenant can dominate after passing per-process fairness. |
| **DERIVED** | Deferral produces additional Primary DB queue writes (job send) and WAL under overload. |
| **UNKNOWN** | Production rate of fairness deferrals. |
| **UNKNOWN** | Sustained noisy-neighbor throughput impact (no benchmark executed). |

## Interaction with cancellation

**MEASURED:** `runOne()` checks cancellation before worker accounting, before and after fairness re-enqueue, and before taking a tenant slot.

**MEASURED:** pg-boss send itself is not signal-cancellable. If abort occurs while a replacement is being sent, the send can finish; the post-send check then fails the original attempt.

**DERIVED / PARTIAL:** this race can leave a durable fairness copy and also cause an original-job retry, producing extra copies/work. That is safer than falsely completing work whose replacement durability is unknown. Outbox reservation and deployed typed unique guards protect convergence; the current log path remains an exception until migration 030 is live.

## Interaction with write admission

Fairness remains before write admission:

1. abort checkpoint;
2. process-local fairness decision;
3. durable replacement or tenant-slot acquisition;
4. `EventProcessor.process()`;
5. cancellation-aware FIFO admission and DB transaction.

A normally deferred job does not reach write admission. An admitted job releases its tenant count in `finally`.

## Observability and limits

**MEASURED:** general worker metrics capture queue/type processing, retries, and failure classes including `job_aborted`.

**UNKNOWN:** no dedicated fleet-wide fairness coordinator or validated per-tenant deferral-rate SLO exists. pg-boss `groupConcurrency` is not configured, so per-process limits multiply with process count.

# BENCHMARK NOT EXECUTED

## Related documents

- [Worker architecture](worker-architecture.md)
- [Worker concurrency](worker-concurrency.md)
- [Worker backpressure](worker-backpressure.md)
- [Future worker optimization](worker-future-optimization.md)
- [Scaling model](../architecture/scaling-model.md)

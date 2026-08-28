# Scaling roadmap

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

No process, pool, concurrency, queue partition, or database-topology scaling change is authorized.

## S0 — Current safe state

- default one ingestion process;
- up to 80 typed and 20 DLQ delivered jobs/process;
- 16 write permits against a 20-client dedicated pool;
- process-local fairness;
- at-least-once pg-boss delivery with deployed typed conflict guards and outbox reservation; scoped log retry idempotency remains unmet until migration 030 is live;
- active expiry cancellation and rollback;
- inserted-only but not crash-safe post-COMMIT usage.

Keep these defaults until a safe workload shows a constraint.

## S1 — Establish capacity evidence

**Required outputs:**

1. isolated production-like Primary/Log databases;
2. real pg-boss/WorkerRegistry path, not only direct writer calls;
3. representative signal, payload, duplicate, tenant, retry, and trace distributions;
4. repeated steady-state and burst runs;
5. synchronized queue, admission, checkout, DB CPU/backends/locks/WAL/IO, process CPU/RSS/heap/GC, cancellation, and fairness data;
6. crash/failover usage-accounting scenarios; and
7. clean baseline/candidate provenance.

Exit gate: identify the first saturated resource and a statistically repeatable single-process ceiling without violating correctness.

## S2 — Correct non-scaling blockers

Before adding replicas:

- design durable/replayable inserted-only usage accounting;
- resolve maintenance pool/table mismatch and default-partition data through clone rehearsal;
- define hard queue/API/tenant protection only from recovery evidence;
- define trace payload/search compatibility if O(S²) cost is material;
- measure merged error-group and duplicate-outbox frequencies; and
- reconcile broad test failures/no-new-failures gate.

Scaling a correctness/durability defect multiplies its impact.

## S3 — Vertical tuning

Test one variable at a time: callback concurrency, callback batch size, write permits, then pool size. A candidate must preserve queue recovery, tenant share, memory, backend/CPU headroom, retry/cancel rates, and latency/WAL gates.

Never raise pool and concurrency together without a design that allows attribution. Reserved cancellation headroom must remain.

## S4 — Horizontal workers

Prerequisites:

- S1/S2 complete;
- real fleet endpoint/connection budget;
- multi-replica process-local fairness behavior measured;
- usage rollup and accounting behavior proven across replica stop/crash;
- queue fetch/history overhead acceptable; and
- deployment rollback tested.

Static formula for `R` replicas:

```text
typed delivered jobs <= R × 80 (defaults)
write transactions <= R × 16
write clients <= R × 20
Primary ingestion clients <= R × 8
```

This is an upper envelope, not throughput prediction.

## S5 — Queue/database topology evolution

Consider queue partitioning, event-type isolation, dated telemetry partitions, archival, replica routing, or sharding only when S4 evidence shows the current topology—not application code or DB CPU—is the limiter.

Every schema/queue change needs retained-job/data handling, lock analysis, forward/down SQL, verification, and failure recovery. Existing default partitions contain data and queue history is retained; blind conversion is unsafe.

## Preserved gates at every phase

- ACK only after durable COMMIT;
- retry/redelivery safety and stable identity;
- inserted-only billing and explicit recovery;
- typed/outbox atomicity;
- process/fleet fairness evidence;
- public-ID defaults/sequences/triggers;
- bounded resource model and connection headroom;
- backward-compatible payload/search behavior; and
- no fabricated performance claim.

## Current acceptance

| Gate | Status |
| --- | --- |
| Static envelope documented | **MET** |
| Single-replica workload ceiling | **UNMET** |
| Saturation resource identified | **UNMET** |
| Crash-safe billing | **UNMET** |
| Multi-replica fairness/interference | **UNMET** |
| Live maintenance/partition correction | **UNMET** |
| Scaling change authorized | **NO** |

## Related documents

- [Future optimization](future-optimization.md)
- [Remaining bottlenecks](remaining-bottlenecks.md)
- [Capacity model](../performance/capacity-model.md)
- [Worker concurrency](../workers/worker-concurrency.md)

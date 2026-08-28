# Evidence-driven ingestion roadmap

Status date: 2026-08-27.

## Current verdict

- P0 cooperative cancellation and UsageCounter flush/shutdown correctness are implemented in the working tree.
- Focused cancellation/usage suite: 37 passed.
- Repository ingestion report: 92 passed, 1 todo; integration/load/chaos evidence absent.
- Production build passed.
- Broad no-new-failures gate is unmet (four new outside-ingestion failing files amid concurrent unrelated edits; causality not isolated).
- **BENCHMARK NOT EXECUTED**; no performance claim.

## Completed, evidence-backed

| Classification | Item |
| --- | --- |
| **MEASURED** | pg-boss callback-batch signal reaches registry, fairness, admission, checkout, transaction queries, and pre-COMMIT boundary. |
| **MEASURED** | queued admission abort removal, permit-race release, and late-checkout release. |
| **MEASURED** | active backend cancellation with held target client, rollback, and stable failure class. |
| **MEASURED** | successful-COMMIT expiry race completes inserted-only accounting. |
| **MEASURED** | UsageCounter authoritative single-flight, trailing drain, exact failure merge, honest final drain. |
| **MEASURED** | retry-stable time/identity, trace bounds, bind-safe chunking, worker lifecycle, and shared migration lock preserved. |

## Immediate blockers (do not tune around them)

1. **Billing durability:** process and UNLOGGED restart/failover windows.
2. **Safe performance target:** no isolated database or executed workload.
3. **Strict memory evidence:** total RSS/trace peak/failure-cardinality unmeasured.
4. **Maintenance topology:** Primary/legacy names do not manage Log DB `events_*`; defaults contain data.
5. **Broad regression gate:** concurrent dirty-tree failures prevent clean repository acceptance.

## Next evidence sequence

### R1 — Stabilize correctness acceptance

- resolve or isolate four new broad failures without overwriting unrelated user edits;
- add integration tests for PostgreSQL cancellation/rollback and process stop behavior;
- add kill/restart/failover usage tests after a durable accounting design;
- retain ACK, idempotency, outbox, fairness, public-ID, and inserted-only billing assertions.

### R2 — Provision isolated benchmark environment

Require non-production Primary/Log endpoints, representative schema/data, cleanup, provider topology, and permission to generate writes/WAL/sequences/statistics/dead tuples.

### R3 — Execute reproducible baseline

Run the real WorkerRegistry/pg-boss path with signal/payload/tenant/duplicate/trace mixes. Capture CPU, RSS/heap/GC, DB backends/locks/WAL/IO, admission/checkout waits, queue drain, retries/cancels, fairness, outbox, and usage.

### R4 — Evaluate measured candidates

1. trace O(S²) parent-payload replication—only with explicit search/API contract;
2. merged error-group O(N) branch;
3. partial-duplicate outbox filtering;
4. hard queue/API/tenant controls;
5. maintenance topology/partitions;
6. duplicate indexes under complete A–F classification.

### R5 — Candidate comparison and rollout

At least three valid baseline/candidate repetitions, regression limits across every protected metric, rollback, and independent review. Schema changes require exact SQL, locks, preconditions, verification, and recovery.

## Explicit deferrals

| Classification | Item | Reason |
| --- | --- | --- |
| **DEFERRED** | Current-span-only trace payload | Analytics searches span payload text; compatibility contract absent. |
| **DEFERRED** | Pool/concurrency increase | No sustained workload/resource evidence. |
| **DEFERRED** | Six duplicate-index removals | `statsResetAt` null; no bounded use/write-cost evidence. |
| **DEFERRED** | Queue partition conversion | Retained rows/history and destructive rebuild risk. |
| **UNVERIFIED** | Migration 030 | Working-tree SQL only; not live/rehearsed. |
| **UNVERIFIED** | Partition maintenance correction | No clone/live execution. |

## Acceptance status

| Criterion | Status |
| --- | --- |
| Scoped P0 correctness | **MET** |
| Build | **MET** |
| Repository-wide no-new-failures | **UNMET** |
| Crash-safe billing | **UNMET** |
| Strict worst-case memory | **UNMET** |
| Full index A–F classification | **UNMET** |
| Live migration/maintenance | **UNMET** |
| Before/after improvement | **UNMET — BENCHMARK NOT EXECUTED** |
| Deployment confirmed | **UNKNOWN** |

## Related documents

- [Completed optimizations](completed-optimizations.md)
- [Remaining bottlenecks](remaining-bottlenecks.md)
- [Future optimization](future-optimization.md)
- [Scaling roadmap](scaling-roadmap.md)
- [Forensic report](../performance/forensic-report.md)

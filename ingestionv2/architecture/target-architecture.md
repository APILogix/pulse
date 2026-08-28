# Target ingestion architecture

Status date: 2026-08-27

## Guiding constraint

**DERIVED:** This document describes evidence-gated improvements. No item may be implemented until its stated prerequisites are satisfied. Items here are architectural directions, not performance promises.

## Resolved queue option drift

| Classification | Current state | Target state | Prerequisite |
| --- | --- | --- | --- |
| **MEASURED** | All queues: `partition=false`, `notify=false`. | Source-desired: `partition=true`, `notify=true` for source and DLQ queues. | Drain plan, retained-job archive/replay, tested pg-boss version compatibility. |

**MEASURED:** `scripts/rebuild-ingest-pgboss-queues.ts` exists (dry-run default, allowlist gated) but partition conversion is destructive (delete + recreate).

**DERIVED:** Queue drift resolution requires a maintenance project, not an automated startup action:
1. Producer/worker drain.
2. Retained-job archive or replay plan.
3. Execute rebuild with explicit approval.
4. Verify partition pruning and NOTIFY delivery.

## Bounded gzip/decompressed-size contract

| Classification | Current state | Target state | Prerequisite |
| --- | --- | --- | --- |
| **MEASURED** | Global `@fastify/compress` supports inbound gzip through default `globalDecompression=true`; `INGESTION_GZIP_MAX_BYTES=20MB` is declared but unused. | One tested, documented decompressed-size limit enforced at the actual request-decompression boundary. | End-to-end compressed request tests through framework/proxy deployment and explicit oversized-output rejection. |

**UNKNOWN:** effective maximum decompressed body across all deployment layers. Gzip acceptance is present; the dedicated zip-bomb/expanded-size bound is not proven.

## Trace payload contract before optimization

| Classification | Current state | Target state | Prerequisite |
| --- | --- | --- | --- |
| **MEASURED/DERIVED** | Every derived span stores the complete parent trace payload, causing O(S²) structural copying; analytics searches span payload text. | Versioned/feature-gated payload representation with explicit search semantics. | Product/API compatibility decision plus isolated storage/WAL/search benchmark. |

**DEFERRED:** do not replace parent payload with current-span-only data silently.

## Time-partitioned Log DB tables

| Classification | Current state | Target state | Prerequisite |
| --- | --- | --- | --- |
| **MEASURED** | All typed parents range-partitioned by `occurred_at`; only `_default` child partitions exist. | Bounded dated leaf partitions with automated creation/detach/archive. | Workload evidence for partition interval, retention policy, operator tooling. |

**DERIVED:** Without bounded leaves, the default partition grows indefinitely and cannot be individually archived, detached, or dropped for retention management.

## Durable usage accounting

| Classification | Current state | Target state | Prerequisite |
| --- | --- | --- | --- |
| **MEASURED** | Post-commit in-memory buffer → `UNLOGGED` `usage_counter_staging` → rollup. | Logged accounting table or transactional insert tied to the telemetry commit. | Measurement of actual loss rate across process crashes and PostgreSQL failover. |

**DERIVED:** Two loss windows exist:
1. Process crash after Log DB commit but before successful staging insert.
2. PostgreSQL crash/restart/failover after staging but before durable rollup (UNLOGGED table is not crash-safe).

## Fleet-wide fairness coordination

| Classification | Current state | Target state | Prerequisite |
| --- | --- | --- | --- |
| **MEASURED** | Per-process in-flight limits: free=2, starter=4, growth=8, business=16, enterprise=24. | Global coordination across worker processes. | Evidence of actual noisy-neighbor throughput impact; tenant traffic distribution data. |

**UNKNOWN:** Production rate of fairness deferrals.

**DERIVED:** Current per-process limits multiply with worker-process count and are not globally coordinated. A high-tier tenant can still dominate the shared write-admission queue after passing process-local fairness.

## Write-path optimization candidates

| Classification | Candidate | Prerequisite |
| --- | --- | --- |
| **DERIVED** | Error merged-group fallback is `O(N)` SQL; batch or materialized-view approach could reduce it. | Executed benchmark proving this is the bottleneck. |
| **DERIVED** | Non-error partial-duplicate batches still pass the complete scoped list to outbox reservation, causing write amplification. | Measurement of actual duplicate frequency. |
| **DERIVED** | Fairness re-enqueue produces additional Primary DB queue writes under overload. | Measurement of re-enqueue rate and WAL impact. |

## Multi-process/multi-node resilience

| Classification | Improvement | Prerequisite |
| --- | --- | --- |
| **UNVERIFIED** | Multi-replica failover: one replica's crash/stop does not affect the fleet. | Integration test with actual multi-process lifecycle. |
| **UNVERIFIED** | Usage-rollup schedule preservation across replica restarts. | Live multi-replica exercise (currently only focused mocks). |
| **DERIVED** | PM2 kill timeout (30s) vs. SQL statement timeout (60s) alignment. | Operator review and configuration reconciliation. |

## Evidence gates

No target-state item may be promoted to implementation without:

1. **MEASURED** evidence of the problem (not just DERIVED risk).
2. A safe isolated test environment (not production-labelled connections).
3. Before/after comparison with committed benchmark results.
4. Rollback plan for the specific change.
5. Operator approval for any destructive or state-altering operation.

## Items NOT in scope

| Classification | Exclusion | Reason |
| --- | --- | --- |
| **MEASURED** | Redis introduction | Architecture constraint: auth and control-plane must remain Redis-free. |
| **MEASURED** | Additional index removal | `statsResetAt` unknown; no adequate observation window. 24 prior-phase removals are historical, not new authorization. |
| **MEASURED** | Automatic queue rebuild | Retained jobs make partition-changing rebuild destructive. |
| **MEASURED** | Telemetry deletion | No telemetry was automatically deleted; safety boundary is preserved. |



## Related documents

- [Architecture overview](overview.md)
- [Current architecture](current-architecture.md)
- [Ingestion flow](ingestion-flow.md)
- [Data flow](data-flow.md)
- [Failure flow](failure-flow.md)
- [Scaling model](scaling-model.md)
- [Future optimization](../roadmap/future-optimization.md)


## Scoped log retry idempotency

| Classification | Current state | Target state | Prerequisite |
| --- | --- | --- | --- |
| **MEASURED / UNVERIFIED** | The audited `events_logs` event lookup is non-unique; migration 030 exists but was not executed. | A deployed, validated scoped unique guard matching writer identity and partition requirements. | Production-sized clone rehearsal, zero exact scoped duplicates, real writer drain, lock/disk/WAL evidence, nullable-project decision, reviewed rollback. |

Stable identity plus `ON CONFLICT DO NOTHING` is not sufficient without the constraint. No live DDL was authorized in this phase.

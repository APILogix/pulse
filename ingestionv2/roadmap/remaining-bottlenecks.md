# Remaining bottlenecks and risks

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

| Priority | Evidence classification | Symptom/risk | Root cause | Impact | Proof | Safe next action | Acceptance gate/status |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| P0 | **DERIVED** | Usage can be lost after telemetry COMMIT | Process-local post-COMMIT buffer | Billing undercount on crash | Transaction ordering/source | Design replayable/logged inserted-only accounting; kill-point test | Durability **UNMET** |
| P0 | **DERIVED** | Staged usage can disappear | `UNLOGGED` Primary staging | Billing undercount on restart/failover | Schema/source | Logged/replayable design; restart/failover test | Durability **UNMET** |
| P1 | **DERIVED** | O(S²) trace span payload replication | Full parent trace JSON in every derived span | CPU/memory/TOAST/storage/WAL risk | Writer source | Product/search contract + feature gate + isolated benchmark | Compatibility/performance **DEFERRED** |
| P1 | **DERIVED** | O(N) merged error-group SQL | Per-event fallback/merge-chain operations | Linear round trips in branch | Source analysis | Instrument branch rate; batch only if material | Throughput **UNMET** |
| P1 | **DERIVED** | Partial-duplicate outbox amplification | Full scoped list reserved if any non-error row inserts | Extra DB/WAL under retries | Source + duplicate test | Return inserted IDs consistently; duplicate-heavy test | Idempotency cost **UNMET** |
| P1 | **DERIVED** | Strict memory bound absent | 80 jobs normalize before 16 permits; trace copies; usage cardinality over threshold on DB failure | OOM/restart/billing risk | Static envelope | RSS/heap/GC + failure-mode stress on isolated target | Memory **UNMET** |
| P1 | **MEASURED/DERIVED** | Queue/backpressure not a hard bound | Cached thresholds; high urgency continues; no active API/tenant rate cap | Unbounded durable backlog | Gateway/queue source | Traffic-aware capacity/recovery design | Backpressure **UNMET** |
| P1 | **DERIVED** | Fairness not fleet-wide | Per-process map; no group/global coordinator | Noisy-neighbor risk at scale | Worker source | Multi-replica tenant-share benchmark | Fairness **UNKNOWN** |
| P1 | **MEASURED** | Maintenance misses active topology | Primary pool + legacy names vs Log DB `events_*` | Defaults/retention unmanaged | Worker/catalog audit | Separate reviewed topology correction; clone rehearsal | Live ops **UNMET** |
| P1 | **MEASURED** | Six exact index pairs remain | Duplicate definitions; no safe removal evidence | Potential write/storage overhead | Catalog signatures | Bounded stats window, plans, present/absent benchmark, rollback | Index A–F **UNMET** |
| P2 | **MEASURED** | Generic Primary migration aliases broken at audit | Referenced canonical directories absent | Operator failure/migration drift | Static path audit | Reconcile source-of-truth path separately | Migration tooling **UNMET** |
| P2 | **MEASURED** | Aggregate all-failed batch error | `settle()` throws one aggregate callback error | Lower per-job diagnostics | Independent review | Preserve retry; improve diagnostics with tests | Observability **OPEN** |
| P2 | **DERIVED** | `stableStringify()` lacks explicit depth bound | Recursive helper | Pathological no-ID payload stack risk | Independent review | Add bounded/iterative handling only with compatibility tests | Correctness **OPEN** |

## Validation blockers

- broad no-new-failures: **UNMET** (four new outside-ingestion failures in concurrent dirty tree);
- integration/load/chaos/failure scenarios: absent;
- lint: unavailable because ESLint is undeclared/uninstalled;
- live migration/partition behavior: not exercised;
- full INSERT/WAL/EXPLAIN evidence: absent;
- performance before/after: absent.

## Database safety blockers

- default partitions contain existing data;
- migration 030 has not been run or rehearsed on a production-sized clone;
- exact five-column log duplicate count is unknown;
- `statsResetAt` is null;
- provider peak/compute/endpoint limits are unknown; and
- no index or trigger cost is measured.

## Acceptance status

| Criterion | Status |
| --- | --- |
| Scoped cancellation/UsageCounter correctness | **MET** |
| Telemetry/outbox ACK invariants | **MET focused/static** |
| Crash-safe billing | **UNMET** |
| Strict memory bound | **UNMET** |
| Repository-wide no-new-failures | **UNMET** |
| Live schema/maintenance readiness | **UNMET** |
| Demonstrated performance improvement | **UNMET** |

## Related documents

- [Completed optimizations](completed-optimizations.md)
- [Future optimization](future-optimization.md)
- [Scaling roadmap](scaling-roadmap.md)
- [Bottleneck matrix](../performance/bottlenecks.md)

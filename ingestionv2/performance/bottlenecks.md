# Ingestion bottlenecks and root-cause matrix

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

Runtime bottlenecks cannot be ranked from unit tests or a 2.474-second idle snapshot. The matrix ranks source/catalog risks by correctness urgency and structural scaling evidence, not observed production time.

## Ranked matrix

| Rank | Evidence classification | Symptom/risk | Root cause | Impact | Proof | Safe action | Acceptance gate/status |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | **MEASURED/DERIVED** | Expired callback could continue work and overlap retry | pg-boss signal previously not propagated through admission/transaction | Duplicate load, held permits/connections, ambiguous expiry boundary | Installed pg-boss + pre-change source trace | Signal checkpoints, abortable checkout, held-client backend cancel, rollback | **FIXED scoped**; 37-test suite/build pass; load effect unknown |
| 2 | **MEASURED/DERIVED** | Concurrent flush/shutdown could miss authoritative drain | Boolean UsageCounter guard became visible too late and stop did not reliably join/retry | Billing undercount/false shutdown success | Source + deterministic concurrency tests | `flushPromise`, trailing drain, exact merge-back, final failure propagation | **FIXED scoped**; crash durability still UNMET |
| 3 | **DERIVED** | Trace-derived payload bytes grow O(S²) | Every span row serializes full normalized parent trace | CPU/heap/TOAST/storage/WAL amplification | `buildTraceSpanRow()` → `payloadFor(event)` | **DEFERRED:** define search/API contract, feature gate, benchmark | Compatibility/performance **UNMET** |
| 4 | **DERIVED** | Error merged-group statements grow with batch/chain | Per-event fallback operations | Linear round trips in this branch | Source formula ~`3N + constants/hops` | Measure branch frequency; batch only if material | Workload evidence **UNMET** |
| 5 | **DERIVED** | Duplicate-heavy retry causes extra outbox work | Partial-duplicate non-error path passes full scoped list if one typed row inserts | Extra reservation SQL/WAL | Source + all-duplicate regression test | Return inserted IDs from all writers, then filter with correctness tests | Duplicate workload **UNMET** |
| 6 | **DERIVED** | Normalized copies accumulate before DB gate | Up to 80 typed jobs normalize before 16 permits | Heap/RSS pressure independent of DB transaction bound | Static concurrency × job-size envelope | Measure RSS/heap/GC; tune only with queue/fairness data | Strict memory **UNMET** |
| 7 | **MEASURED/DERIVED** | Queue can continue growing and noisy tenants can enter | Reactive cached 100k/250k shedding; high urgency continues; no active hard/API/tenant cap | Backlog/retry/storage growth | Active gateway/queue wiring | Design hard/tenant limits only from traffic/recovery evidence | Backpressure **UNMET** |
| 8 | **MEASURED/DERIVED** | Fairness writes extra jobs and is local only | Durable replacement per defer; limits multiply by process count | Primary WAL and possible fleet noisy-neighbor behavior | Worker source | Preserve replacement ordering; measure deferrals/fleet shares | Fleet fairness **UNKNOWN** |
| 9 | **MEASURED/DERIVED** | Maintenance does not manage active telemetry partitions | Primary pool + legacy unprefixed names vs Log DB `events_*` | Defaults retain data; planned retention ineffective | Worker wiring + catalog topology | Separate reviewed topology correction and clone rehearsal | Live correction **UNMET** |
| 10 | **MEASURED** | Six exact index pairs add maintenance cost | Duplicate catalog definitions | Potential insert/WAL/storage overhead | Catalog signatures | No removal without bounded use window and present/absent benchmark | Full A–F classification **UNMET** |

## Residual UsageCounter durability

| Evidence | Window | Status |
| --- | --- | --- |
| **DERIVED** | Process failure after Log DB COMMIT and before staging | Open. Typed retry is duplicate and does not reconstruct usage. |
| **DERIVED** | PostgreSQL restart/failover after UNLOGGED staging, before rollup | Open. |
| **DERIVED** | Prolonged DB failure with new keys exceeds map threshold | Open; overflow retained/logged rather than dropped. |
| **MEASURED** | `WorkerRegistry.stop()` catches/logs processor stop failure | Supervisor-level final-drain guarantee remains imperfect. |

## Queue/catalog evidence

- recorded `job_common` estimate: 111,176 live, 1,886 dead tuples;
- idle diagnostics: two sequential scans and 222,352 tuples read, not workload-attributable;
- selected ingestion retained rows: 1,500;
- queue options at capture: shared `job_common`, partition/notify disabled;
- default telemetry partitions contained data;
- `statsResetAt` was null, invalidating zero-scan removal authorization.

## Validation and regression evidence

| Classification | Result |
| --- | --- |
| **MEASURED** | Cancellation/usage four-file command: 37 passed. |
| **MEASURED** | Repository ingestion report: 92 passed, 1 todo; no integration/load/chaos bundle. |
| **MEASURED** | Production build passed. |
| **MEASURED** | Broad pre: 146 files, 2,086 tests, 1,995 pass/90 fail/1 pending. |
| **MEASURED** | Broad post: 147 files, 2,100 tests, 2,005 pass/94 fail/1 pending. |
| **MEASURED** | Four new failures are outside ingestion amid concurrent unrelated edits; causality not isolated. |
| **UNMET** | Repository-wide no-new-failures gate. |

## Explicitly unmet criteria

1. executed baseline/candidate benchmark and demonstrated improvement;
2. before/after throughput and tail latency;
3. complete live INSERT/WAL/EXPLAIN evidence;
4. strict worst-case memory bound;
5. fleet-wide fairness and overload recovery;
6. full index A–F classification over bounded window;
7. crash/failover-safe usage accounting;
8. live migration 030 and partition-maintenance correction; and
9. repository-wide no-new-failures.

## Related documents

- [Forensic report](forensic-report.md)
- [Baseline](baseline.md)
- [Before/after](before-after.md)
- [Capacity model](capacity-model.md)
- [Remaining bottlenecks](../roadmap/remaining-bottlenecks.md)

# Ingestion v2 engineering evidence package

Status date: 2026-08-27

## Evidence vocabulary

| Classification | Meaning |
| --- | --- |
| **MEASURED** | Directly observed in source, installed dependency code, test/build output, a recorded database query, or a captured artifact during this audit. |
| **DERIVED** | Calculated from measured inputs or inferred from a traced implementation; the inputs or formula are stated. |
| **UNVERIFIED** | A design, procedure, or candidate exists but has not been exercised on a safe production-like target. |
| **UNKNOWN** | Required evidence was unavailable or not captured. |

A dry-run, source inspection, or unit test is not a production benchmark. Working-tree presence is not deployment proof.

## Executive status

| Classification | Result |
| --- | --- |
| **MEASURED** | The active path is HTTP gateway → durable pg-boss `ingest.*` job → dedicated ingestion worker → process-local tenant fairness → cancellation-aware 16-permit write admission → Log DB transaction containing typed/error and transactional outbox writes → cancellation check → `COMMIT` → post-commit domain event and inserted-only usage accounting → pg-boss completion. |
| **MEASURED** | pg-boss v12.22 supplies one shared `AbortSignal` to the jobs delivered in a handler batch. The signal now reaches `WorkerRegistry`, FIFO admission, pool checkout, and `EventProcessor`. An active statement is cancelled through `pg_cancel_backend(processID)` while the target client remains checked out; rollback and release happen afterward. |
| **MEASURED** | ACK ordering remains downstream of successful `COMMIT`. If expiry races with a successful COMMIT, inserted-only usage accounting still runs. A retry converges through typed conflict guards where deployed; the audited Log DB lacks migration 030's intended scoped log unique guard, so this guarantee is not accepted for logs. |
| **MEASURED** | `UsageCounter` now has one authoritative `flushPromise`, coalesces a requested trailing drain, exactly merges a failed snapshot back, and makes `stop()` join/retry/fail honestly. |
| **DERIVED** | Usage accounting is still not crash-safe: process failure after telemetry COMMIT but before staging can lose counts, and `UNLOGGED` staging can be lost on PostgreSQL restart/failover. Buffer cardinality can exceed its configured threshold during prolonged database failure rather than dropping billing data. |
| **MEASURED** | Focused cancellation/usage validation passed 37 tests across four files. The repository ingestion report passed 13 files, 92 tests, and 1 todo; its overall status remained non-accepting because integration/load/chaos evidence was intentionally absent. The report omits `write-admission.test.ts` and `usage-counter.test.ts`, which separately contribute 17 passing tests; these totals are not added because overlap was not independently eliminated. |
| **MEASURED** | `npm run build` passed after the ingestion changes. Lint was not run because ESLint is undeclared/uninstalled; no unpinned dependency was added. |
| **MEASURED** | The same broad non-integration scope changed from 146 files / 2,086 tests (1,995 pass, 90 fail, 1 pending) to 147 files / 2,100 tests (2,005 pass, 94 fail, 1 pending). Four newly failing files are outside ingestion and coincide with concurrent unrelated working-tree edits; causality was not isolated, so the repository-wide no-new-failures gate is **UNMET**. |
| **MEASURED** | Automatic ingestion-worker migration execution now applies unattended-safe files but defers any file marked `requires-operator-drain`; deferral executes no migration SQL and writes no ledger row, and startup continues with a warning. The explicit CLI remains operator mode. The focused migration contract passes 4 tests, and the three-file migration/evidence command passes 15. |
| **MEASURED** | Migration 030 was not executed live; no queue rebuild, index drop, trigger change, partition migration, telemetry deletion, or production load test was performed. |
| **UNVERIFIED** | **BENCHMARK NOT EXECUTED.** The acceptance plan has 3,564 planned/0 completed cases; pre-change and post-change smoke plans each have 12 planned/0 completed cases. No throughput, latency, CPU, memory, WAL/event, queue-drain, fairness, or improvement claim is made. |
| **UNKNOWN** | Deployment status of the working-tree changes is unknown. Source presence is not deployment evidence. |

## Non-negotiable invariants and safety boundaries

- **MEASURED:** no source-job completion before durable telemetry `COMMIT`.
- **MEASURED:** typed rows and `telemetry_outbox` remain in one Log DB transaction.
- **MEASURED:** retries retain stable receipt time and generated identity; `ON CONFLICT DO NOTHING` remains the typed-row retry mechanism where an applicable unique guard exists. The audited log event lookup is non-unique, and migration 030's intended guard was not executed.
- **MEASURED:** billing is based on actual inserted rows, not received rows.
- **MEASURED:** fairness remains before write admission; it is process-local, not fleet-wide.
- **MEASURED:** public-ID defaults, sequences, lookup indexes, and `trg_sync_typed_event_contract` remain intact.
- **MEASURED:** no additional index removal is authorized. Six exact catalog duplicate pairs and additional semantic redundancies require a bounded usage window and measured write-cost evidence before any action.
- **MEASURED:** existing default partitions contain data; blind partition rollout or retention changes are unsafe.
- **UNKNOWN:** no isolated benchmark database was supplied. Production-labelled endpoints must not receive generated benchmark writes, even in transaction rollback mode.

## Phase-19 acceptance status

| Criterion | Status | Evidence or blocker |
| --- | --- | --- |
| Correctness passes | **MET (scoped)** | 37 focused cancellation/usage tests; ingestion report 92 pass/1 todo. |
| Tests pass | **PARTIAL** | Changed ingestion suites pass; broad repository suite has existing and four newly observed unrelated-file failures. |
| No new failures | **UNMET** | Broad comparison has four new failing files; causality was not isolated in the dirty concurrent tree. |
| Durability preserved | **MET for telemetry/outbox; PARTIAL for billing** | COMMIT/ACK and transactional outbox preserved; post-COMMIT usage remains crash/failover vulnerable. |
| Idempotency preserved | **PARTIAL / UNMET for logs** | Stable identity and deployed typed conflict guards remain; outbox reservation remains. The audited log lookup is non-unique and migration 030 was not executed. |
| Fairness preserved | **MET process-locally; UNKNOWN fleet-wide** | Existing defer-before-admission behavior retained; no cross-process coordinator. |
| Public IDs preserved | **MET (catalog/source)** | Defaults, sequences, trigger, and lookup indexes unchanged. |
| Outbox preserved | **MET (focused/static)** | Same transaction; all-duplicate batch skips outbox; partial duplicates remain idempotent but can amplify work. |
| Billing preserved | **PARTIAL** | Inserted-only counting and flush concurrency fixed; durable post-COMMIT accounting is unresolved. |
| Retry safety preserved | **PARTIAL / UNMET for logs** | Aborts fail the job for retry; held-client cancellation and rollback prevent false pre-COMMIT completion. Post-COMMIT redelivery convergence is not established for logs without the scoped unique guard. |
| Memory bounded | **UNMET as a strict worst-case claim** | Delivery/raw-payload envelope is bounded on the normal path, but total RSS is unmeasured and usage-key cardinality can grow during prolonged DB failure. |
| DB connection ceiling safe | **PARTIAL** | Admission reserves pool headroom and static ceilings fit recorded server limits; sustained peak/provider limits are unverified. |
| Worker concurrency bounded | **MET per process** | Default typed delivery ≤80 jobs, DLQ ≤20, rollup 1; DB writes ≤16. |
| Benchmark demonstrates improvement | **UNMET** | **BENCHMARK NOT EXECUTED**. |

## Phase-20 required document map (47 files)

### Architecture (7)
- [Overview](architecture/overview.md)
- [Current architecture](architecture/current-architecture.md)
- [Target architecture](architecture/target-architecture.md)
- [Ingestion flow](architecture/ingestion-flow.md)
- [Data flow](architecture/data-flow.md)
- [Failure flow](architecture/failure-flow.md)
- [Scaling model](architecture/scaling-model.md)

### Workers (6)
- [Worker architecture](workers/worker-architecture.md)
- [Worker concurrency](workers/worker-concurrency.md)
- [Worker fairness](workers/worker-fairness.md)
- [Worker backpressure](workers/worker-backpressure.md)
- [Worker memory](workers/worker-memory.md)
- [Worker future optimization](workers/worker-future-optimization.md)

### Database (9)
- [Database architecture](database/database-architecture.md)
- [Connection pools](database/connection-pools.md)
- [Transaction model](database/transaction-model.md)
- [Index forensics](database/index-forensics.md)
- [Trigger forensics](database/trigger-forensics.md)
- [Public-ID generation](database/public-id-generation.md)
- [Query inventory](database/query-inventory.md)
- [Query optimization](database/query-optimization.md)
- [Neon capacity](database/neon-capacity.md)

### Ingestion (10)
- [Batching](ingestion/batching.md)
- [Event types](ingestion/event-types.md)
- [Deduplication](ingestion/deduplication.md)
- [Error ingestion](ingestion/error-ingestion.md)
- [Trace ingestion](ingestion/trace-ingestion.md)
- [Span ingestion](ingestion/span-ingestion.md)
- [Request ingestion](ingestion/request-ingestion.md)
- [Log ingestion](ingestion/log-ingestion.md)
- [Metrics ingestion](ingestion/metrics-ingestion.md)
- [Outbox](ingestion/outbox.md)

### Performance (6)
- [Baseline](performance/baseline.md)
- [Bottlenecks](performance/bottlenecks.md)
- [Benchmark methodology](performance/benchmark-methodology.md)
- [Before/after](performance/before-after.md)
- [Capacity model](performance/capacity-model.md)
- [Forensic report](performance/forensic-report.md)

### Operations (5)
- [Production runbook](operations/production-runbook.md)
- [Failure recovery](operations/failure-recovery.md)
- [Monitoring](operations/monitoring.md)
- [Alerts](operations/alerts.md)
- [Troubleshooting](operations/troubleshooting.md)

### Roadmap (4)
- [Completed optimizations](roadmap/completed-optimizations.md)
- [Remaining bottlenecks](roadmap/remaining-bottlenecks.md)
- [Future optimization](roadmap/future-optimization.md)
- [Scaling roadmap](roadmap/scaling-roadmap.md)

## Canonical supporting documents

- [Independent acceptance review](independent-acceptance-review.md)
- [System architecture](architecture/system-architecture.md)
- [Worker and queue lifecycle](workers/worker-and-queue-lifecycle.md)
- [Schema, indexes, and triggers](database/schema-indexes-and-triggers.md)
- [Write path and invariants](ingestion/write-path-and-invariants.md)
- [Performance acceptance plan](performance/acceptance-plan.md)
- [Evidence-driven roadmap](roadmap/evidence-driven-roadmap.md)
- [Implementation change catalog](changes/implementation-change-catalog.md)
- [Migration 030 live-rollout procedure](live-db-rollout/events-logs-identity.md)

## Evidence inventory

| Classification | Artifact or command | Establishes | Does not establish |
| --- | --- | --- | --- |
| **MEASURED** | `artifacts/ingestion-phase2/schema-audit-before.json` | Recorded catalog, indexes, triggers, default partitions, relation sizes, queue drift. | Current deployment state or an adequate index-usage window. |
| **MEASURED** | `artifacts/ingestion-phase2/runtime-baseline-idle.json` | A 2.474-second idle observation. | Workload capacity, CPU attribution, or tail latency. |
| **MEASURED** | `artifacts/ingestion-phase2/pre-change-unit-results.json` and `post-change-unit-results.json` | Same-scope broad assertion/file comparison. | Isolation from concurrent unrelated working-tree edits. |
| **MEASURED** | `artifacts/ingestion-phase2/post-change-test-report.md` | 13 ingestion-focused files, 92 pass, 1 todo; missing integration/load/chaos evidence. | Production benchmark or crash/failover behavior. |
| **MEASURED** | `artifacts/ingestion-phase2/benchmark-acceptance-plan.json` | 3,564 planned, 0 executed. | Any performance result. |
| **MEASURED** | `pre-change-benchmark-plan.json` and `post-change-benchmark-plan.json` | 12 planned, 0 executed in each smoke plan. | Before/after performance. |
| **MEASURED** | `npm run build` | Current TypeScript production build passed. | Lint or runtime deployment. |
| **UNKNOWN** | Executed isolated baseline/candidate matrix | Not present. | Every throughput/latency/improvement conclusion. |

## Reading rule

Anything marked **UNKNOWN** or **UNVERIFIED**, or any **UNMET/PARTIAL** gate, remains a blocker for a production-performance claim, destructive database operation, pool/concurrency increase, or deployment assertion.
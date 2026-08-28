# Implementation change catalog

Status date: 2026-08-27. Working-tree presence is not deployment proof, and this catalog makes no performance claim.

## P0 correctness changes implemented in this audit

| Classification | File/function | Change | Preserved invariant | Focused evidence |
| --- | --- | --- | --- | --- |
| **MEASURED** | `pipeline/ingestion-abort.ts` | Added stable `INGESTION_JOB_ABORTED`, typed error, abort checkpoint helper, and classifier. | One failure class across registry/admission/transaction; incomplete jobs fail for retry. | Registry/processor/admission tests. |
| **MEASURED** | `pipeline/write-admission.ts` | Replaced bare resolvers with stateful FIFO waiter records; optional signal; synchronous queued-waiter removal; permit release on acquire/continuation race. | FIFO order and permit ceiling; no aborted waiter/permit leak. | 12-test file, including abort-before-acquire, queued abort, future FIFO progress. |
| **MEASURED** | `workers/worker-registry.ts` | Added optional delivered `signal`; checkpoints around accounting/fairness/admission; forwards signal; classifies `job_aborted`. | Fairness before DB admission, replacement-before-source-completion, per-job retry semantics. | 9-test file, including already-aborted and signal-forwarding cases. |
| **MEASURED** | `workers/event-processor.ts` | Added signal checkpoints; abortable leak-safe pool checkout; query instrumentation; active `pg_cancel_backend(processID)` using reserved pool headroom; held target client until cancel+rollback; pre-COMMIT checkpoint; stable abort failure. | ACK after COMMIT, transactional outbox, rollback/retry safety, no PID-reuse cancellation, inserted-only billing. | 11-test file, including late checkout, active cancellation, all-duplicate outbox, and successful-COMMIT expiry race. |
| **MEASURED** | `usage/usage-counter.ts` | Replaced racy boolean with authoritative `flushPromise` + `flushRequested`; trailing drain; exact merge-back; caught background rejection; stop joins/retries/propagates final failure. | No concurrent schema/staging drains; no silent count drop; no false shutdown success inside `UsageCounter`. | 5-test file covering concurrent setup, trailing data, merge-back, stop retry/join/failure. |

## Cancellation design decisions

| Classification | Decision | Reason |
| --- | --- | --- |
| **MEASURED** | Keep the target client checked out until cancellation and rollback finish. | Its runtime PID cannot be returned/reassigned and then accidentally targeted as unrelated work. |
| **MEASURED** | Reject post-abort queries except `ROLLBACK`. | Prevents an expired callback from submitting additional work after cancellation. |
| **MEASURED** | Let statement timeout remain fallback if cancel query fails. | Cancellation itself can fail; future statements stay blocked and the active statement retains a finite server bound. |
| **MEASURED** | Check immediately before COMMIT. | Prevents known-expired work from committing while preserving PostgreSQL atomicity. |
| **MEASURED / PARTIAL** | If COMMIT reports success at the expiry boundary, finish inserted-only usage accounting. | Telemetry is durable; redelivery deduplicates where a typed unique guard is deployed. The audited log guard from migration 030 is not live. |
| **DERIVED** | A fairness replacement may already have been sent when abort arrives. | An extra retry/copy is safer than false completion; typed rows/outbox remain idempotent. |

## UsageCounter decisions and limits

| Classification | Decision/limit | Result |
| --- | --- | --- |
| **MEASURED** | Make the shared promise authoritative before `ensureSchema()`. | Concurrent timer/threshold/stop calls join one owner. |
| **MEASURED** | Coalesce a requested trailing drain. | Data arriving during the first snapshot is drained before waiting callers resolve when another flush was requested. |
| **MEASURED** | Re-buffer a failed snapshot exactly once and reject. | Shutdown can retry and cannot claim success after staging failure. |
| **MEASURED** | Retain counts beyond `bufferLimit` and log overflow. | Billing data is not intentionally dropped; strict failure-mode cardinality is not bounded. |
| **DERIVED** | Process crash before staging remains lossy. | Post-COMMIT memory is not replayable from duplicate redelivery. |
| **DERIVED** | PostgreSQL restart/failover can lose `UNLOGGED` staging. | Single-flight concurrency does not create database durability. |
| **MEASURED** | Registry stop still catches/logs processor stop failure. | Process-level supervisor propagation remains a deferred limitation. |

## Preserved earlier working-tree hardening

These changes predated or were independent of the final P0 correction and were preserved rather than overwritten.

| Classification | Area | Current working-tree behavior |
| --- | --- | --- |
| **MEASURED** | Receipt/identity | Durable `metadata.receivedAt`, generated ID before occurrence resolution, one scoped occurrence time. |
| **MEASURED** | Trace validation | Iterative traversal; 10,000-node and depth-128 limits; cycle/shared-reference and prototype defense. |
| **MEASURED** | Trace SQL | 67-column rows flush at 978 rows to stay under PostgreSQL's 65,535 bind limit. |
| **MEASURED** | Queue provisioning | DLQ-first fail-fast setup; no destructive queue rebuild. |
| **MEASURED** | Worker lifecycle | Failed local cleanup state retained; shared rollup schedule is not globally unscheduled by replica stop. |
| **MEASURED** | Profiling | Admission wait separated from pool checkout; failed-profile p95 is not hidden. |
| **MEASURED** | Migration 030 | Five-column log identity migration and narrow rollback exist with drain/duplicate/lock gates; not run live. |
| **MEASURED** | Migration serialization | Forward and rollback commands share a fail-fast session advisory lock. |
| **MEASURED** | Evidence tooling | Catalog, benchmark-plan, runtime-diagnostic, EXPLAIN, and profile-summary tooling exists; tool presence is not executed evidence. |

## Focused tests changed or added

| File | Coverage/result |
| --- | --- |
| `event-processor.test.ts` | 11 passed; no-side-effect pre-abort, admission abort, late checkout release, active backend cancellation/rollback/release, abort class, all-duplicate outbox skip, COMMIT-race billing. |
| `write-admission.test.ts` | 12 passed; abort-before-acquire, queued removal, permit/waiter leak defense, FIFO continuation. |
| `worker-registry.test.ts` | 9 passed; aborted jobs do not process/defer; delivered signal reaches processor. |
| `usage-counter.test.ts` | 5 passed; authoritative setup, trailing drain, exact merge-back, stop join/retry/failure. |
| Repository ingestion report | 13 files, 92 passed, 1 todo; overall report withheld acceptance because integration/load/chaos/failure evidence was absent. |

**MEASURED:** the two new/report-omitted files (`write-admission.test.ts`, `usage-counter.test.ts`) contain 17 passing tests. Do not claim `92 + 17` as a de-duplicated suite total without comparing manifests.

## Validation

| Classification | Check | Result |
| --- | --- | --- |
| **MEASURED** | Final four-file cancellation/usage command | 4 files, 37 tests passed. |
| **MEASURED** | Production TypeScript build | `npm run build` passed. |
| **MEASURED** | Broad same-scope pre/post | Pre: 146 files, 2,086 tests, 1,995 pass/90 fail/1 pending. Post: 147 files, 2,100 tests, 2,005 pass/94 fail/1 pending. |
| **MEASURED** | New broad failures | Four files outside ingestion: alert decision, alert/Redis integration, analytics read registration, project environment routes. Concurrent unrelated edits prevent causal isolation. |
| **UNVERIFIED** | Lint | ESLint undeclared/uninstalled; no dependency added. |
| **UNVERIFIED** | Integration/load/chaos/restart/failover | Not run. |
| **UNVERIFIED** | Performance | **BENCHMARK NOT EXECUTED**. |

## Independent implementation review

**MEASURED:** an independent scoped reviewer returned **APPROVED**, with no blocker/high findings for cancellation, admission, pool safety, retry semantics, UsageCounter, and focused tests.

Lower findings retained:

1. partial-duplicate non-error batches can amplify outbox SQL/WAL;
2. abort-guard disposal is redundant but idempotent;
3. batch settlement can surface one aggregate error when every job fails;
4. recursive `stableStringify()` has no explicit depth bound.

## Deferred compatibility/performance changes

| Classification | Candidate | Decision |
| --- | --- | --- |
| **DERIVED/MEASURED** | Full parent trace payload copied into every derived span, structurally O(S²). | **DEFERRED:** analytics unified search uses span `payload::text`; current-span-only payload changes search semantics. Require a contract/feature gate and benchmark. |
| **DERIVED** | Non-error inserted-set outbox filtering. | Defer until all typed writers return inserted identities and duplicate-heavy correctness/WAL evidence exists. |
| **UNKNOWN** | Pool/concurrency increase. | Not authorized without sustained CPU/backend/wait/memory/fairness evidence. |
| **UNKNOWN** | Six exact duplicate index-pair removal. | Not authorized without bounded usage window, query-plan proof, and measured write cost. |
| **UNKNOWN** | Billing crash-window closure. | Requires logged/replayable inserted-only accounting and kill/restart/failover tests. |
| **UNVERIFIED** | Migration 030 and partition maintenance. | No live execution. Default partitions contain data; maintenance topology is currently mismatched. |

## Rollback principles

| Change | Safe rollback principle |
| --- | --- |
| Cancellation plumbing | Revert registry, admission, processor, and shared abort helper as one release. Partial rollback can silently restore ignored expiry or break signatures. |
| Active backend cancellation | Do not release the target client before cancellation/rollback. If reverting, retain statement timeout and prove retry overlap is acceptable. |
| UsageCounter | Revert implementation and tests together only with an alternative authoritative flush/shutdown design; the prior boolean race should not be restored. |
| Receipt/identity and trace bounds | Revert only with an explicit queue compatibility/security decision; silent retry-varying time or recursive untrusted traversal is unsafe. |
| Migration 030 | Use the reviewed down migration only with writer drain and shared lock; it drops no telemetry. No live rollback was performed. |

## Acceptance status

| Gate | Status |
| --- | --- |
| Changed cancellation/usage tests | **MET** |
| Production build | **MET** |
| ACK/COMMIT and transactional outbox invariants | **MET focused/static** |
| Retry/idempotency | **PARTIAL / UNMET for logs** — migration 030 guard not live |
| Inserted-only billing behavior | **MET focused; crash/failover durability UNMET** |
| Repository-wide no-new-failures | **UNMET** |
| Strict worst-case memory bound | **UNMET** |
| Crash/failover-safe usage accounting | **UNMET** |
| Live migration/partition correction | **UNMET** |
| Before/after performance improvement | **UNMET — BENCHMARK NOT EXECUTED** |

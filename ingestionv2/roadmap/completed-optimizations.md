# Completed optimizations and hardening

Status date: 2026-08-27.

These items are present in the working tree. Deployment is **UNKNOWN**. They are correctness/robustness changes; **BENCHMARK NOT EXECUTED**, so none carries a performance-improvement claim.

## P0 completed in this audit

| Classification | Change | Preserved result | Evidence |
| --- | --- | --- | --- |
| **MEASURED** | Shared typed ingestion abort error/helper | Stable `job_aborted` classification and retry failure. | Registry/processor/admission tests. |
| **MEASURED** | pg-boss signal propagation through registry/fairness | Expired jobs cannot knowingly proceed through tenant admission; replacement-before-complete remains. | 9-test registry file. |
| **MEASURED** | Cancellation-aware FIFO admission | Queued abort removal and acquire-race permit release. | 12-test admission file. |
| **MEASURED** | Abortable pool checkout | Late client is released; no checkout leak. | Processor regression. |
| **MEASURED** | Held-client active backend cancellation | Target PID remains reserved until cancellation + rollback; no PID-reuse cancel. | Processor regression/source review. |
| **MEASURED / PARTIAL** | Pre-COMMIT checkpoint and successful-COMMIT race policy | ACK still after COMMIT; committed usage accounting still runs; redelivery deduplicates where a typed guard is deployed. Migration 030's log guard is not live. | Processor regression. |
| **MEASURED** | UsageCounter authoritative single-flight | Concurrent schema/flush callers join one promise and requested trailing data drains. | 5-test UsageCounter file. |
| **MEASURED** | UsageCounter exact failure merge and stop retry/failure | Counts retained; no internal false final-drain success. | UsageCounter tests. |

## Preserved working-tree hardening

- retry-stable receipt-clock normalization and generated identity;
- iterative trace validation, 10,000-node/depth-128 bounds, cycle/shared-reference/prototype defense;
- bind-safe 978-row trace-derived span INSERT chunks;
- set-based typed inserts and inserted-only billing;
- DLQ-first fail-fast queue provisioning;
- retry-safe local worker/rollup cleanup without global schedule removal;
- separate admission versus checkout profiling and failed-profile diagnosis;
- shared advisory lock for Log DB forward/rollback commands; and
- drain/duplicate-gated migration 030 files (not executed live).

## Validation

| Classification | Check | Result |
| --- | --- | --- |
| **MEASURED** | Final cancellation/usage command | 4 files, 37 tests passed. |
| **MEASURED** | Repository ingestion report | 13 files, 92 tests passed, 1 todo; integration/load/chaos evidence absent. |
| **MEASURED** | Report-omitted new files | Admission + UsageCounter contain 17 passing tests; not added to 92 without a de-duplicated manifest. |
| **MEASURED** | Production build | Passed. |
| **MEASURED** | Independent scoped implementation review | Approved; no blocker/high finding. |
| **UNVERIFIED** | Lint | ESLint unavailable/undeclared; no dependency added. |

## Explicitly not completed

- durable post-COMMIT billing across process and PostgreSQL failure;
- trace full-parent payload O(S²) optimization (deferred for search compatibility);
- partial-duplicate inserted-set outbox filtering;
- strict memory bound and hard queue/API/tenant capacity;
- fleet-wide fairness;
- six duplicate-index-pair removal/full A–F classification;
- live migration 030 or partition-maintenance correction; and
- any measured performance improvement.

## Broad gate

The broad suite gained four failing files outside ingestion amid concurrent unrelated edits. Causality was not isolated, so repository-wide no-new-failures remains **UNMET**, despite the changed ingestion suites passing.

## Related documents

- [Change catalog](../changes/implementation-change-catalog.md)
- [Remaining bottlenecks](remaining-bottlenecks.md)
- [Future optimization](future-optimization.md)
- [Forensic report](../performance/forensic-report.md)

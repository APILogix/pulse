# Before/after comparison

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

There is no valid before/after throughput, latency, CPU, memory, WAL/event, trigger-cost, queue-drain, or fairness comparison. The sections below compare source behavior and test outcomes only.

## Performance comparison

| Metric | Before | After | Verdict |
| --- | --- | --- | --- |
| Events/second | **UNKNOWN** | **UNKNOWN** | Not measured. |
| MB/second | **UNKNOWN** | **UNKNOWN** | Not measured. |
| p50/p95/p99/p99.9 | **UNKNOWN** | **UNKNOWN** | Not measured. |
| CPU/RSS/heap/GC | **UNKNOWN** | **UNKNOWN** | Not measured. |
| WAL/event and trigger cost | **UNKNOWN** | **UNKNOWN** | Not measured. |
| Queue drain and tenant share | **UNKNOWN** | **UNKNOWN** | Not measured. |
| Improvement percentage | N/A | N/A | No claim authorized. |

## Benchmark planning artifacts

| Phase | Artifact | Planned | Completed |
| --- | --- | ---: | ---: |
| Acceptance planning | `benchmark-acceptance-plan.json` | 3,564 | 0 |
| Pre-change smoke planning | `pre-change-benchmark-plan.json` | 12 | 0 |
| Post-change smoke planning | `post-change-benchmark-plan.json` | 12 | 0 |

All have `dryRun=true`. `passed=true` means command generation succeeded.

## Behavioral before/after

| Concern | Before | After | Evidence status |
| --- | --- | --- | --- |
| pg-boss expiry | Signal existed in delivered jobs but ingestion ignored it through work/admission/transaction. | Signal threaded through registry, fairness, admission, checkout, queries, and pre-COMMIT boundary. | **MEASURED** source + focused tests. |
| Admission abort | Bare waiter resolvers; no signal removal. | Stateful waiter, synchronous queued removal, acquire-race permit release. | **MEASURED** tests. |
| Pool checkout abort | Pool wait was not signal-raced. | Late checkout after abort is released. | **MEASURED** test. |
| Active DB query | Relied on server timeout/disconnect. | `pg_cancel_backend(processID)` while target client remains held, then rollback/release. | **MEASURED** test/source. |
| COMMIT expiry race | No explicit pre-COMMIT signal policy. | Check before COMMIT; successful COMMIT still receives inserted-only accounting. | **MEASURED** regression test. |
| Usage flush owner | Racy boolean around awaited setup/flush. | Authoritative promise before schema setup plus requested trailing drain. | **MEASURED** deterministic tests. |
| Usage failure | Shutdown could miss/restate success around active/failed drain. | Exact merge-back, join/retry, final rejection, no internal false success log. | **MEASURED** tests. |

Performance effects for every row are **UNKNOWN**.

## Invariants after change

- ACK remains after durable COMMIT.
- typed rows and outbox remain one transaction.
- incomplete aborted work fails for retry.
- stable identity/timestamp and deployed typed conflict guards remain; scoped log retry idempotency remains unmet because migration 030 is not live.
- usage counts actual inserts only.
- process-local fairness remains before admission.
- public-ID defaults/sequences/triggers remain unchanged.
- all-duplicate non-error batches skip outbox/usage.

## Functional validation comparison

| Metric | Pre-change | Post-change | Delta |
| --- | ---: | ---: | ---: |
| Broad files total | 146 | 147 | +1 |
| Broad files passed | 134 | 131 | -3 |
| Broad files failed | 12 | 16 | +4 |
| Broad tests total | 2,086 | 2,100 | +14 |
| Broad tests passed | 1,995 | 2,005 | +10 |
| Broad tests failed | 90 | 94 | +4 |
| Broad tests pending | 1 | 1 | 0 |

**MEASURED:** four new failing files are outside ingestion (alert decision, alert/Redis integration, analytics read registration, project environment routes) and appeared amid concurrent unrelated working-tree edits. Causality was not isolated; the no-new-failures gate remains **UNMET**.

Post-change targeted evidence:

- 37 cancellation/usage tests passed across four files;
- repository ingestion report: 92 passed, 1 todo, with integration/load/chaos evidence absent;
- production build passed;
- lint unavailable because ESLint is undeclared/uninstalled.

## Residual gaps

- Usage accounting remains vulnerable to process and UNLOGGED restart/failover loss.
- Strict worst-case memory bound remains unproven.
- Trace parent payload replication remains O(S²) and is deferred for search compatibility.
- partial-duplicate outbox amplification remains.
- migration 030 and partition maintenance were not executed live.
- full index A–F classification was not completed.

## Acceptance status

| Gate | Status |
| --- | --- |
| Correctness hardening has focused tests | **MET** |
| Production build | **MET** |
| Repository-wide no-new-failures | **UNMET** |
| Before/after performance | **UNMET** |
| Benchmark demonstrates improvement | **UNMET** |

## Related documents

- [Baseline](baseline.md)
- [Benchmark methodology](benchmark-methodology.md)
- [Forensic report](forensic-report.md)
- [Change catalog](../changes/implementation-change-catalog.md)

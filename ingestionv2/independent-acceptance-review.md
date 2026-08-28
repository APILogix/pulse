# Independent ingestion acceptance review

Review date: 2026-08-27. Review mode: read-only, independent implementation auditor + documentation auditor + final acceptance synthesizer.

## Verdict

# PARTIALLY ACCEPTED FOR CORRECTNESS HARDENING ONLY

The cancellation and UsageCounter changes have focused correctness/build evidence. The work is **not** accepted as a production performance optimization or as full Phase-19 completion.

# BENCHMARK NOT EXECUTED

## Findings

### Critical — scoped log idempotency is not deployed

The active log writer uses untargeted `ON CONFLICT DO NOTHING`, but the audited Log DB has only a non-unique event lookup. Migration 030 proposes the required `(organization_id, project_id, environment, event_id, occurred_at)` unique guard and was not executed.

Consequences:

- redelivered/retried logs can insert again;
- inserted-only usage then counts the extra physical row;
- typed log final-state idempotency/retry convergence is not established; and
- COMMIT/expiry races are safe for types with deployed guards but not fully convergent for logs.

No live DDL is authorized by this finding. Next step is a production-sized clone rehearsal followed by separately approved drain-gated rollout.

### High — billing remains crash/failover vulnerable

Usage is accumulated post-COMMIT in process memory before staging. A process crash can lose that increment. `usage_counter_staging` is UNLOGGED, so PostgreSQL restart/crash recovery/failover can lose staged counts before rollup. The new single-flight/trailing drain fixes graceful/concurrent behavior, not these durability windows.

### Medium/retained

1. Mixed non-error partial duplicates can pass the complete scoped list to outbox reservation, amplifying conflict SQL/WAL.
2. `INGESTION_GZIP_MAX_BYTES` is declared but unused; dedicated expanded-size enforcement is unproven.
3. Jobs in one pg-boss callback batch share one abort signal; cancellation is not independently scoped per item.
4. Fairness is process-local, not fleet-wide.
5. Trace-derived spans copy the complete parent trace, an O(S²) structural payload shape deferred for search/API compatibility.

The reviewer found no blocker in retained-client PostgreSQL cancellation itself: the target client remains held through cancel/rollback and post-abort statements reject except rollback.

## Phase-19 independent status

| Criterion | Status | Independent basis |
| --- | --- | --- |
| Correctness passes | **PARTIAL** | focused ingestion tests pass; log idempotency gap remains |
| Tests pass | **PARTIAL / scoped pass** | focused suites pass; broad suite has unresolved failures |
| No new failures | **UNMET** | four newly failing unrelated-file suites were not causally isolated |
| Durability preserved | **MET telemetry/outbox; PARTIAL billing** | ACK/COMMIT/outbox preserved; usage crash/failover windows remain |
| Idempotency preserved | **UNMET for logs; MET where guards deployed** | migration 030 not live |
| Fairness preserved | **MET process-local; fleet UNKNOWN** | existing local gate retained; no multi-process evidence |
| Public IDs preserved | **MET source/catalog** | defaults/sequences/triggers unchanged |
| Outbox preserved | **MET correctness; amplification retained** | same transaction/reservation; partial-duplicate cost remains |
| Billing preserved | **PARTIAL** | inserted-only behavior; crash/failover and duplicate-log risks |
| Retry safety preserved | **UNMET for logs; MET where guards deployed** | cancellation/rollback correct; log redelivery does not converge |
| Memory bounded | **UNMET strict gate** | total RSS/trace peak/failure cardinality unmeasured |
| DB connection ceiling safe | **PARTIAL/static only** | permit/pool arithmetic bounded; sustained provider peak unverified |
| Worker concurrency bounded | **MET per process** | 80 typed, 20 DLQ, 16 admitted writes at defaults |
| Benchmark demonstrates improvement | **UNMET** | 0 cases executed |

## Documentation compliance

The independent documentation auditor confirmed:

- Phase 20: all 47 required files present and substantive;
- Phase 21: migration 030 guide covers all eleven required change/rollback fields and states it was not executed;
- Phase 22: every listed optimization has when, signal, threshold, benefit, cost, risk, and why-not-now fields; thresholds are honestly unset pending SLO evidence; and
- Phase 23: all twelve forensic questions and the exact eleven-column root-cause matrix are present.

Local automated verification additionally found all 47 required files, 56 Markdown files before this review artifact, zero broken relative links, and zero trailing-whitespace findings.

## Evidence present

- focused four-file suite: 37/37 passed;
- ingestion report unit section: 13 files, 92 passed, 1 todo;
- `npm run build`: passed;
- source diagnostics on five P0 files: no diagnostics;
- dry-run plans: 3,564/12/12 planned, zero completed;
- exact broad pre/post comparison and four unresolved new failing files; and
- source/catalog evidence for cancellation, UsageCounter, public IDs, pools, indexes, and the absent log guard.

## Evidence absent / explicit blockers

- safe isolated benchmark database and any executed performance case;
- throughput/latency/CPU/RSS/heap/GC/WAL-event/trigger-cost improvement evidence;
- deployed/rehearsed migration 030;
- complete integration/load/chaos/kill/restart/failover evidence;
- strict worst-case memory proof;
- fleet-wide fairness evidence;
- crash/failover-safe usage reconciliation; and
- repository-wide no-new-failure isolation.

## Authorization boundary

This review supports treating the cancellation and UsageCounter work as correctness hardening. It does **not** authorize performance claims, production benchmark writes, migration 030 execution without clone rehearsal/approval, index/trigger/partition/queue changes, or pool/concurrency increases.

## Related documents

- [Evidence package index](README.md)
- [Forensic report](performance/forensic-report.md)
- [Acceptance plan](performance/acceptance-plan.md)
- [Migration 030 procedure](live-db-rollout/events-logs-identity.md)
- [Remaining bottlenecks](roadmap/remaining-bottlenecks.md)

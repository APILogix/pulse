# Ingestion acceptance plan

Status date: 2026-08-27.

## Current verdict

# BENCHMARK NOT EXECUTED

Correctness hardening has focused unit/build evidence, but overall production acceptance is **NOT MET**. Integration/load/chaos/failover, strict memory, complete billing durability, migration 030, and repository-wide no-new-failure gates remain open.

## Evidence already produced

| Area | Result | Acceptance interpretation |
| --- | --- | --- |
| Focused cancellation/admission/usage/registry suite | 37 passed | supports implemented race/error behavior |
| Repository ingestion report | 13 files, 92 passed, 1 todo | non-accepting because integration/load/chaos/failure evidence absent; report omits two separately run focused files |
| Build | passed | compile/build gate met |
| Lint | unavailable; ESLint undeclared/uninstalled | no dependency added; lint gate not run |
| Broad pre suite | 146 files; 134 pass/12 fail; 2,086 tests; 1,995 pass/90 fail/1 pending | baseline |
| Broad post suite | 147 files; 131 pass/16 fail; 2,100 tests; 2,005 pass/94 fail/1 pending | four new failing files outside ingestion; causality not isolated |
| Benchmark plans | 3,564/12/12 planned, 0 completed | plan-generation evidence only |
| Build artifacts/noise | generated `dist/` and report changes require surgical restoration | cleanup gate before completion |

Do not add “92 + 17” as a unique passing-test total without comparing file manifests; the focused files and report scopes differ.

## Correctness acceptance matrix

| Gate | Required evidence | Current status |
| --- | --- | --- |
| ACK only after COMMIT | transaction/settlement tests including expiry races | focused support; integration **UNMET** |
| Cancellation through fairness/admission/checkout/query/pre-COMMIT | race tests + isolated active-DB cancellation | unit support; real DB failure injection **UNMET** |
| Retry/redelivery convergence | duplicate/expiry/process-kill integration by type | **UNMET** |
| Typed/outbox atomicity | rollback/commit/outbox consumer failure tests | unit/source support; integration **UNMET** |
| Inserted-only billing | duplicate/partial/COMMIT-race reconciliation | focused support; crash/failover **UNMET** |
| UsageCounter flush ownership | concurrency/failure/stop tests | focused PASS |
| Usage durability | process-kill plus PostgreSQL restart/failover reconciliation | **UNMET** (memory + UNLOGGED gaps) |
| Tenant fairness | multi-process noisy-neighbor distribution/starvation test | **UNMET**; current fairness process-local |
| Memory | representative max jobs/bytes/trace/cardinality RSS/heap/GC | **UNMET** |
| Connections | sustained endpoint/pool samples under representative load | **UNMET** |
| Public IDs | defaults-before-trigger, explicit NULL/empty, retry/partition tests | static/catalog support; full integration **UNMET** |
| Gzip | valid/malformed/expanded-limit and memory tests | inbound support established; dedicated expanded cap **UNMET** |
| Log idempotency | migration 030 clone rehearsal/deployment + retry tests | **UNMET**; not live |
| Build | successful build | PASS |
| Lint | repository lint execution | **UNMET**; tooling unavailable |
| Repository no-new-failures | causal same-scope baseline/candidate comparison | **UNMET** |

## Performance acceptance matrix

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Safe isolated target | disposable non-production Primary + Log DB fingerprints | **BLOCKED** |
| Baseline and candidate | same protocol/topology/seed/config | **UNMET** |
| End-to-end worker path | HTTP → pg-boss → workers → Log DB → outbox/usage | **UNMET** |
| Throughput/latency | complete raw distributions/sample counts | **UNMET** |
| CPU/RSS/heap/GC | synchronized resource samples | **UNMET** |
| WAL/query/lock/trigger | per-case DB deltas and plans | **UNMET** |
| Queue drain/backpressure | sustained mixed arrival/drain runs | **UNMET** |
| Fairness | multi-process per-tenant results | **UNMET** |
| Cleanup | zero unauthorized residual rows/jobs | **UNMET** |
| Approved thresholds | preregistered SLO/capacity margins | **UNMET** |

No improvement percentage is authorized.

## Benchmark readiness sequence

1. Provision disposable isolated Primary and Log DB resources.
2. Harden child-command target assertions and record non-secret endpoint fingerprints.
3. Separate real worker, HTTP end-to-end, direct writer, DB forensic, and failure suites.
4. Reconcile test batch sizes with the 200-event normal gateway limit; label larger direct-writer stress cases.
5. Implement deterministic fixture reset and verified cleanup.
6. Preregister duration/repetitions/order/statistics/stop conditions and approved acceptance thresholds.
7. Run baseline, validate correctness/cleanup, recreate/reset environment, then run candidate.
8. Compare complete evidence; rerun only by documented protocol, never by cherry-picking favorable cases.

Required entrypoint remains `npm run bench:ingestion:matrix`.

## Root-cause/bottleneck matrix

| Evidence classification | Symptom | Root cause | Impact | Proof | Safe action | Acceptance gate/status |
| --- | --- | --- | --- | --- | --- | --- |
| MEASURED | no performance result | no isolated DB | production mutation/load risk | endpoint audit + dry-run completed=0 | provision disposable targets | benchmark / **BLOCKED** |
| MEASURED | no-new-failures not proven | four new failures in concurrently edited unrelated areas | causal regression unknown | exact pre/post manifests | isolate on stable tree or investigate owners | functional / **UNMET** |
| MEASURED | billing not crash-durable | post-COMMIT memory + UNLOGGED staging | undercount window | code/DDL review | durable/replayable accounting + failure tests | durability / **UNMET** |
| DERIVED | memory limit unknown | 80 delivered jobs normalize before 16 permits; trace copies | OOM/GC risk | source-derived envelope | representative load profiling | memory / **UNMET** |
| MEASURED | log retry guard absent | migration 030 not live | duplicate risk | catalog/migration record | clone rehearsal + approved drain rollout | idempotency / **UNMET** |
| MEASURED | trace payload amplification | full parent serialized per derived span | O(S²) copy/storage shape | writer source | compatibility-gated experiment | performance/API / **DEFERRED** |

## Final decision rule

The source changes may be described as correctness hardening with the exact tests above. They must not be described as production performance improvement or complete acceptance until every applicable gate is evidenced. Destructive schema/queue work and live benchmarks remain prohibited without explicit approval.

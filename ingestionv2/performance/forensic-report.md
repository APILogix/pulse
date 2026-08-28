# Ingestion write-path forensic report

Status date: 2026-08-27

# BENCHMARK NOT EXECUTED

**UNVERIFIED:** No ingestion workload benchmark was executed. No events/second, MB/second, p50/p95/p99/p99.9, CPU, memory, WAL/event, trigger cost, queue-drain, tenant-fairness, or before/after improvement result is claimed.

**MEASURED:** Only production-labelled database endpoints were available. Processor mode commits; rollback-mode writer runs still execute SQL, generate WAL/dead tuples/statistics effects, and consume non-transactional sequence values. Running either against production would be unsafe.

## Evidence inventory

| Classification | Evidence | Result |
| --- | --- | --- |
| **MEASURED** | `schema-audit-before.json` | Recorded PostgreSQL 18.6 catalog/statistics snapshot dated `2026-08-27T06:31:07.626Z`. |
| **MEASURED** | `runtime-baseline-idle.json` | Three idle samples over 2.474 seconds; not workload evidence. |
| **MEASURED** | `benchmark-acceptance-plan.json` | 3,564 planned, 0 completed, `dryRun=true`. |
| **MEASURED** | `pre-change-benchmark-plan.json` | 12 planned, 0 completed. |
| **MEASURED** | `post-change-benchmark-plan.json` | 12 planned, 0 completed. |
| **MEASURED** | `post-change-test-report.md` | 13 focused files, 92 tests passed, 1 todo; integration/load/chaos/failure evidence absent. |
| **MEASURED** | Final four-file cancellation/usage run | 37 tests passed. |
| **MEASURED** | `npm run build` | Passed. |
| **MEASURED** | Broad pre/post JSON results | Same-scope file/assertion comparison recorded below. |
| **UNKNOWN** | Executed isolated baseline/candidate matrix | Not present. |

## Active path and audit conclusion

**MEASURED:** The deployed import path is API gateway → pg-boss → dedicated ingestion worker → fairness → write admission → Log DB transaction → outbox → COMMIT → post-COMMIT usage → pg-boss completion. Legacy `ingestion_jobs`, `PgQueue`, `ingestion-job-handler.ts`, and `telemetry-writer.legacy.ts` are not imported by the production ingestion worker.

**MEASURED:** ACK ordering, stable retry identity inputs, inserted-only billing, transactional outbox, process-local fairness, and public-ID mechanisms remain in place after the changes. Typed conflict guards remain where deployed; the audited `events_logs` lookup is non-unique and migration 030's intended scoped guard was not executed, so complete log retry idempotency is not accepted.

## Implemented highest-impact safe fixes

| Priority | Classification | Pre-change risk | Change | Performance status |
| --- | --- | --- | --- | --- |
| P0 | **MEASURED/DERIVED** | pg-boss expiry raced the callback but application work ignored the delivered signal; expired work could continue holding permits/connections and overlap a retry. | Threaded `job.signal` through registry, fairness, admission, checkout, processor, active-query cancellation, rollback, and pre-COMMIT check. | Correctness hardening; effect **UNMEASURED**. |
| P0 | **MEASURED/DERIVED** | `UsageCounter`'s boolean flush guard was not authoritative before awaited schema setup; shutdown could fail to await/retry a full drain. | Added authoritative `flushPromise`, coalesced trailing drain, exact merge-back, caught background rejection, and honest stop failure. | Correctness hardening; effect **UNMEASURED**. |

### Cancellation safety details

- **MEASURED:** queued aborted admission waiters are synchronously removed; acquire/continuation races release permits.
- **MEASURED:** late pool checkout after cancellation is released asynchronously.
- **MEASURED:** an active target backend is cancelled through `pg_cancel_backend(processID)` from reserved pool headroom while the target connection remains held; rollback precedes release.
- **MEASURED:** post-abort queries are rejected except `ROLLBACK`.
- **MEASURED / PARTIAL:** a successful COMMIT at the expiry boundary still runs inserted-only usage accounting; redelivery converges where a typed unique guard is deployed, excluding the current log gap.

### UsageCounter residual risk

- **DERIVED:** process crash after telemetry COMMIT and before staging can lose usage.
- **DERIVED:** `UNLOGGED usage_counter_staging` can lose staged rows on PostgreSQL restart/failover before rollup.
- **DERIVED:** distinct-key cardinality may exceed `bufferLimit` during prolonged database failure; overflow is retained/logged instead of silently dropped.
- **MEASURED:** `WorkerRegistry.stop()` catches/logs processor stop failure, so supervisor-visible shutdown durability remains imperfect.

## Worker, fairness, and memory model

| Classification | Finding |
| --- | --- |
| **MEASURED** | Default deployment has one ingestion process. |
| **DERIVED** | Ten typed queues × `localConcurrency=2` × `batchSize=4` = up to 80 fetched/active typed jobs per process. |
| **DERIVED** | DLQ intake can add up to 20 delivered jobs; usage rollup adds one worker execution. |
| **MEASURED** | Normal gateway jobs are capped at 200 events, about 1 MiB serialized event data, and 256 KiB/event. |
| **DERIVED** | Typed raw-payload envelope is about 80 MiB/process; normal-path DLQ can add about 20 MiB before job metadata, normalized copies, trace clones, SQL arrays/strings, and transient serialization. |
| **UNKNOWN** | Total RSS/heap and worst-case trace amplification were not measured. A strict worst-case bound is not proven. |
| **MEASURED** | All typed handlers normalize before the 16-permit DB gate; at default delivery, up to 64 can wait for admission. The waiter count is delivery-bounded, not an unbounded in-process queue. |
| **DERIVED** | Usage-map cardinality is the remaining unbounded-in-failure in-process component when new keys continue during a prolonged staging outage. |
| **MEASURED** | Fairness limits are per process (free 2, starter 4, growth 8, business 16, enterprise 24), defer up to five times for two seconds, then admit to prevent starvation. |
| **UNKNOWN** | Fleet-wide fairness; no pg-boss `groupConcurrency` or cross-process coordinator is used. |
| **MEASURED** | Queue depth is cached/refreshed at about three seconds; high/critical shedding thresholds are 100k/250k. No hard queue capacity exists, and high-urgency traffic can continue at critical depth. |
| **MEASURED** | `IngestionRateLimiter`, organization/project rate settings, and `API_MAX_CONCURRENCY` are not applied to this path; per-tenant enqueue/API concurrency is not structurally bounded. |

## Database/catalog observations

| Classification | Observation |
| --- | --- |
| **MEASURED** | 209 parent-level indexes across 15 present ingestion relations in the recorded snapshot. |
| **MEASURED** | 12 triggers and 11 default partitions. Default partitions contained existing data; no blind partition rollout is authorized. |
| **MEASURED** | Recorded parent/child storage: 67,960,832 table bytes and 36,208,640 index bytes. |
| **MEASURED** | TOAST was concentrated in `events_spans_default` (9,158,656 bytes) and `events_traces_default` (5,046,272 bytes). |
| **MEASURED** | `statsResetAt` was null; no bounded index-usage observation window exists. |
| **MEASURED** | Six exact catalog duplicate pairs exist: `error_group_history` group/time; `events_errors` org/project/environment/time; `events_logs` same; `events_messages` org/project/time; partial `events_spans` db-system/time; `events_traces` org/project/time. |
| **MEASURED** | Additional semantic redundancy exists for `error_groups` project/fingerprint non-unique vs unique indexes and status-seen v1 vs v2. |
| **MEASURED** | No index was dropped in this audit. Prior migrations 025/028/029 contain 24 historical removals confirmed absent; that is history, not new authorization. |
| **MEASURED** | All ten typed parents and `error_groups` have NOT NULL sequence-backed public-ID defaults; sequences were `CACHE 1` and not `OWNED BY` columns. |
| **MEASURED** | Defaults run before BEFORE triggers, so an ordinary omitted-ID insert consumes one default `nextval`; the trigger sees a value and does not consume another. The trigger remains required for explicit NULL/empty IDs and metadata/payload repair. |
| **UNKNOWN** | Trigger time and sequence contention under load. |

## Connection capacity

| Classification | Capacity |
| --- | --- |
| **MEASURED** | Recorded server limit: `max_connections=901`, 0 reserved, 6 superuser-reserved on the queried PostgreSQL 18.6 endpoint. |
| **DERIVED** | Conditional usable slots: 895 before provider/operational headroom. |
| **DERIVED** | Static default fleet ceilings: Primary 97, Log primary 84, Log replica 60. |
| **MEASURED** | Idle audit observed 10/10/11 sessions on the three distinct configured endpoints. |
| **UNKNOWN** | Peak sessions, provider compute limit, CPU, and endpoint behavior under workload. |

**DERIVED:** no pool or worker-concurrency increase is authorized without simultaneous backend, CPU, checkout/admission wait, memory, queue-drain, and fairness evidence.

## SQL and write-amplification findings

| Rank | Classification | Finding | Safe disposition |
| ---: | --- | --- | --- |
| 1 | **UNKNOWN** | Runtime bottleneck rank is unknowable without a workload. | Execute isolated baseline/candidate matrix. |
| 2 | **DERIVED** | Every derived trace span stores `payloadFor(parentTrace)`, creating O(S²) structural payload serialization/storage as span count grows. | **DEFERRED:** analytics unified search uses span `payload::text`; current-span-only payload changes semantics. Require contract/feature gate and measurements. |
| 3 | **DERIVED** | Merged error-group fallback remains approximately `3N + constants/merge hops`; clearest statement-count O(N) path. | Measure merge frequency before batching changes. |
| 4 | **DERIVED** | Partial-duplicate non-error batches send the full scoped list to outbox reservation if at least one typed row inserts. | Measure duplicate-heavy SQL/WAL; filter only after every writer returns inserted identities. |
| 5 | **DERIVED** | Fairness deferral writes a replacement pg-boss row before completing the source job. | Measure deferral rate and Primary WAL; retain durability ordering. |
| 6 | **MEASURED/DERIVED** | `TelemetryMaintenanceWorker` uses the primary DB and legacy unprefixed table names while active telemetry tables are `events_*` in Log DB. | Correct topology only with read-only preflight and separate reviewed change; no live correction performed. |

**MEASURED:** generic non-error typed writes are set-based and bind-safe. Trace-derived spans flush at `floor(65,535/67)=978` rows. All-duplicate non-error batches skip outbox work.

## Benchmark planning only

| Artifact | Planned | Completed | Meaning |
| --- | ---: | ---: | --- |
| Acceptance matrix | 3,564 | 0 | Command/workload plan only. |
| Pre-change smoke | 12 | 0 | Dry-run command generation only. |
| Post-change smoke | 12 | 0 | Dry-run command generation only. |

The post-change command was the mandated `npm run bench:ingestion:matrix -- --dry-run ...`; `passed=true` means plan generation succeeded, not that performance passed.

## Validation results

### Focused and build

| Classification | Check | Result |
| --- | --- | --- |
| **MEASURED** | `event-processor.test.ts` | 11 passed. |
| **MEASURED** | `write-admission.test.ts` | 12 passed. |
| **MEASURED** | `usage-counter.test.ts` | 5 passed. |
| **MEASURED** | `worker-registry.test.ts` | 9 passed. |
| **DERIVED** | Final four-file total | 37 passed. |
| **MEASURED** | Repository ingestion report | 13 files, 92 passed, 1 todo; report non-accepting only because integration/load/chaos/failure-scenario evidence was absent. |
| **MEASURED** | Additional report-omitted files | write-admission + UsageCounter contain 17 passing tests; not arithmetically combined with 92 without a de-duplicated manifest. |
| **MEASURED** | Production build | `npm run build` passed. |
| **UNVERIFIED** | Lint | Unavailable: ESLint is undeclared/uninstalled; no dependency was added. |

### Broad same-scope comparison

| Metric | Pre-change | Post-change | Delta |
| --- | ---: | ---: | ---: |
| Files total | 146 | 147 | +1 |
| Files passed | 134 | 131 | -3 |
| Files failed | 12 | 16 | +4 |
| Tests total | 2,086 | 2,100 | +14 |
| Tests passed | 1,995 | 2,005 | +10 |
| Tests failed | 90 | 94 | +4 |
| Tests pending | 1 | 1 | 0 |

Four new failing files were `alerting-decision-engine.test.ts`, `alerting-engines-redis-integration.test.ts`, `analytics-engine-read.test.ts`, and `modules/project-environment-routes.test.ts`. They are outside ingestion and coincide with concurrent unrelated source edits. This does not prove ingestion causality, but it also does not satisfy a repository-wide no-new-failures gate.

## Phase-19 acceptance matrix

| Criterion | Status | Evidence/blocker |
| --- | --- | --- |
| Correctness | **MET scoped** | Focused suites pass; independent code review approved with no blocker/high finding. |
| Tests | **PARTIAL** | Changed suites pass; broad repository scope has failures. |
| No new failures | **UNMET** | Four new broad failures; dirty concurrent tree prevents causal isolation. |
| Telemetry durability | **MET focused/static** | cancellation→rollback and COMMIT→ACK ordering covered. |
| Idempotency | **PARTIAL / UNMET for logs** | Stable identity/conflict behavior covered where a unique guard exists; audited log lookup is non-unique and migration 030 was not executed. |
| Fairness | **MET process-local / UNKNOWN fleet-wide** | Existing ordering retained; no multi-replica test. |
| Public IDs | **MET catalog/source** | Mechanisms unchanged. |
| Outbox | **MET focused/static** | Same transaction; all-duplicate skip. |
| Billing | **PARTIAL** | Inserted-only + flush concurrency corrected; crash/failover durability unresolved. |
| Retry safety | **PARTIAL / UNMET for logs** | aborts fail for retry and no false pre-COMMIT completion; post-COMMIT log redelivery convergence lacks the scoped unique guard. |
| Memory bounded | **UNMET strict gate** | normal envelope derived; total RSS and failure cardinality not bounded/measured. |
| DB connection ceiling safe | **PARTIAL** | static math safe; peak/provider/load evidence absent. |
| Worker concurrency bounded | **MET per process** | 80 typed, 20 DLQ, 16 DB writes under defaults. |
| Benchmark improvement | **UNMET** | **BENCHMARK NOT EXECUTED**. |

## Explicitly unmet additional evidence criteria

- before/after throughput and latency comparison;
- complete live INSERT/WAL/EXPLAIN evidence;
- full index A–F classification over a bounded observation window;
- live migration 030 execution or clone rehearsal;
- live partition-maintenance correction;
- strict worst-case memory bound under all DB failure modes;
- repository-wide no-new-failures result.

## Final verdict

**PARTIALLY ACCEPTED FOR CORRECTNESS HARDENING, NOT ACCEPTED AS A PERFORMANCE OPTIMIZATION.** The cancellation and UsageCounter fixes have focused correctness and build evidence and preserve the required write-path invariants. Production performance acceptance remains blocked.

# BENCHMARK NOT EXECUTED


## Phase-23 required answers

1. **What was slow?** **UNVERIFIED.** No workload ran, so no runtime component is proven slow. Source-derived candidates are trace payload replication, merged-group fallback, partial-duplicate outbox work, duplicate index maintenance, and ineffective maintenance topology.
2. **Why was it slow?** Not measurable yet. Structural causes for those candidates are respectively O(S²) copied parent payload, O(N) per-event fallback, processing duplicate inputs through reservation SQL, maintaining redundant index pairs, and querying the wrong DB/table namespace.
3. **What exact SQL caused it?** No SQL is proven to cause observed latency. Candidate shapes are `INSERT INTO events_spans ...`, per-event group `INSERT` + `SELECT ... FOR UPDATE` + `UPDATE`, `WITH input AS (SELECT * FROM UNNEST(...)), reserved AS (INSERT INTO alert_runtime_idempotency_keys ... ON CONFLICT DO NOTHING ...) INSERT INTO telemetry_outbox ...`, and typed-table INSERT index maintenance.
4. **What exact code called it?** `TelemetryWriter.buildTraceSpanRow()`/`payloadFor()`, `ErrorIngestionService.ingestBatch()` → `ErrorGroupingService.handleGroup()`, `appendTelemetryOutbox()`, typed writer `buildInsert()` paths, and `TelemetryMaintenanceWorker`.
5. **How often does it execute?** Derived-span payload work runs once per derived span; the group fallback runs once per inserted event only after the merged-group sentinel; mixed-duplicate outbox work occurs when a non-error batch has both inserted and duplicate rows; index maintenance occurs per affected row; production frequencies are unknown.
6. **What resource does it consume?** Candidate resources are Node CPU/heap/temporary strings, network bytes, DB round trips/locks/CPU, table/TOAST/index bytes, WAL, connections, and transaction wall time. Per-candidate quantities are unmeasured.
7. **What was changed?** Cooperative cancellation was threaded end to end with retained-client PostgreSQL cancellation/rollback; UsageCounter gained authoritative single-flight flush, trailing drain, exact merge-back, and honest stop rejection.
8. **Why is the change safe?** Focused tests cover queued/acquire/checkout/query/COMMIT cancellation races and flush concurrency/failure/stop behavior; ACK remains after COMMIT, outbox remains transactional, billing remains inserted-only, retries fail incomplete work, and public-ID/fairness mechanisms were not removed.
9. **What improved?** Demonstrated correctness behavior improved: expired work can now be cooperatively stopped and concurrent/final usage drains have an authoritative result. Throughput, latency, CPU, memory, WAL/event, and queue drain improvement are **UNKNOWN**.
10. **What remains slow?** No component is measured slow. The structural candidates above, strict memory bound, usage durability, maintenance mismatch, and missing live log identity guard remain unresolved.
11. **What should NOT be changed?** Do not weaken synchronous durability/ACK order, outbox atomicity, inserted-only billing, retry identity, fairness, or public IDs; do not drop indexes/triggers, alter partitions/queues, or raise pools/concurrency without isolated evidence and approval.
12. **What should be optimized next?** First provision an isolated target and measure the real path. In parallel, close correctness gaps: durable/replayable usage accounting and clone-rehearsed log idempotency. Experiment with trace current-span payload only behind an explicit search/API compatibility contract.

## Phase-23 root cause matrix

| ROOT CAUSE | EVIDENCE | SOURCE FILE | FUNCTION | SQL | FREQUENCY | RESOURCE | LATENCY IMPACT | CONFIDENCE | FIX | STATUS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Expired callbacks previously did not stop ingestion work | installed pg-boss signal semantics + pre-change source + focused races | `worker-registry.ts`, `event-processor.ts`, `write-admission.ts`, `ingestion-abort.ts` | `runOne`, `process`, `run`, abort guard | active statement plus `SELECT pg_cancel_backend($1)::boolean` for cancellation | only on expiry/stop abort; rate unknown | permits, clients, DB CPU, overlap | unmeasured | High structural/test | propagate signal; retain target client through cancel/rollback | **IMPLEMENTED; performance unmeasured** |
| Usage flush ownership/shutdown race | pre-change boolean ownership; deterministic failure/concurrency tests | `usage-counter.ts` | `flush`, `flushOnce`, `stop` | staging DDL/INSERT and rollup SQL | timer, threshold, explicit flush, stop | billing durability, heap, DB writes | unmeasured | High | authoritative promise, trailing drain, exact merge-back | **IMPLEMENTED; crash gaps remain** |
| Full trace copied into every derived span payload | direct writer call graph; unified search scans payload text | `telemetry-writer.ts`, `analytics/repository.ts` | `buildTraceSpanRow`, `payloadFor` | `INSERT INTO events_spans ...` | once per derived span | CPU, heap, wire, table/TOAST, WAL | unmeasured | High structural | versioned current-span/search experiment | **DEFERRED for compatibility** |
| Merged error groups force per-event grouping | explicit sentinel/catch and loop | `error-ingestion.service.ts` | `ingestBatch` → `handleGroup` | per-event group INSERT, `SELECT ... FOR UPDATE`, UPDATE | only merged-group fallback; production rate unknown | round trips, locks, DB CPU | unmeasured | High structural | set-based merge-chain resolution after measuring frequency | **OPEN** |
| Mixed non-error duplicates enter outbox reservation input | source/reviewer finding | `event-processor.ts`, `telemetry-writer.ts` | process write result / `appendTelemetryOutbox` | `UNNEST` input + idempotency reservation + outbox INSERT | mixed duplicate batch with ≥1 insert | SQL CPU/conflicts/WAL | unmeasured | Medium-high | derive inserted non-error identities if measured beneficial | **OPEN** |
| Exact/semantic duplicate indexes add write maintenance | live catalog signatures; stats window insufficient | Log DB catalog/migrations | PostgreSQL index maintenance | typed INSERT/UPDATE index maintenance | every affected row | CPU, buffers, storage, WAL | unmeasured | High existence / low cost rank | bounded observation + query-plan/necessity review before drop | **NO REMOVAL AUTHORIZED** |
| Maintenance worker targets Primary and legacy names | constructor/topology/source audit | maintenance worker/bootstrap | scheduled maintenance methods | partition/retention SQL against unprefixed names | scheduled frequency; effective successful work unknown | ineffective operations/connections | unmeasured | High structural | reviewed Log DB/events_* correction with preflight | **OPEN; no live change** |
| Intended log retry unique guard is absent | catalog shows non-unique lookup; migration 030 not run | `telemetry-writer.ts`, migration 030 | `writeLogs` | `INSERT INTO events_logs ... ON CONFLICT DO NOTHING` without intended scoped unique index | every duplicate/redelivered log can be affected | correctness, rows, outbox/usage side effects | not a latency claim | High | clone-rehearse and approve drain-gated migration 030 | **UNMET / NOT DEPLOYED** |

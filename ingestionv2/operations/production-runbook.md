# Production ingestion runbook

Status date: 2026-08-27.

## Non-negotiable invariants

- HTTP `202` means gateway admission finished; only the reported accepted events crossed an awaited durable pg-boss enqueue boundary.
- A source job succeeds only after durable Log DB COMMIT, or after the fairness path has durably enqueued its replacement.
- Typed rows and transactional outbox commit or roll back together.
- Billing uses rows actually inserted, not rows received.
- Retries must preserve receipt time, identity, public-ID behavior, and conflict scope.
- Never increase pools/concurrency, remove indexes/triggers, rebuild queues, or run production load tests from this runbook without separate evidence/approval.

# BENCHMARK NOT EXECUTED

## Startup checks

Expected order:

1. connect required Primary/queue and Log DB resources;
2. when `LOG_DB_AUTO_MIGRATE=true`, run Log DB migrations in unattended `automatic` mode: apply ordinary safe files and defer files marked `requires-operator-drain`;
3. log each deferred filename and continue startup without executing that file's SQL or inserting its ledger row;
4. start pg-boss;
5. construct the dedicated Log DB write pool and 16-permit admission gate;
6. provision/register typed, DLQ, and usage-rollup workers; and
7. start metrics/health endpoints and UsageCounter scheduling.

Verify logs/config for both database endpoints, migration mode, queue provisioning, one intended registry per process, write-pool/admission sizes, and reachable `/healthz`/`/metrics`. Effective production overrides are unknown until captured.

### Operator-required migration pending

For migration 030, these warnings are expected after the fixed build is deployed:

- `Operator-drained Log DB migration deferred during automatic startup`; and
- `Operator-drained Log DB migrations remain pending; continuing ingestion worker startup`.

They mean the worker did **not** run the duplicate scan, index DDL, or ledger insert, and should continue to `Ingestion worker process started`. The scoped log unique guard remains absent until the dedicated rollout is completed, so log retry idempotency remains partial.

Do not set `PGOPTIONS` on the normal worker process and do not make automatic mode bypass the marker. Production runs `dist/shared/workers/ingestion-worker-main.js`; run `npm run build`, deploy the resulting build, then restart/reload ingestion workers. If the old `55000` fatal startup log remains, the process is still running an old build or invoking the explicit operator path.

`LOG_DB_AUTO_MIGRATE=false` disables all startup migrations; use it only when an external deployment step owns every Log DB migration.

## Shutdown checks

`WorkerRegistry.stop()` stops process-local workers without unscheduling the cluster-shared rollup schedule, then invokes processor/UsageCounter stop. The UsageCounter now joins any active flush, requests a trailing drain, retries re-buffered data, and rejects if the final drain fails.

**Important:** the registry currently catches/logs processor-stop failure (`usage counter drain failed`). Supervisor-visible shutdown success is therefore not proof that final usage persisted. Operators must treat that log as a billing incident and preserve process/DB evidence.

The default PM2 kill window is shorter than the default per-statement timeout. Active pg-boss abort propagation improves expiry/shutdown behavior, but no end-to-end shutdown bound was proven.

## Cancellation/expiry behavior

One pg-boss v12.22 callback batch shares one `AbortSignal`. It is threaded through fairness, write admission, pool checkout, transaction queries, and the pre-COMMIT check.

On abort:

- queued admission waiters are synchronously removed;
- acquire/continuation races release permits;
- a late checkout is released;
- an active backend is targeted with `pg_cancel_backend`;
- the target client remains checked out through cancellation and rollback, avoiding PID-reuse cancellation; and
- post-abort statements reject except rollback.

If COMMIT reports success during an expiry race, inserted-only usage still runs before successful settlement. If COMMIT does not succeed, rollback/retry remains authoritative.

## Primary triage signals

Read these together; thresholds are **TBD** until tied to SLO/workload evidence:

| Signal | Interpretation |
| --- | --- |
| `ingest_write_admission_{permits,in_flight,queued,queued_peak}` | Process-local transaction admission pressure. |
| `ingest_stage_latency_ms{stage="write_admission_wait"...}` / checkout stage | Separate pre-pool contention from pool wait. Confirm exact stage labels from emitted metrics. |
| `ingest_db_pool_connections{pool,state}` | Total/idle/in-use/waiting pool state. |
| `ingest_queue_depth_*`, oldest pending age | Backlog quantity and age; aggregate depth alone can hide one stuck queue. |
| jobs failed/retried and failure-reason counters | Retry pressure and failure classes. |
| fairness defer/starvation-guard counters | Process-local fairness behavior, not fleet-wide fairness. |
| error merge-fallback counters | Detect the retained O(N) grouping fallback. |
| rollup runs/failures/last-run metrics | Rollup health; not proof against pre-staging or UNLOGGED loss. |
| process RSS/heap/GC/CPU | Required externally; strict memory bound remains unproven. |

## Incident playbooks

### Backlog or latency growth

1. Split backlog by queue/state and inspect oldest age.
2. Compare admission queue, pool waiting, in-use connections, lock waits, and per-query timing from the same interval.
3. Check failure/retry and fairness counters by queue/type.
4. Capture process RSS/heap/GC/CPU and effective configuration.
5. Do **not** raise permits, callback batch size, local concurrency, or pool size without isolated reproduction and fleet connection arithmetic.

### Cancellation/expiry failures

1. Capture queue/job IDs, shared callback batch, signal reason/time, backend PID, active-query phase, COMMIT result, rollback result, and settlement outcome.
2. Check for jobs that continued after abort, pool clients not released, or usage omitted after a reported successful COMMIT.
3. Keep retries enabled; do not ACK manually.
4. Reproduce only on an isolated database with expiry/failure injection.

### DLQ growth

Separate gateway response rejects from worker validation rejects persisted via `ingest.dlq-intake` and source jobs exhausted by pg-boss. Classify before bounded replay. Preserve org/project/environment/type/receipt identity. Never replay-all without backlog, DB, and billing controls.

### Usage/billing discrepancy

Distinguish two residual windows:

1. process crash after telemetry COMMIT but before successful staging (in-memory counts can be lost); and
2. PostgreSQL restart/crash recovery/failover after staging but before rollup (`usage_counter_staging` is UNLOGGED).

A flush interval is not a strict maximum loss window during DB failure. Preserve telemetry counts, staging/rollup state, flush errors, shutdown logs, and restart/failover times. No complete replay/reconciliation source was established.

### Migration/index work

Use only the Log DB runner and first review its dry-run behavior:

```powershell
npm run db:migrate:logdb -- --dry-run
```

Dry-run still connects, attempts the shared fail-fast advisory lock, may ensure the ledger table, and reads ledger state; it does not execute migration-file drain/duplicate checks or DDL. Migration 030 was not executed. Follow [the dedicated rollout guide](../live-db-rollout/events-logs-identity.md); default partitions contain data, so never infer safety from an empty parent.

### Queue drift

`npm run ingestion:queues:rebuild` defaults to inspection/dry-run. Do not use execution/force-delete modes without a full drain plus archive/replay plan. Retained queue rows made unattended rebuild unsafe in this audit.

## Relevant defaults (verify overrides)

| Control | Repository default |
| --- | ---: |
| typed queue local concurrency / callback batch | 2 / 4 |
| typed jobs potentially fetched/active per process | 80 |
| Log write pool / admission permits | 20 / 16 |
| lock / statement / idle-in-transaction timeout | 2 s / 60 s / 30 s |
| pg-boss expiry / retries / base retry delay | 300 s / 3 / 5 s |
| usage flush interval | 30 s |
| `INGESTION_GZIP_MAX_BYTES` | declared but unused by active enforcement |

## Root-cause matrix

| Evidence | Symptom | Root cause | Impact | Proof | Safe action | Gate/status |
| --- | --- | --- | --- | --- | --- | --- |
| MEASURED | Aborted SQL continues unless actively interrupted | Node abort alone cannot cancel PostgreSQL | overlap/redelivery risk | cancellation source/tests | retained-client backend cancel + rollback | focused tests pass |
| DERIVED | Usage undercount after process crash | post-COMMIT in-memory window | billing loss | transaction/flush order | durable/replayable accounting | **UNMET** |
| MEASURED | Staged usage disappears on DB recovery | UNLOGGED staging | billing loss | staging DDL semantics | evaluate logged staging + recovery tests | **UNMET** |
| MEASURED | Shutdown can look successful after drain failure | registry catches processor-stop rejection | hidden billing risk | registry source | surface failure to supervisor | **UNMET** |
| DERIVED | Memory pressure before permits | 80 typed jobs normalize before 16 permits; trace copies | OOM/GC latency | source-derived envelope | load profile; move/bound work only with evidence | **UNMET** |
| MEASURED | Log retries lack intended scoped guard | migration 030 not live | duplicate log risk | catalog/migration disposition | clone rehearsal + approved drain rollout | **UNMET** |

## Acceptance status

| Gate | Status | Evidence |
| --- | --- | --- |
| Focused cancellation/admission/usage/registry behavior | PASS | 37 tests |
| Ingestion unit report | PARTIAL | 92 passed, 1 todo; integration/load/chaos/failure evidence absent |
| Build | PASS | `npm run build` |
| Repository-wide no-new-failures | **UNMET** | pre 12 failing files vs post 16; four unrelated-file failures not causally isolated |
| Strict memory bound/load profile | **UNMET** | no representative RSS/heap run |
| Billing crash/failover durability | **UNMET** | residual memory + UNLOGGED windows |
| Live performance comparison | **UNMET** | **BENCHMARK NOT EXECUTED** |
| Migration 030/partition maintenance | **UNMET** | not executed or clone-rehearsed |

## Forbidden unattended actions

No production benchmark, telemetry deletion/deduplication, trigger/public-ID change, index drop, partition migration, queue rebuild, concurrency/pool increase, migration-lock bypass, shared rollup unschedule, or pre-COMMIT source-job ACK.

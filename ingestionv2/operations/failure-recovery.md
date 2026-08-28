# Failure recovery

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

No load/chaos/failover recovery procedure below has been certified on an isolated representative environment.

## Job expiry and cooperative cancellation

pg-boss v12.22 shares one `AbortSignal` among jobs delivered in one callback batch. Current code propagates it through fairness, write admission, checkout, active transaction queries, and immediately before COMMIT.

| Phase at abort | Expected recovery |
| --- | --- |
| Fairness/admission wait | waiter removed/rejected; no DB work; job fails for retry. |
| Pool checkout | abort wins, or late client is immediately released. |
| Active query | `pg_cancel_backend(targetPid)` is requested; target client stays held until cancellation and rollback finish. |
| Before COMMIT | abort check throws; transaction rolls back. |
| COMMIT returns failure/ambiguous error | fail settlement; investigate DB outcome; retry/idempotency is required. |
| COMMIT reports success during race | treat telemetry as durable; run inserted-only usage; then settle success. |

Post-abort statements are rejected except `ROLLBACK`. Do not release the target client before cancellation/rollback, because backend PID reuse could target unrelated work.

A hard process crash is different: PostgreSQL should roll back an open transaction when the connection closes, while pg-boss redelivers after its recovery/expiry semantics. This has not been kill-tested here.

## Retry/idempotency recovery

Typed retries depend on stable receipt-derived occurrence time, stable event identity, conflict guards, transactional outbox reservation, and inserted-only accounting. Errors identify inserted rows via `RETURNING`; non-errors use command-tag row count. Partial-duplicate non-error batches can still amplify outbox conflict work.

The intended five-column log identity guard in migration 030 was not deployed, so log retry convergence remains an explicit rollout gap rather than a proven live invariant.

## UsageCounter recovery

Implemented graceful-path behavior:

- one authoritative `flushPromise` owns an active flush;
- concurrent callers join it;
- `flushRequested` triggers a trailing drain for replacement-buffer data;
- schema/staging/rollup failures merge the snapshot back exactly once and reject;
- timer/threshold callers log caught rejections; and
- `stop()` joins active work, retries re-buffered data, and rejects if final drain fails.

Residual failure windows:

| Window | Consequence | Recovery status |
| --- | --- | --- |
| telemetry COMMIT → successful usage staging | process crash can lose in-memory counts; retry dedup does not reconstruct billing | no replay/reconciliation source established |
| staged → rollup | app restart alone normally preserves rows, but PostgreSQL restart/crash recovery/failover can lose UNLOGGED staging | no proven recovery source |
| prolonged DB failure | map cardinality can exceed the threshold because it triggers flush rather than enforcing a cap | monitor memory; no strict bound |
| graceful processor stop rejects | registry catches/logs the rejection | supervisor may not see failure; treat log as incident |

Do not call the 30-second flush interval a strict maximum loss window.

## Validation/DLQ recovery

Worker normalization rejects are durably copied to `ingest.dlq-intake`; failure to copy causes the source attempt to fail rather than silently ACK. Valid siblings can persist. Gateway rejects are response data and never entered the worker DLQ path.

Replay only a bounded reviewed selection. Preserve organization/project/environment/type plus original receipt/identity inputs, and monitor queue/DB/billing pressure during replay.

## Database and migration recovery

- connection/query/lock failures roll back and remain retryable unless classified as permanent input failure;
- do not disable synchronous commit or timeouts during incidents;
- capture `pg_stat_activity`, locks, pool state, SQLSTATE, queue/job, phase, and transaction outcome together;
- migration 030 drain/duplicate/lock failures should leave its transaction unapplied; verify index and ledger state before retry; and
- never bypass the repository's shared advisory lock or mutate default partitions ad hoc.

No index, trigger, partition, or queue mutation was executed in this audit.

## Root-cause matrix

| Evidence | Symptom | Root cause | Impact | Proof | Safe action | Gate/status |
| --- | --- | --- | --- | --- | --- | --- |
| MEASURED | expiry while SQL runs | callback signal must cross node-postgres boundary | overlapping work/redelivery | source + focused tests | backend cancellation while retaining client | focused PASS |
| DERIVED | count missing after durable telemetry | usage is post-COMMIT/process-local before staging | underbilling | ordering review | transactional/replayable accounting | **UNMET** |
| MEASURED | staging empty after DB restart/failover | table is UNLOGGED | underbilling | DDL semantics | logged staging + recovery rehearsal | **UNMET** |
| MEASURED | graceful shutdown hides final drain error | registry catches processor-stop rejection | false success | registry source | propagate supervisor failure | **UNMET** |
| UNVERIFIED | recovery at process/DB kill points | no failure injection run | unknown duplicate/loss windows | missing evidence | isolated kill/restart/failover suite | **UNMET** |

## Acceptance status

| Gate | Status | Evidence |
| --- | --- | --- |
| Cancellation unit behavior | PASS | focused four-file suite: 37 passed |
| Build/type emit | PASS | `npm run build` |
| Retry/idempotency integration | **UNMET** | integration entrypoint skipped/todo |
| Crash/restart/failover | **UNMET** | not executed |
| Billing reconciliation | **UNMET** | no replayable source |
| Load/chaos recovery | **UNMET** | no isolated workload database |

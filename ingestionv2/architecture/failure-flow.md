# Failure flow

Status date: 2026-08-27. This page distinguishes gateway rejection, durable validation DLQ, retryable processing failure, and post-COMMIT accounting risk.

## Failure classes and settlement

| Classification | Failure class | Settlement |
| --- | --- | --- |
| **MEASURED** | Gateway validation/backpressure reject | Synchronous HTTP result; no source queue row and no worker-DLQ row. |
| **MEASURED** | Worker normalization reject | Await one `ingest.dlq-intake` send for rejected items. Valid items in the same source job can continue. If all are rejected, the source can complete after the DLQ copy is durable. |
| **MEASURED** | Validation-DLQ send failure | Source job throws/fails so pg-boss retries; reject data is not silently lost. |
| **MEASURED** | Processing/DB exception before COMMIT | Cancel active query if abort-driven, rollback best-effort, release client, fail job for retry. |
| **MEASURED** | Cooperative expiry/shutdown abort | Stable `INGESTION_JOB_ABORTED`; classified `job_aborted`; incomplete work is not acknowledged. |
| **MEASURED** | Mixed callback outcomes | `perJobResults=true` lets pg-boss settle jobs individually. |
| **MEASURED** | Every job in callback fails | Registry throws one aggregate callback error; retry preserved but individual diagnostics can be reduced. |
| **MEASURED** | Retry exhaustion | pg-boss dead-letter route targets `ingest.dlq-intake`; intake persistence has its own retry budget. |

Default source policy recorded in source: 3 retries, exponential backoff with 5-second base delay, and 300-second handler expiry.

## Cancellation flow

```text
pg-boss callback-batch signal aborts
  → registry checkpoint (accounting/fairness/tenant slot)
  → admission checkpoint or synchronous waiter removal
  → abortable pool checkout (late client is released)
  → if target query active:
       reserve a second pool client
       SELECT pg_cancel_backend(target_process_id)
       keep target client checked out
  → reject new target queries except ROLLBACK
  → await cancellation outcome
  → ROLLBACK if transaction open
  → release target client
  → throw INGESTION_JOB_ABORTED
  → pg-boss failure/retry policy
```

**MEASURED:** installed pg-boss v12.22 assigns the same signal to all jobs in one callback batch. Handler-expiry timeout cleanup and shutdown `failWip()` abort it. Timeout-promise cleanup also aborts after a successful callback returns, which is harmless because application checks have ended.

**MEASURED:** keeping the target client checked out prevents its PID from being returned/reassigned before `pg_cancel_backend` completes. If cancellation fails, statement timeout remains the final bound for the active statement and the query guard blocks subsequent work.

## Cancellation checkpoints

1. before worker accounting;
2. before and after fairness re-enqueue;
3. before tenant admission;
4. at processor entry and during normalization;
5. before and after validation-DLQ enqueue;
6. while queued for FIFO admission;
7. during pool checkout;
8. before transaction queries and via query instrumentation; and
9. immediately before COMMIT.

**MEASURED:** focused tests cover pre-abort no-side-effects, queued admission abort, permit/waiter cleanup, late checkout release, active backend cancellation, rollback/release, and error classification.

## Fairness replacement race

| Classification | Event | Consequence |
| --- | --- | --- |
| **MEASURED** | Over-budget tenant before max defers | Await delayed/priority-boosted replacement send before completing original. |
| **MEASURED** | Replacement send fails | Original fails for retry. |
| **MEASURED** | Abort while non-cancellable send is in flight | Send can succeed, then post-send checkpoint fails original. |
| **DERIVED / PARTIAL** | Successful copy plus failed original | Extra retry/copy is possible; outbox reservation and deployed typed unique guards prevent duplicate final state. Log typed-row convergence remains unproven without migration 030. |

## Transaction/COMMIT races

| Classification | Point | Result |
| --- | --- | --- |
| **MEASURED** | Failure before COMMIT | Transaction rolls back; source job fails. |
| **MEASURED** | Signal known immediately before COMMIT | COMMIT is not submitted; cancel/rollback/retry. |
| **MEASURED** | Signal arrives while COMMIT active and COMMIT fails | Rollback best-effort/release/fail. |
| **MEASURED / PARTIAL** | COMMIT reports success despite expiry race | Telemetry/outbox are durable; run domain event and inserted-only usage accounting. Redelivery converges where a typed unique guard is deployed; log convergence remains unproven until migration 030 is live. |

ACK remains downstream of successful COMMIT. PostgreSQL atomicity determines the transaction outcome; application code must not invent an ambiguous partial-commit state.

## Timeout scope

| Timeout | Default | Scope |
| --- | ---: | --- |
| Lock timeout | 2,000 ms | Each lock acquisition in the ingestion transaction. |
| Statement timeout | 60,000 ms | Each statement, not total handler wall time. |
| Idle-in-transaction timeout | 30,000 ms | Idle interval while a transaction remains open. |
| pg-boss expiry | 300,000 ms | Callback handler wall-time race. |
| PM2 kill window | Recorded as 30,000 ms | Process shutdown grace in the audited configuration. |

**DERIVED:** validation, fairness, admission, checkout, multiple statements, and post-COMMIT work can exceed one statement timeout. The 30-second process kill window can also be shorter than a 60-second statement. Effective production overrides are **UNKNOWN**.

## DLQ flow

```text
worker validation reject OR pg-boss dead-letter
  → ingest.dlq-intake
  → classify payload shape
  → persist Primary DB ingestion_dead_letter_jobs
  → ACK intake only after persistence succeeds
```

**MEASURED:** DLQ intake uses `localConcurrency=2`, `batchSize=10`, 5 retries, 30-second delayed backoff, and 3,600-second expiry. Persistence failure leaves the intake job failed/retryable.

## Process/database crash consequences

| Classification | Crash point | Consequence |
| --- | --- | --- |
| **DERIVED** | Before source enqueue | No durable job; client may retry. |
| **DERIVED** | After source enqueue, before pickup | pg-boss retains and later delivers the job. |
| **DERIVED** | During transaction before COMMIT | Connection loss causes transaction rollback; pg-boss retry should redeliver. |
| **DERIVED** | After COMMIT, before usage staging | Typed telemetry/outbox durable; in-memory usage may be lost; duplicate retry cannot reconstruct inserted count. |
| **DERIVED** | After staging, before rollup, followed by PostgreSQL restart/failover | `UNLOGGED` staging may be truncated/absent. |
| **UNKNOWN** | Real loss frequency and reconciliation | No kill/restart/failover exercise was run. |

## Failure classification examples

`INGESTION_JOB_ABORTED` maps to `job_aborted`; PostgreSQL `55P03` maps to lock timeout and `57014` to statement cancellation/timeout; connection and integrity classes retain their separate labels. Exact operational rates were not measured.

## Acceptance status

- **MET (focused):** incomplete aborted transactions are cancelled/rolled back/released and fail for retry.
- **MET (focused/static):** successful COMMIT remains the ACK boundary and duplicate retry remains safe.
- **PARTIAL:** graceful usage drain improved, but process/UNLOGGED loss windows remain.
- **UNMET:** crash/failover, retry-storm, and multi-replica chaos evidence.
- **UNMET:** **BENCHMARK NOT EXECUTED**.

## Related documents

- [Ingestion flow](ingestion-flow.md)
- [Current architecture](current-architecture.md)
- [Data flow](data-flow.md)
- [Worker lifecycle](../workers/worker-and-queue-lifecycle.md)
- [Failure recovery](../operations/failure-recovery.md)

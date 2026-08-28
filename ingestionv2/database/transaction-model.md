# Transaction model

Status date: 2026-08-27.

## Transaction order

```text
write permit
  → abortable checkout
  → install query/abort guard
  → BEGIN
  → SET LOCAL durability/timeout settings
  → typed/error writes
  → transactional outbox/idempotency work
  → signal check immediately before COMMIT
  → COMMIT
  → post-COMMIT domain event
  → inserted-only UsageCounter increment
  → pg-boss completion
```

## Atomic domain

| Classification | Inside one Log DB transaction |
| --- | --- |
| **MEASURED** | Typed event insert(s), including trace header/derived spans or error grouping work. |
| **MEASURED** | `telemetry_outbox` and associated reservation work executed with the transaction client. |
| **MEASURED** | Parent-table defaults and BEFORE-row trigger behavior. |
| **MEASURED** | `SET LOCAL` synchronous commit, lock, statement, and idle-in-transaction controls. |

**MEASURED:** processor success is not returned before COMMIT. If any pre-COMMIT statement fails, rollback is attempted and the source job fails for pg-boss retry.

## Outside the transaction

| Classification | Post-COMMIT work | Consequence |
| --- | --- | --- |
| **MEASURED** | Error domain-event publication | Runs only after committed inserted errors. |
| **MEASURED** | UsageCounter increment | Counts `result.totalInserted`, not received rows. |
| **MEASURED** | Metrics/profile output | Operational side effect; not telemetry durability authority. |
| **DERIVED** | Process failure before usage staging | Telemetry/outbox durable but usage can be lost. |

## Cancellation before and during the transaction

**MEASURED:** `connectWithAbort()` releases a checkout that arrives after cancellation.

**MEASURED:** query instrumentation rejects post-abort target-client queries except `ROLLBACK` and tracks whether a query is active.

**MEASURED:** on active-query abort, a separate pool client calls `pg_cancel_backend(targetProcessId)`. The target client remains checked out until the cancel attempt resolves and rollback runs, preventing PID reassignment.

**MEASURED:** if cancellation fails, statement timeout remains the active-statement fallback and the query guard prevents later statements.

## COMMIT boundary cases

| Classification | Case | Outcome |
| --- | --- | --- |
| **MEASURED** | Signal already aborted at pre-COMMIT check | COMMIT not submitted; cancel if needed, rollback, fail for retry. |
| **MEASURED** | COMMIT submitted and PostgreSQL reports failure | Rollback best-effort/release/fail. |
| **MEASURED** | Signal races active COMMIT and PostgreSQL reports success | Treat transaction as committed; run post-COMMIT inserted-only accounting. |
| **DERIVED / PARTIAL** | Retry after successful-COMMIT race | A deployed typed conflict guard suppresses the duplicate and therefore repeat usage; scoped log convergence remains unmet because migration 030 is not live. |

PostgreSQL decides atomic commit outcome. The application must not acknowledge a failed/unknown pre-COMMIT path as success.

## Deduplication and outbox

- **MEASURED:** generic typed inserts use `ON CONFLICT DO NOTHING`; `rowCount` supplies inserted count.
- **MEASURED:** fully duplicate non-error batches skip outbox and usage work.
- **MEASURED:** partially duplicate non-error batches still send the full scoped list to outbox reservation if at least one typed row inserts.
- **DERIVED:** this preserves final idempotency but can amplify SQL/WAL. Filtering is deferred until every typed insert can return inserted identities safely.
- **MEASURED:** error outbox uses returned inserted error events.

## Trigger/default order inside INSERT

**MEASURED:** omitted public IDs receive column defaults before the BEFORE trigger. The trigger normally skips another allocation, but repairs explicit NULL/empty IDs and metadata/timestamp/payload fields. Conflict candidates can still consume sequence values before being discarded.

## Transaction-local settings

| Setting | Recorded default | Scope |
| --- | ---: | --- |
| `synchronous_commit` | `on` in audited defaults | Commit acknowledgement durability. |
| `lock_timeout` | 2,000 ms | Each lock acquisition. |
| `statement_timeout` | 60,000 ms | Each statement. |
| `idle_in_transaction_session_timeout` | 30,000 ms | Idle period while transaction open. |

**DERIVED:** statement timeout is not a total-handler deadline. Validation, DLQ enqueue, fairness, admission, checkout, multiple statements, post-COMMIT usage, and settlement can extend wall time.

## UsageCounter transaction boundary

**MEASURED:** UsageCounter's own staging operation single-flights and preserves/re-buffers counts on failure, but it is not part of the Log DB telemetry transaction.

**DERIVED:** a distributed transaction between Log DB telemetry and Primary billing staging does not exist. Closing the durability gap requires logged/replayable inserted-only accounting and recovery tests, not merely a shorter flush interval.

## ACK invariant

```text
COMMIT success
  → required post-COMMIT processor handling
  → per-job completed result
  → pg-boss completion/ACK
```

Cancellation before commit produces failure/retry. Cancellation after a successful commit cannot undo telemetry; inserted-only idempotency governs retries.

## Evidence status

- focused cancellation/COMMIT/duplicate tests passed;
- production build passed;
- no live crash/failover or migration execution;
- **BENCHMARK NOT EXECUTED**.

## Related documents

- [Connection pools](connection-pools.md)
- [Public-ID generation](public-id-generation.md)
- [Query inventory](query-inventory.md)
- [Write path and invariants](../ingestion/write-path-and-invariants.md)
- [Outbox](../ingestion/outbox.md)

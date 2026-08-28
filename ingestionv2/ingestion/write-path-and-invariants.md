# Ingestion write path and invariants

Status date: 2026-08-27. Evidence labels follow [the package vocabulary](../README.md#evidence-vocabulary).

## Active end-to-end order

```text
HTTP validation and backpressure
  → awaited durable pg-boss enqueue for accepted events
  → pg-boss typed delivery (shared AbortSignal per callback batch)
  → retry-stable normalization and identity
  → process-local tenant fairness
  → cancellation-aware FIFO write admission
  → abortable Log DB pool checkout
  → BEGIN + SET LOCAL transaction controls
  → typed/error writes
  → transactional telemetry_outbox/idempotency work
  → cancellation check immediately before COMMIT
  → COMMIT
  → post-commit domain event
  → inserted-only UsageCounter increment
  → WorkerRegistry settlement
  → pg-boss completion/ACK
```

**MEASURED:** No successful source-job settlement occurs before PostgreSQL reports `COMMIT` success. Typed telemetry and `telemetry_outbox` use the same checked-out Log DB client and transaction.

## Gateway receipt and durable enqueue

| Classification | Contract | Current behavior |
| --- | --- | --- |
| **MEASURED** | Receipt clock | `IngestionService` creates one `receivedAt` value per HTTP batch and stores it in each built pg-boss payload. |
| **MEASURED** | Gateway rejects | Invalid, disallowed, oversized, non-serializable, or shed events are synchronous response errors; they do not become source jobs or worker-DLQ rows. |
| **MEASURED** | Job chunk | Normal jobs are capped at 200 events and about 1 MiB serialized event data; the per-event guard is 256 KiB. |
| **MEASURED** | Accepted count | Events counted as accepted follow an awaited enqueue result. An all-invalid/all-shed request can return 202 with `accepted: 0` and no queue row. |
| **UNKNOWN** | Partial provider failure around pg-boss bulk insert | This edge was not exercised against PostgreSQL during this audit. |

## Retry-stable normalization and identity

- **MEASURED:** `EventProcessor.process()` requires valid `metadata.receivedAt`; it does not fall back to a retry-varying current time.
- **MEASURED:** normalization uses the receipt clock for timestamp fallback and future-skew clamping.
- **MEASURED:** missing SDK `eventId` values use a deterministic hash of project, environment, signal type, and stable normalized content.
- **MEASURED:** one `occurredAtMs` is reused by typed rows, error grouping, trace-derived spans, and outbox derivation.
- **DERIVED:** redelivery therefore targets the same logical identity/partition key. Two content-identical no-ID events can collapse; SDKs must provide IDs when those events must remain distinct.

## Validation boundary

| Classification | Control | Result |
| --- | --- | --- |
| **MEASURED** | Worker signal allowlist | error, message, request, span, trace, metric, log, profile, cron_checkin, replay. |
| **MEASURED** | Trace traversal | Iterative, maximum 10,000 actual nodes, depth 128 accepted/129 rejected. |
| **MEASURED** | Malformed graph defense | Non-object children, cycles, and shared object references reject before DB checkout. |
| **MEASURED** | Prototype defense | Null-prototype span clones and own-property `children` traversal. |
| **MEASURED** | Worker validation failure | The rejection is sent to `ingest.dlq-intake`; if that send fails, the source job fails for retry. |

## Cooperative cancellation and PostgreSQL cancellation

### Signal provenance

**MEASURED:** Installed pg-boss v12.22 creates one `AbortController` in `#processJobs`, assigns the same signal to every job in that callback batch, and races the callback against handler expiry. The controller is also aborted during timeout-promise cleanup after a successful callback; checks occur only while the callback is executing, so the post-return abort has no side effect. The shutdown `failWip()` path also aborts active workers.

**DERIVED:** The signal is batch-scoped in the installed implementation, even though it is exposed as `job.signal`. Code must not assume independently abortable jobs inside one delivered callback batch.

### Application checkpoints

**MEASURED:** The signal is checked:

1. before worker accounting;
2. before and after fairness re-enqueue;
3. before tenant admission;
4. at processor entry and during normalization;
5. before and after validation-DLQ enqueue;
6. while waiting for FIFO write admission;
7. during pool checkout;
8. before the transaction and through query instrumentation; and
9. immediately before `COMMIT`.

**MEASURED:** `IngestionJobAbortedError` uses stable code `INGESTION_JOB_ABORTED`; worker metrics classify it as `job_aborted` rather than a generic database timeout.

### Admission and checkout safety

- **MEASURED:** an already-aborted job cannot acquire a permit.
- **MEASURED:** a queued aborted waiter is synchronously removed; the acquire/continuation race releases a permit in `finally`.
- **MEASURED:** `connectWithAbort()` races pool checkout against the signal. If the checkout resolves after cancellation, the late client is asynchronously released, preventing a leak.

### Active statement cancellation

**MEASURED:** query instrumentation tracks whether the held target client has an active query and rejects newly submitted post-abort statements except `ROLLBACK`.

**MEASURED:** when an active query exists, a reserved pool connection executes:

```sql
SELECT pg_cancel_backend($1)::boolean AS cancelled
```

using the held target client's runtime `processID`.

**MEASURED:** the target client is not released until cancellation has completed and rollback has run. This prevents its backend PID from being reassigned and accidentally cancelling unrelated future work. If cancellation fails, the per-statement timeout remains the final active-statement bound and future statements remain blocked.

### COMMIT race

| Classification | Race outcome | Required behavior |
| --- | --- | --- |
| **MEASURED** | Signal observed before COMMIT submission | COMMIT is blocked, active work is cancelled if necessary, transaction rolls back, job fails for retry. |
| **MEASURED** | COMMIT reports failure | Roll back best-effort, release, fail job. |
| **MEASURED / PARTIAL** | COMMIT reports success despite an expiry race | Treat telemetry as committed, execute inserted-only post-COMMIT usage accounting, then rely on deployed typed conflict guards for redelivery. The intended log guard in migration 030 is not live. |

**DERIVED:** PostgreSQL COMMIT atomicity plus deployed typed conflict guards is safer than falsely acknowledging an uncommitted transaction or suppressing required accounting after a successful COMMIT. This does not close the current log identity gap.

## Transaction and ACK invariants

| Classification | Invariant | Evidence boundary |
| --- | --- | --- |
| **MEASURED** | ACK after durable COMMIT | Processor returns only after COMMIT and post-COMMIT handling; pg-boss settlement is downstream. |
| **MEASURED** | Rollback on failure/abort | Transaction catch path awaits cancellation, rolls back when open, then releases. |
| **MEASURED** | Synchronous commit preserved | Transaction settings do not relax configured `synchronous_commit`. |
| **MEASURED** | Statement timeout is per statement | It does not bound validation, fairness, admission, checkout, multiple statements, or post-COMMIT work. |
| **MEASURED** | Boot ordering guard | Default 60-second ingestion statement timeout is below 300-second pg-boss expiry. |

## Typed inserts, deduplication, and outbox

- **MEASURED:** generic typed writers use set-based multi-row `INSERT ... ON CONFLICT DO NOTHING`; PostgreSQL `rowCount` supplies actual inserted counts.
- **MEASURED:** error ingestion exposes inserted domain events and uses only that inserted set for error outbox work.
- **MEASURED / PARTIAL:** when an applicable typed guard suppresses a fully duplicate non-error batch, outbox and usage are skipped. The current log path lacks the intended scoped guard.
- **MEASURED:** when a non-error batch is partially duplicate and at least one typed row inserts, the complete scoped list is still sent to outbox reservation.
- **DERIVED / PARTIAL:** outbox final state remains reservation-protected, but duplicate-heavy retries can perform unnecessary outbox/idempotency SQL and WAL. Typed-row final state still requires a deployed unique guard; migration 030's intended log guard is absent. Filtering safely requires inserted event identities from every typed insert and is deferred pending evidence.
- **MEASURED:** outbox reservation namespace currently keys organization plus `signal_kind:event_id` across time. Reuse of one client event ID across projects in the same organization can collide at this layer; production frequency is **UNKNOWN**.

## Trace persistence and deferred payload optimization

| Classification | Behavior | Evidence |
| --- | --- | --- |
| **MEASURED** | Trace header | One set-based `events_traces` insert. |
| **MEASURED** | Derived spans | Iteratively flattened; 67 bind values per row. |
| **DERIVED** | Safe chunk | `floor(65,535 / 67) = 978` span rows per statement. |
| **MEASURED** | Atomicity | Trace header, derived spans, and outbox commit or roll back together. |

**MEASURED:** `buildTraceSpanRow()` calls `payloadFor(event)`, and `payloadFor()` JSON-serializes the complete normalized trace event. Every derived span therefore stores another copy of the parent trace payload.

**DERIVED:** if a trace contains `S` spans and the serialized parent payload grows proportionally with `S`, total copied payload is structurally O(S²) in span count. Runtime CPU, storage, TOAST, and WAL impact were not benchmarked.

**MEASURED:** `src/modules/analytics/repository.ts` applies `e.payload::text ILIKE ...` over its unified event query, which includes spans. Replacing each derived span's payload with only the current span would change search behavior.

**DECISION — DEFERRED:** do not silently apply current-span-only payloads without a product/API/search compatibility contract or feature/version gate. No performance improvement is claimed.

## UsageCounter single-flight and residual billing risk

### Correctness hardening

- **MEASURED:** `flushPromise` becomes authoritative before awaited schema setup; concurrent timer, threshold, and stop requests join it.
- **MEASURED:** a request arriving during a flush sets `flushRequested`; the owner performs a trailing drain when replacement-buffer data exists before the shared promise resolves.
- **MEASURED:** schema failure leaves counts in the active buffer and rejects.
- **MEASURED:** staging failure merges the drained snapshot back exactly once, logs `bufferedEntries`, `bufferLimit`, and `overLimitBy`, then rejects.
- **MEASURED:** background timer/threshold rejections are logged/caught so they do not become unhandled rejections.
- **MEASURED:** `stop()` prevents new increments, clears the timer, joins an active flush, retries re-buffered data with a final flush, and logs success only after the final drain succeeds.

### Remaining durability limits

| Classification | Window | Consequence |
| --- | --- | --- |
| **DERIVED** | Process crash after Log DB COMMIT and before successful staging | Usage increments can be lost. Where a typed guard suppresses redelivery, inserted count cannot be reconstructed; logs may instead reinsert without migration 030, which is duplicate telemetry rather than valid reconciliation. |
| **DERIVED** | PostgreSQL restart/crash/failover after insertion into `UNLOGGED usage_counter_staging` and before rollup | Staged counts can be truncated or absent after recovery/promotion. |
| **DERIVED** | Prolonged staging failure with new tenant/project/signal keys | Map cardinality can exceed `bufferLimit`; dropping counts would be worse, so overflow is retained and reported. |
| **MEASURED** | Registry shutdown handling | `WorkerRegistry.stop()` still catches/logs `processor.stop()` failure, so process-level shutdown cannot guarantee the counter failure propagates to the supervisor. |

**UNKNOWN:** real loss frequency and maximum exposure. Closing the gap requires logged/replayable accounting tied to actual inserted telemetry plus kill/restart/failover tests.

## Gzip contract

- **MEASURED:** `@fastify/compress` is registered globally in `src/app.ts` and the installed plugin supports request decompression with `globalDecompression=true` by default, including gzip.
- **MEASURED:** `INGESTION_GZIP_MAX_BYTES` is declared but unused by active ingestion code.
- **MEASURED:** no ingestion-specific bounded decompression limit using that setting was found.
- **UNKNOWN:** end-to-end maximum decompressed request size after framework/proxy behavior; no compressed-request boundary test was run.
- **DERIVED:** gzip acceptance exists, but the intended dedicated decompressed-size guard is not proven. Do not describe the setting as enforced or claim zip-bomb resistance from it.

## Preserved-invariant checklist

- **MEASURED:** accepted events follow awaited durable enqueue.
- **MEASURED:** ACK remains after COMMIT.
- **MEASURED:** cancellation fails incomplete work for retry and does not leak permits or late checkouts.
- **MEASURED:** retry-stable identity and occurrence time remain intact.
- **MEASURED:** typed rows and outbox remain atomic.
- **MEASURED:** rows suppressed by a deployed typed conflict guard are not billed; the missing log guard remains an acceptance gap.
- **MEASURED:** process-local fairness remains before DB admission.
- **MEASURED:** public-ID behavior was not changed.
- **UNKNOWN:** post-COMMIT usage is not fully durable across process and PostgreSQL failure windows.
- **UNVERIFIED:** **BENCHMARK NOT EXECUTED**; performance effect is unknown.

## Related documents

- [Transaction model](../database/transaction-model.md)
- [Connection pools](../database/connection-pools.md)
- [Worker lifecycle](../workers/worker-and-queue-lifecycle.md)
- [Deduplication](deduplication.md)
- [Trace ingestion](trace-ingestion.md)
- [Outbox](outbox.md)
- [Forensic report](../performance/forensic-report.md)

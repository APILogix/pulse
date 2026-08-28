# Ingestion flow

Status date: 2026-08-27.

## End-to-end flow

```text
1. SDK HTTP request
   → Fastify authentication / tenant resolution
   → shape, type, entitlement, serialization and size checks
   → reactive event-loop/heap/RSS/queue-depth shedding
   → group by signal and chunk (≤200 events, ~1 MiB event data)
   → awaited pg-boss enqueue for accepted chunks
   → HTTP 202 admission result

2. Primary DB / pg-boss
   → durable ingest.<type> row
   → typed callback delivery (shared AbortSignal for callback batch)

3. WorkerRegistry
   → abort checkpoint
   → metrics/accounting
   → process-local tenant fairness
      → under limit: acquire tenant slot
      → over limit: await durable replacement, then complete original
      → max defers: admit to prevent starvation

4. EventProcessor
   → validate durable receivedAt
   → retry-stable normalization and generated identity
   → worker validation
      → rejected items: await ingest.dlq-intake copy
      → valid items: continue
   → cancellation-aware FIFO write admission
   → abortable Log DB checkout

5. Log DB transaction
   → install active-query abort guard
   → BEGIN
   → SET LOCAL synchronous_commit/lock/statement/idle-tx controls
   → typed or error/group writes
   → transactional telemetry_outbox/idempotency reservation
   → abort checkpoint immediately before COMMIT
   → COMMIT or cancellation/ROLLBACK

6. Post-COMMIT
   → publish inserted error-domain events where applicable
   → increment UsageCounter by actual inserted rows only
   → record metrics/profile
   → per-job worker outcome
   → pg-boss completion/ACK
```

## Admission boundaries

| Classification | Boundary | Guarantee |
| --- | --- | --- |
| **MEASURED** | HTTP 202 | Admission processing finished; each event counted in `accepted` followed awaited enqueue. Telemetry may not yet exist. |
| **MEASURED** | `accepted: 0` | No accepted source chunk; request may still be 202 with only rejection details. |
| **MEASURED** | pg-boss row | Durable queued work, subject to retry/dead-letter policy. |
| **MEASURED** | Log DB COMMIT | Typed/error and transactional outbox state are durable according to configured synchronous commit. |
| **MEASURED** | pg-boss completion | Downstream of COMMIT and processor post-COMMIT handling. |

Gateway rejects are response data, not worker-DLQ rows. Worker validation rejects have a source job, so their DLQ copy is awaited; failed DLQ enqueue fails the source attempt.

## Cancellation flow inside the path

**MEASURED:** installed pg-boss v12.22 assigns one signal to all jobs in one callback batch. The application checks it before/after fairness, around tenant slots, during normalization/DLQ handling, in FIFO admission, during pool checkout, and before COMMIT.

**MEASURED:** if a target query is active, a reserved pool connection calls `pg_cancel_backend(target_process_id)`. The target client stays checked out until cancellation finishes and rollback runs, preventing PID reuse. New post-abort statements reject except rollback.

**MEASURED / PARTIAL:** if COMMIT reports success at the expiry boundary, post-COMMIT inserted-only usage still executes. Redelivery is suppressed by deployed typed guards; the audited log path lacks migration 030's intended guard, so complete log convergence is unproven.

## Identity and retry

- one immutable `receivedAt` per HTTP batch is embedded in each job;
- normalization uses it for fallback/clamping;
- deterministic no-ID hashing occurs before occurrence-time resolution;
- one scoped occurrence time feeds typed rows, outbox, errors, and trace spans; and
- `ON CONFLICT DO NOTHING` absorbs typed redelivery.

These are source/focused-test facts. Cross-process crash/recovery remains unexercised.

## Concurrency in the flow

| Classification | Layer | Default |
| --- | --- | ---: |
| **DERIVED** | Typed delivered jobs/process | 10 × 2 × 4 = 80 |
| **DERIVED** | DLQ delivered jobs/process | 2 × 10 = 20 |
| **DERIVED** | Log DB write permits/process | min(16, 20 − 2) = 16 |
| **MEASURED** | Trace-derived span SQL chunk | 978 rows maximum |

All typed jobs normalize before the DB gate. At the default envelope, up to 64 can wait for admission. That waiter set is delivery-bounded; the durable pg-boss backlog has no hard capacity.

## Usage path

```text
inserted typed count
  → process-local UsageCounter map
  → single-flight snapshot + optional trailing drain
  → Primary DB UNLOGGED usage_counter_staging
  → scheduled rollup
  → billing/usage tables
```

**DERIVED:** process failure before staging and PostgreSQL restart/failover before rollup remain billing-loss windows. The buffer threshold is not a strict cardinality cap during staging failure.

## Gzip boundary

**MEASURED:** global `@fastify/compress` supports inbound gzip through default global decompression. `INGESTION_GZIP_MAX_BYTES` is unused, so a dedicated maximum expanded-size guard is not proven.

## Status

- focused cancellation/usage tests: 37 passed;
- repository ingestion report: 92 passed, 1 todo;
- production build: passed;
- load/integration/chaos: not supplied;
- **BENCHMARK NOT EXECUTED**.

## Related documents

- [Architecture overview](overview.md)
- [Current architecture](current-architecture.md)
- [Data flow](data-flow.md)
- [Failure flow](failure-flow.md)
- [Write path and invariants](../ingestion/write-path-and-invariants.md)
- [Worker architecture](../workers/worker-architecture.md)

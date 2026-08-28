# Ingestion batching

Status date: 2026-08-27.

## Distinct batching layers

“Batch” is not one limit in this pipeline:

| Layer | Verified default/limit | Effect |
| --- | ---: | --- |
| Gateway event count | 200 events per normal request/job | Bounds normal job count. |
| Gateway serialized event bytes | about 1 MiB per normal batch | Bounds accepted serialized event content as implemented. |
| Per-event bytes | 256 KiB | Rejects an oversized individual event. |
| Fastify body limit | 10 MiB | Transport-level outer bound. |
| pg-boss typed callback batch | 4 jobs | Jobs in one callback share the same AbortSignal. |
| Typed local concurrency | 2 per each of 10 queues | Up to `10 × 2 × 4 = 80` fetched/active typed jobs per process. |
| DB write admission | 16 permits by default | Bounds admitted transactions, not pre-admission normalization. |
| Derived-span SQL chunk | 978 rows | Keeps `978 × 67 = 65,526` binds below 65,535. |

DLQ intake separately uses local concurrency 2 and batch size 10 (20 delivered jobs). Rollup adds another worker path. These are not extra typed write permits.

## Gateway to durable job

The gateway validates envelope/type/project scope, normalizes retry-stable receipt context, applies reactive queue-depth shedding, and enqueues durable `ingest.*` jobs. There is no configured hard queue capacity and the audited rate/concurrency limiter settings are not wired as strict admission controls. High-urgency higher-tier traffic can continue at critical depth.

`@fastify/compress` is registered globally; its installed default supports inbound gzip decompression. `INGESTION_GZIP_MAX_BYTES` is currently unused, so a dedicated expanded-body-size guarantee was not proven.

## Worker callback batches and cancellation

pg-boss v12.22 invokes one handler with up to four jobs and one shared callback-batch `AbortSignal`. The registry threads that signal into each job's fairness wait, write-admission wait, checkout, transaction queries, and pre-COMMIT check.

Consequences:

- expiry/cancellation can affect sibling jobs sharing the callback;
- queued aborted admission waiters are removed synchronously;
- permit races release their permit;
- late checkout after abort is released; and
- active PostgreSQL work can be cancelled with `pg_cancel_backend` while the target client stays held through rollback.

## SQL batching

Normal typed writers build set-based multi-row INSERTs with parameterized values and `ON CONFLICT DO NOTHING`. Outbox input uses fixed-array binds and `UNNEST`. Trace-derived spans alone need repeated INSERT chunks due to their 67-column width.

The number of SQL statements is not universally fixed:

- all-duplicate paths skip outbox;
- traces add one or more derived-span chunks;
- errors have grouping/history/fallback branches; and
- cancellation may issue backend-cancel/rollback work outside the successful transaction shape.

The key scalable property is set-based normal writes, not an asserted exact statement total for every execution.

## Memory envelope

At default typed delivery, 80 jobs × roughly 1 MiB gives about 80 MiB of raw typed payload before job metadata, validation copies, normalized objects, SQL arrays/strings, trace payload replication, and GC overlap. Up to 64 typed jobs can wait behind 16 permits after pre-admission work.

This is delivery-bounded, not durable-backlog-sized, but total RSS has not been statically bounded or measured under representative load. Trace-derived full-parent payload copies and UsageCounter key growth during prolonged DB failure are additional risks.

## Atomicity and settlement

All chunks for one job use one transaction. COMMIT precedes domain-event/usage work and pg-boss completion. Only inserted rows contribute usage. A failed chunk, cancellation, or failed COMMIT rolls back and leaves the job eligible for retry.

## Evidence gaps

- peak RSS/heap/GC with 80 typed jobs plus DLQ;
- queue-lag and tenant-volume distributions;
- compressed/expanded adversarial request tests;
- per-shape SQL/WAL/event; and
- load/failure tests for shared-signal callback batches.

# BENCHMARK NOT EXECUTED

## Related documents

- [Worker concurrency](../workers/worker-concurrency.md)
- [Worker memory](../workers/worker-memory.md)
- [Backpressure](../workers/worker-backpressure.md)
- [Trace ingestion](trace-ingestion.md)
- [Write path and invariants](write-path-and-invariants.md)

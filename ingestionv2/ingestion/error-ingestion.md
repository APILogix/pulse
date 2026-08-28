# Error ingestion

Status date: 2026-08-27.

## Why this path differs

`ingest.error` writes `events_errors` and attaches each newly inserted event to `error_groups`. It is the only typed path with grouping/regression state in the transaction.

```text
bulk INSERT events_errors ... RETURNING inserted identities
  → map returned identities to inserted inputs
  → set-based group lock/create/update/read
  → bulk attach group IDs
  → transactional outbox for confirmed inserts
  → pre-COMMIT abort check
  → COMMIT
  → publish domain events + inserted-only usage
```

Duplicates excluded by `RETURNING` do not mutate group counts, produce outbox rows/domain events, or consume usage.

## Normal set-based grouping

`ErrorIngestionService.ingestBatch()` aggregates and processes newly inserted errors in bulk. Existing groups are locked in deterministic project/fingerprint order, new groups are inserted with conflict handling, existing summaries/counts are updated in bulk, and attachments are applied with a bulk repository call.

SQL value volume can grow with input/unique fingerprints, but the normal path does not execute one grouping query sequence per event. Exact statement totals vary by new/existing/regression/history branches and are not treated as a universal performance claim.

## Merged-group fallback

**MEASURED:** when bulk grouping reports `BULK_ERROR_GROUP_MERGED_GROUP_FALLBACK_REQUIRED`, the service calls `handleGroup()` once per inserted error to follow merged-group behavior. Source comments characterize this as roughly `3N + constant` queries; it is the only identified O(N) database path in current error ingestion.

The fallback emits a warning plus `ingest_error_group_merge_fallback_total` / event count instrumentation. Frequency and production cost were not measured. If it is non-rare, merge-chain resolution should move into a set-based statement after correctness tests.

## Transaction/cancellation

The callback-batch signal reaches fairness, admission, checkout, active PostgreSQL queries, and the pre-COMMIT boundary. Active cancellation uses `pg_cancel_backend`; the target client stays held through cancellation and rollback. A successful COMMIT remains authoritative during an expiry race, after which domain events and inserted-only usage complete before job success.

## Domain events and outbox

Only confirmed inserted errors can produce `ErrorGroupCreated`, `ErrorRegressed`, or `ErrorOccurred` domain events. Publication is post-COMMIT. Durable alert handoff is the transactional outbox written before COMMIT; the in-process domain bus is not a substitute for it.

## Public ID and type safety

`events_errors.public_id` normally comes from its `ERR-` sequence-backed default before the sync trigger runs. Explicit NULL/empty values are trigger-repaired. Bulk attachment values are explicitly cast to the database UUID/timestamp types, retaining the prior type-mismatch fix.

## Evidence gaps

- merged-group fallback production rate and latency;
- lock-wait/deadlock evidence under competing fingerprints;
- branch-specific WAL and statement timing;
- expiry during grouping/attachment; and
- end-to-end outbox consumer failure injection.

# BENCHMARK NOT EXECUTED

## Related documents

- [Outbox](outbox.md)
- [Deduplication](deduplication.md)
- [Write path and invariants](write-path-and-invariants.md)
- [Bottlenecks](../performance/bottlenecks.md)

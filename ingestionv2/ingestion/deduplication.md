# Deduplication and idempotency

Status date: 2026-08-27.

## Layers

| Layer | Role |
| --- | --- |
| Event identity | Preserve client IDs or assign deterministic identity for no-ID inputs. |
| Typed-table unique guard | Where deployed, `INSERT ... ON CONFLICT DO NOTHING` suppresses typed-row retry duplicates. The audited log guard is missing. |
| Insert result | `rowCount` or error `RETURNING` establishes what actually inserted. |
| Outbox reservation | Durable `telemetry_outbox` namespace key prevents repeated alert handoff across time partitions. |
| pg-boss retry | Failed/aborted attempts may redeliver; DB idempotency makes replay safe. |

These layers are complementary. Queue job identity alone is not the durable event-idempotency authority.

## Retry-stable inputs

The gateway supplies retry-stable receipt context rather than regenerating occurrence time on each worker attempt. Typed identities include `occurred_at` because the tables are range-partitioned by that column; a changing fallback clock would evade the partitioned unique guard.

For inputs without an event ID, deterministic identity uses stable normalized content. Consequently, two semantically distinct no-ID events with identical identity inputs can collapse. Clients should supply IDs when repeated equal-content events must remain distinct.

`stableStringify()` is recursive and has no explicit depth bound; gateway/normalizer shape limits mitigate known paths, but the independent review retained this as a lower-severity hardening item.

## Inserted-only effects

- non-error typed INSERTs use command-tag `rowCount`;
- error INSERTs use `RETURNING event_id` where downstream grouping/outbox needs the inserted subset;
- all-duplicate typed batches skip outbox and usage;
- usage increments by `totalInserted`, never the received-event count; and
- retries therefore do not bill typed duplicates again.

No universal exact SQL-statement count is asserted; conflict, trace-chunk, error-group, cancellation, and outbox branches differ.

## Mixed non-error caveat

If at least one non-error row inserts, current code can pass the complete scoped input to outbox reservation, including typed duplicates. Reservation/outbox conflict guards preserve final-state idempotency, but partial retries can cause avoidable SQL/WAL/conflict work. This remains current behavior.

## Conflict ambiguity

Untargeted `ON CONFLICT DO NOTHING` can suppress a row because of any applicable unique constraint. A zero insert count proves that PostgreSQL suppressed the row, not which constraint was responsible.

## Scope caveats

- The outbox reservation key is organization + signal kind + event ID; it excludes project/environment. Cross-project reuse inside an organization can collide at this layer.
- `events_logs.project_id` is nullable in schema although the active writer supplies it. PostgreSQL's default unique-index NULL semantics would not deduplicate direct SQL rows whose project is NULL.
- Migration 030 was not executed in this phase; its proposed log identity change must not be described as deployed solely from the migration file.
- Idempotency/outbox retention was not established. Deleting keys too early can make old retries alert again.

## Cancellation/COMMIT race

An abort before COMMIT cancels/rolls back and the job can retry. If COMMIT reports success while expiry races with settlement, inserted-only usage still runs; later redelivery is suppressed where the relevant typed conflict guard is deployed. The current log exception remains. ACK remains after durable COMMIT.

## Validation

Focused cancellation/admission/usage/registry tests passed: 37. The ingestion report passed 92 tests with one todo. Missing integration/load/chaos/failure evidence means the complete acceptance gate remains unmet.

# BENCHMARK NOT EXECUTED

## Related documents

- [Outbox](outbox.md)
- [Write path and invariants](write-path-and-invariants.md)
- [Transaction model](../database/transaction-model.md)
- [Public IDs](../database/public-id-generation.md)

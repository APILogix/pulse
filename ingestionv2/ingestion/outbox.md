# Ingestion outbox

Status date: 2026-08-27.

## Purpose and transaction boundary

`telemetry_outbox` is the durable handoff from typed ingestion to asynchronous alert evaluation. It is written with the same Log DB client and before the typed transaction's COMMIT:

```text
typed INSERT(s)
  → reserve alert idempotency keys
  → INSERT telemetry_outbox
  → pre-COMMIT abort check
  → COMMIT
```

Therefore a failed or cancelled transaction rolls back both typed rows and outbox work. An outbox row never makes alert evaluation part of the request/worker critical path.

## Insert shape

The append path uses array binds and `UNNEST` rather than one bind set per event. Its input parameter count is fixed even as the input row count changes, avoiding tuple-builder bind overflow. Conflict guards exist on both the reservation and outbox paths.

The cross-time reservation authority is `alert_runtime_idempotency_keys`, namespace `telemetry_outbox`, organization scope, and a key derived as `signal_kind:event_id`. This protects retries whose partition timestamp might otherwise differ.

## Inserted-row gating

| Case | Audited behavior |
| --- | --- |
| Error events | `RETURNING` identifies inserted event IDs; only confirmed inserted errors are eligible for outbox work. |
| Non-error, all duplicate | Typed `rowCount` is zero; outbox and usage are skipped. |
| Non-error, all new | Scoped input is sent to outbox/reservation. |
| Non-error, mixed new/duplicate | **Current behavior:** if at least one typed row inserts, the complete scoped input can be sent to outbox/reservation, including typed duplicates. |

The mixed path remains final-state idempotent because reservation/outbox conflicts suppress duplicate alert handoffs, but it can amplify SQL work and WAL/conflict work during partial retry. This is a retained lower-severity review finding, not a historical-only issue.

A future optimization should derive the actually inserted non-error IDs without adding a worse `RETURNING`/wire/memory cost on every normal batch. It requires isolated measurements and retry tests.

## ACK and expiry

- pg-boss completion remains downstream of a successful COMMIT;
- an abort before COMMIT triggers query cancellation/rollback and retry;
- the target DB client remains held until cancellation and rollback finish; and
- if COMMIT reports success during an expiry race, inserted-only usage still runs before success settlement.

No queue ACK is produced merely because an outbox statement was attempted.

## Identity caveat

The reservation key does not include project or environment. Reusing the same client event ID across projects inside one organization and signal kind can collide at reservation scope even when a typed-table identity has finer dimensions. Production frequency is unknown; this is a contract question, not a reason to weaken idempotency without migration analysis.

## Lifecycle gap

No active cleanup policy was established for outbox/idempotency rows in this audit. These rows are required for retry and cross-time correctness, so retention must be designed with replay horizon, alert consumer lag, partitioning, and restore behavior. No production cleanup or partition DDL was run.

## Evidence gaps

- outbox lag/backlog and replay-age distributions;
- mixed-duplicate SQL/WAL cost;
- cross-project event-ID reuse frequency;
- retention/storage growth; and
- isolated failure-injection evidence for transaction commit plus consumer handoff.

# BENCHMARK NOT EXECUTED

## Related documents

- [Write path and invariants](write-path-and-invariants.md)
- [Deduplication](deduplication.md)
- [Transaction model](../database/transaction-model.md)
- [Remaining bottlenecks](../roadmap/remaining-bottlenecks.md)

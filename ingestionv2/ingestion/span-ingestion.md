# Span ingestion

Status date: 2026-08-27.

## Two producers, one table

`events_spans` receives rows from two paths:

| Property | Standalone span | Trace-derived span |
| --- | --- | --- |
| Queue/endpoint | `ingest.span` / `POST /v1/spans` | `ingest.trace` / `POST /v1/traces` |
| Expansion | one input event → one row | one trace → root/child rows |
| Row builder | standalone span writer | `buildTraceSpanRow()` during iterative flattening |
| Maximum normal input batch | 200 events | trace graph limited by validated node/depth caps |
| Bind handling | 200 × 67 = 13,400 values, below the protocol limit | chunked at 978 rows because each row has 67 values |
| Payload consequence | one normalized event payload per row | complete normalized parent trace payload copied to every derived row |

Both paths use the same typed table and preserve atomic typed-row/outbox behavior. No exact per-job statement count is asserted because branches and trace chunk counts vary.

## Normalized columns

The 67-column writer extracts searchable dimensions such as span kind/status/type, root/HTTP/database/cache/messaging flags, trace/span/parent identifiers, network and HTTP fields, database fields, timing, depth, endpoint, and project/environment scope. Compatibility columns remain for existing readers.

This normalization does not make the JSON payload irrelevant: unified analytics search also scans `e.payload::text`.

## Trace-derived payload risk

**MEASURED:** `buildTraceSpanRow()` calls `payloadFor(event)` for each derived span; `payloadFor()` stringifies the complete normalized trace.

**DERIVED:** where parent payload size grows with span count `S`, total copied payload across derived rows is O(S²). CPU, heap, storage, TOAST, and WAL effects are structurally plausible but unmeasured.

**DEFERRED:** a current-span-only payload optimization requires an explicit payload/search compatibility contract or version gate. It was not implemented in this phase.

## Bind-parameter safety

```text
PostgreSQL parameter ceiling = 65,535
span row bind values          = 67
safe derived-span chunk       = floor(65,535 / 67) = 978 rows
```

The chunker keeps all derived-span chunks in the same transaction. This solves bind overflow only; it is not a memory or transaction-time cap.

## Durability and retry behavior

- fairness and the 16-permit admission gate run before checkout;
- the pg-boss callback-batch `AbortSignal` reaches admission, checkout, active query cancellation, and the pre-COMMIT boundary;
- target clients remain checked out through cancellation and rollback;
- typed rows and outbox commit atomically;
- pg-boss success remains after COMMIT; and
- usage counts only rows reported inserted.

## Public IDs

`events_spans.public_id` has a sequence-backed `SPN-` default. PostgreSQL applies a default before the BEFORE trigger, so ordinary omitted-ID writes consume the default and the trigger does not generate another value. The trigger remains relevant for explicit NULL/empty IDs and contract repair. The audited sequence uses `CACHE 1` and is not `OWNED BY`; no change was made.

## Validation status

Focused cancellation/admission/usage/registry tests passed (37 total across four files), and the ingestion report passed 92 tests with one todo. Those results do not constitute large-span load, WAL, memory, search-compatibility, or end-to-end expiry evidence.

# BENCHMARK NOT EXECUTED

## Related documents

- [Trace ingestion](trace-ingestion.md)
- [Write path and invariants](write-path-and-invariants.md)
- [Batching](batching.md)
- [Query optimization](../database/query-optimization.md)

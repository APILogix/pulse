# Trace ingestion

Status date: 2026-08-27.

## Path

`ingest.trace` jobs create trace-header rows in `events_traces` and flatten nested spans into `events_spans` inside the same Log DB transaction as the outbox.

```text
normalize/validate trace tree
  → fairness + write admission
  → abortable checkout
  → BEGIN / SET LOCAL
  → set-based trace header INSERT
  → iterative derived-span INSERT chunks
  → transactional outbox/reservation
  → pre-COMMIT abort check
  → COMMIT
  → inserted-only usage
```

No statement-count or latency claim is made; outbox/idempotency branches vary.

## Structural validation

| Control | Verified behavior |
| --- | --- |
| Node count | Maximum 10,000 actual nodes; declared count is not trusted. |
| Depth | Root depth 0; 128 accepted, 129 rejected. |
| Traversal | Iterative, not recursive. |
| Graph shape | Cycles, shared references, non-object children reject before DB checkout. |
| Prototype handling | Null-prototype clones and own-property `children` traversal. |
| Retry clock | One durable receipt-derived occurrence time feeds trace and fallback span times. |

Worker validation rejects are copied to `ingest.dlq-intake`; failure to copy fails the source attempt.

## Bind-safe derived spans

**MEASURED:** each derived span row has 67 bind values. PostgreSQL's 65,535 parameter ceiling yields:

```text
floor(65,535 / 67) = 978 rows per span INSERT
statements = ceil(derivedSpanRows / 978)
```

All chunks share the caller's transaction. Chunking prevents bind overflow; it does not bound total serialized payload or transaction wall time.

## Full-parent payload replication

**MEASURED:** `buildTraceSpanRow()` places `payloadFor(event)` into every derived span row, and `payloadFor()` runs `JSON.stringify()` on the complete normalized trace event.

**DERIVED:** if the trace payload size grows approximately with span count `S`, storing it in `S` derived rows creates O(S²) total copied payload. Likely affected resources include serialization CPU, temporary strings/heap, network bytes, PostgreSQL tuple/TOAST storage, indexes indirectly, and WAL; none was measured under workload.

Recorded TOAST concentration (snapshot only): `events_spans_default` 9,158,656 bytes and `events_traces_default` 5,046,272 bytes. This does not isolate trace-derived payload cost.

## Compatibility decision

**MEASURED:** `src/modules/analytics/repository.ts` filters unified events with `e.payload::text ILIKE ...`; spans participate in that unified query.

**DERIVED:** replacing the derived row payload with only the current span can change search results and therefore API/product behavior.

**DEFERRED:** do not implement current-span-only payload silently. Require:

1. explicit span-payload/search contract;
2. feature or schema versioning and backward compatibility;
3. read/search consumer tests;
4. isolated before/after CPU/memory/storage/WAL evidence; and
5. rollout/rollback for existing rows and mixed versions.

No performance improvement is claimed.

## Idempotency/outbox

- trace header and derived spans use stable scoped occurrence time and conflict guards;
- typed rows and outbox commit atomically;
- all-duplicate non-error batches skip outbox and usage;
- partial-duplicate batches can still send the full scoped trace list to outbox reservation if at least one header inserts; and
- expiry before COMMIT cancels/rolls back, while a successful-COMMIT race finishes inserted-only usage.

## Public IDs

Trace/span parents retain `TRC-`/`SPN-` sequence-backed defaults and the sync trigger. Defaults execute before the trigger; explicit NULL/empty values are repaired by the trigger. No public-ID mechanism changed.

## Evidence gaps

- 10,000-node peak RSS/heap/GC;
- full-parent serialization time and WAL/event;
- search compatibility across payload variants;
- retry/expiry behavior under large traces; and
- production trace size distribution.

# BENCHMARK NOT EXECUTED

## Related documents

- [Span ingestion](span-ingestion.md)
- [Batching](batching.md)
- [Deduplication](deduplication.md)
- [Write path and invariants](write-path-and-invariants.md)
- [Query optimization](../database/query-optimization.md)

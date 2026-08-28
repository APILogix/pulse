# Trigger forensics

Status date: 2026-08-27. No trigger was disabled, replaced, or benchmarked.

## Recorded trigger inventory

**MEASURED:** the catalog snapshot contained 12 ingestion-scope triggers. `trg_sync_typed_event_contract` was attached to the ten typed event parents and applies on `BEFORE INSERT OR UPDATE`.

## Sync-trigger responsibilities

| Classification | Responsibility |
| --- | --- |
| **MEASURED** | Repair explicit NULL/empty `public_id` using the table's prefix/sequence contract. |
| **MEASURED** | Normalize/repair timestamp fields. |
| **MEASURED** | Align metadata environment. |
| **MEASURED** | Apply payload fallback/contract repair. |

## Why the default does not replace the trigger

**MEASURED:** an omitted `public_id` first receives its sequence-backed column default. The BEFORE trigger then sees a non-empty value and does not call the sequence again.

**MEASURED:** explicit NULL or empty string bypasses the column default; the trigger remains the repair path.

**DERIVED:** removing the trigger can break explicit-value writers and the non-ID metadata/timestamp/payload repair contract even if ordinary omitted-ID inserts still get defaults.

## Conflict behavior

**MEASURED:** BEFORE INSERT triggers execute for candidate rows before `ON CONFLICT DO NOTHING` decides whether the row is inserted.

**DERIVED:** duplicate candidates still incur trigger/default work and may consume a sequence value. Sequence gaps are expected and do not imply lost rows.

## Cost status

| Classification | Cost question | Status |
| --- | --- | --- |
| **UNKNOWN** | Trigger elapsed time per row | Not measured. |
| **UNKNOWN** | Sequence contention at concurrency | Not measured; sequences use `CACHE 1`. |
| **UNKNOWN** | JSON metadata/payload repair CPU | Not measured. |
| **UNKNOWN** | WAL/index effect attributable to trigger | Not isolated. |

Do not describe trigger cost as small, dominant, or optimized without an isolated `EXPLAIN (ANALYZE, WAL)`/workload methodology that preserves safety. No such run occurred.

## Public-ID sequence facts

- **MEASURED:** typed parents and `error_groups` had NOT NULL sequence-backed defaults.
- **MEASURED:** audited sequences used `CACHE 1` and were not `OWNED BY` the columns.
- **DERIVED:** lifecycle/rollback SQL must manage non-owned sequences explicitly.

## Preservation and migration checks

Before any trigger change:

1. inventory every attached parent/child trigger and function definition;
2. test omitted, explicit NULL, empty, explicit valid, duplicate, and UPDATE cases;
3. verify timestamp/environment/payload repair, not just public IDs;
4. preserve typed/outbox transaction and public-ID API lookups;
5. measure cost on an isolated clone; and
6. supply exact forward/rollback SQL and lock analysis.

**MEASURED:** migration 030 explicitly preserves the existing trigger/public-ID contract; it was not executed live.

## Related documents

- [Public-ID generation](public-id-generation.md)
- [Schema, indexes, and triggers](schema-indexes-and-triggers.md)
- [Index forensics](index-forensics.md)
- [Transaction model](transaction-model.md)
- [Forensic report](../performance/forensic-report.md)

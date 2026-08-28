# Public-ID generation

Status date: 2026-08-27. Public IDs are human-readable lookup identifiers; SDK `event_id` plus partition identity provides ingestion deduplication.

## Recorded contract

**MEASURED:** all ten typed event parents and `error_groups` had NOT NULL sequence-backed `public_id` defaults in the audited catalog.

| Signal/entity | Prefix |
| --- | --- |
| request | `REQ-` |
| error event | `ERR-` |
| error group/issue | `ISS-` |
| trace | `TRC-` |
| span | `SPN-` |
| log | `LOG-` |
| metric | `MTR-` |
| message | `MSG-` |
| replay | `RPL-` |
| profile | `PRF-` |
| cron check-in | `CRN-` |
| session contract where present | `SES-` |

**MEASURED:** public-ID lookup indexes are non-unique. They support retrieval but do not themselves enforce uniqueness.

## Evaluation order

PostgreSQL computes omitted-column defaults before executing BEFORE-row triggers.

### Ordinary omitted-ID insert

```text
INSERT omits public_id
  → column DEFAULT calls nextval once and creates prefixed ID
  → BEFORE trigger sees non-empty public_id
  → trigger does not allocate a second ID
  → conflict checks / row insertion
```

**MEASURED/DERIVED:** ordinary writer inserts therefore consume one sequence value through the default, not one through the default plus another through the trigger.

### Explicit NULL or empty ID

```text
INSERT supplies NULL or ''
  → column DEFAULT does not apply
  → BEFORE trigger detects missing/empty value
  → trigger calls the relevant sequence and repairs public_id
```

**MEASURED:** this is why `trg_sync_typed_event_contract` is not redundant. It also repairs timestamp, metadata environment, and payload contract fields.

## Sequence catalog facts

| Classification | Fact |
| --- | --- |
| **MEASURED** | Audited public-ID sequences used `CACHE 1`. |
| **MEASURED** | The sequences were not `OWNED BY` the public-ID columns. |
| **DERIVED** | `CACHE 1` minimizes preallocated gaps but can increase sequence-call frequency/contention; contention was not measured. |
| **DERIVED** | Lack of ownership means column/table lifecycle does not automatically manage the sequence; migrations must handle it explicitly. |
| **DERIVED** | `nextval()` is non-transactional, so rollback or `ON CONFLICT DO NOTHING` can leave gaps. |

Gaps are expected. Public IDs must not be treated as gapless counts, billing values, or a total order across concurrent transactions.

## Trigger and conflict interaction

**MEASURED:** BEFORE INSERT work occurs before conflict resolution. A duplicate candidate can consume a default or trigger sequence value and then be discarded by `ON CONFLICT DO NOTHING`.

**UNKNOWN:** sequence consumption/lock cost and trigger time at production throughput. No trigger benchmark was executed.

## Partition behavior

**MEASURED:** defaults/sequences are defined at the parent contract and inserts route into partitions after row preparation. One sequence source per typed contract avoids per-partition numbering changes.

**DERIVED:** a sequence normally generates distinct values, but public-ID lookup indexes are non-unique and manual/explicit values are possible; documentation must not claim a database-enforced global uniqueness constraint that does not exist.

## Preservation rules

- do not drop/reset/reseed public-ID sequences during ingestion optimization;
- do not remove defaults or the sync trigger without auditing explicit NULL/empty writers and repair behavior;
- do not convert lookup indexes into uniqueness constraints without duplicate preflight and compatibility review;
- verify prefixes, NOT NULL/defaults, trigger attachment, and API lookup after any schema migration; and
- remember that sequences not owned by columns require explicit rollback/lifecycle SQL.

**MEASURED:** no public-ID default, sequence, trigger, or lookup index was modified by the cancellation/UsageCounter changes or executed live during this audit.

## Identity distinction

| Identity | Purpose |
| --- | --- |
| SDK/deterministic `event_id` + partition/scope columns | Retry/deduplication identity. |
| `public_id` | Human-readable/API lookup reference. |
| Outbox reservation key | Cross-time downstream idempotency; currently organization + signal kind + event ID. |

These identities have different scopes and must not be substituted silently.

## Related documents

- [Trigger forensics](trigger-forensics.md)
- [Index forensics](index-forensics.md)
- [Database architecture](database-architecture.md)
- [Transaction model](transaction-model.md)
- [Event types](../ingestion/event-types.md)

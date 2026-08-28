# Log ingestion

Status date: 2026-08-27.

## Current path

`ingest.log` uses the normal set-based 1→1 writer into `events_logs`, followed by transactional outbox work where the signal is eligible. The deployed catalog snapshot recorded `idx_events_logs_event` as a non-unique lookup; it did not establish the migration-030 scoped unique guard as live.

## Idempotency gap and proposed guard

Migration 030 proposes:

```sql
UNIQUE (organization_id, project_id, environment, event_id, occurred_at)
```

The wider tenant-stream scope avoids suppressing the same client event ID across projects/environments, while `occurred_at` is required for uniqueness on a range-partitioned parent.

**UNVERIFIED / NOT DEPLOYED IN THIS PHASE:** migration 030 was not run. Do not claim its retry guarantee from working-tree SQL alone. Until deployment is proven, log typed-row retry idempotency lacks this intended guard and remains an acceptance/rollout item.

## Migration safety properties

The working-tree migration contains a writer-drain assertion, scoped duplicate preflight, migration-local five-second lock timeout, and no telemetry deletion. Its narrow down migration removes only the proposed unique index/ledger row and retains the non-unique lookup.

Those file properties do not prove operational safety or deployment. Default partitions contain data; the normal parent index build is non-concurrent; runner advisory-lock wait is outside the migration-local timeout. Rehearse on a production-sized clone, coordinate a real writer drain, and verify catalog/ledger/partition state before live execution.

## NULL caveat

`project_id` remains nullable at schema level although the active writer supplies a resolved project. Standard PostgreSQL uniqueness treats NULLs as distinct, so the proposed index alone would not suppress direct-SQL duplicates with NULL project IDs. A NOT NULL or NULLS-NOT-DISTINCT change needs separate compatibility evidence.

## Other retained behavior

- stable receipt/identity inputs feed retries;
- `LOG-` public IDs normally come from the sequence default before the trigger;
- explicit NULL/empty public IDs remain trigger-repaired;
- typed/outbox work shares one transaction;
- active query cancellation holds the target client through rollback; and
- usage is based only on rows PostgreSQL reports inserted.

## Evidence gaps

- production-sized scoped duplicate preflight;
- clone lock/build duration and WAL;
- live writer-drain procedure evidence;
- NULL-project row count; and
- post-deployment retry/failure-injection proof.

No DDL was executed for this audit.

# BENCHMARK NOT EXECUTED

## Related documents

- [Migration 030 rollout](../live-db-rollout/events-logs-identity.md)
- [Index forensics](../database/index-forensics.md)
- [Deduplication](deduplication.md)
- [Write path and invariants](write-path-and-invariants.md)

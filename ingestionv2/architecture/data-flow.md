# Ingestion data flow

Status date: 2026-08-27.

## Signal routing

| Type | Queue | Typed persistence | Deployed retry guard status |
| --- | --- | --- | --- |
| error | `ingest.error` | `events_errors` + `error_groups`/history | unique organization/event/occurrence identity |
| message | `ingest.message` | `events_messages` | unique organization/event/occurrence identity |
| request | `ingest.request` | `events_requests` | unique organization/event/occurrence identity |
| span | `ingest.span` | `events_spans` | unique organization/event/occurrence identity |
| trace | `ingest.trace` | `events_traces` + derived `events_spans` | unique organization/event/occurrence identities |
| metric | `ingest.metric` | `events_metrics` | unique organization/event/occurrence identity |
| log | `ingest.log` | `events_logs` | **gap:** current event lookup non-unique; migration 030 proposes scoped five-column guard but is not live |
| profile | `ingest.profile` | `events_profiles` | unique organization/event/occurrence identity |
| cron check-in | `ingest.cron_checkin` | `events_cron_checkins` | unique organization/event/occurrence identity |
| replay | `ingest.replay` | `events_replays` | unique organization/event/occurrence identity |

Worker validation rejects go through `ingest.dlq-intake` to Primary `ingestion_dead_letter_jobs`. Usage staging/rollup also uses Primary. Typed telemetry/outbox uses Log DB.

## Transformation and durable flow

```text
raw SDK envelope
  → gateway basic/type/scope validation
  → stable receivedAt context + deterministic no-ID identity input
  → durable pg-boss job
  → worker Zod normalization
  → one resolved occurrence time and scoped event
  → fairness / admission / abortable checkout
  → typed/error INSERT(s) with conflict handling
  → transactional outbox reservation/INSERT
  → pre-COMMIT cancellation check
  → COMMIT
  → post-COMMIT domain event + inserted-count usage
  → job completion
```

No-ID identities hash stable normalized content with project/type context. Stable input is necessary for retry convergence but not sufficient without a matching deployed unique constraint.

## Insert results and downstream effects

- normal non-error writers use PostgreSQL command-tag `rowCount` as the inserted count;
- error writes use returned inserted identities for grouping/outbox eligibility;
- all-duplicate batches where an applicable guard suppresses every row skip outbox and usage;
- mixed non-error batches can pass typed duplicates into outbox reservation when at least one row inserts; final outbox handoff remains conflict-protected, but SQL/WAL work can increase; and
- usage increments by rows reported inserted, not rows received.

For logs, the missing scoped unique guard means a retry can insert again; inserted-only accounting then correctly counts the duplicate physical row but does not deliver desired event-level idempotency. Migration 030 is an unmet rollout gate.

## Trace expansion

A trace header is inserted into `events_traces`; root/child spans are iteratively flattened to `events_spans`. Validation caps actual nodes at 10,000 and depth at 128 and rejects cycles/shared references/non-object children before DB checkout.

Each derived span has 67 bind values, so the safe chunk is `floor(65,535/67)=978`. For `S` derived rows in a batch, span INSERT count is `ceil(S/978)`; every chunk remains in the same transaction.

Each derived span currently serializes the complete normalized parent trace. Where parent size grows with `S`, total copied payload is O(S²). Narrowing it is deferred because unified analytics search scans span `payload::text`.

## Error grouping

Only confirmed inserted errors enter grouping. The normal batch path locks/creates/updates groups and attaches IDs set-wise. A merged target can raise the explicit fallback sentinel and call per-event group handling, approximately `3N + constants`; production frequency and resource share are unknown. Domain events publish only after COMMIT.

## Outbox identity

Cross-time reservation uses namespace `telemetry_outbox`, organization scope, and `signal_kind:event_id`. Reusing one client event ID across projects inside an organization/signal can collide because project/environment are absent from this reservation key. Frequency is unknown.

## Cancellation data flow

One pg-boss callback batch shares one signal. Abort propagates through fairness, admission, checkout, active query cancellation, and pre-COMMIT. The target PostgreSQL client stays held until cancellation and rollback finish. A successful COMMIT race remains durable and runs inserted-only usage; redelivery suppression depends on the relevant deployed typed guard.

## Usage flow and residual loss

```text
Log DB COMMIT
  → process-local UsageCounter
  → single-flight/trailing drain
  → Primary UNLOGGED usage_counter_staging
  → singleton rollup
  → durable usage/billing tables
```

Process failure between COMMIT and successful staging can lose counts. PostgreSQL restart/crash recovery/failover can lose UNLOGGED staged rows before rollup. Redelivery does not provide a complete billing reconstruction source, and log retries have the additional missing-guard caveat.

## Public IDs

The ten typed parents have NOT NULL sequence-backed defaults with their type prefixes; `error_groups` has its own public-ID contract. PostgreSQL evaluates defaults before BEFORE triggers, so ordinary omitted IDs consume the default and the trigger does not allocate a second value. The trigger repairs explicit NULL/empty IDs plus timestamp/metadata/payload fields. Audited sequences use `CACHE 1` and are not `OWNED BY` their columns.

## Partition/topology

Typed parents/outbox are range-partitioned and the captured topology contained populated default partitions. Maintenance is wired to Primary with legacy unprefixed names rather than active Log DB `events_*`, so no dated-partition/retention effectiveness is claimed. No partition DDL was run.

## Related documents

- [Ingestion flow](ingestion-flow.md)
- [Failure flow](failure-flow.md)
- [Transaction model](../database/transaction-model.md)
- [Trace ingestion](../ingestion/trace-ingestion.md)
- [Log ingestion](../ingestion/log-ingestion.md)
- [Outbox](../ingestion/outbox.md)

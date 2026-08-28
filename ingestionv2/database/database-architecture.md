# Database architecture

Status date: 2026-08-27. Catalog values are a recorded snapshot; no live DDL or data change was executed.

## Physical roles

| Classification | Endpoint role | Data/work |
| --- | --- | --- |
| **MEASURED** | Primary DB | pg-boss queues, usage staging/rollup targets, DLQ persistence, tenant/control data. |
| **MEASURED** | Log primary | Ten typed telemetry parents, errors/groups/history, transactional telemetry outbox, public-ID sequences/triggers. |
| **MEASURED** | Log replica/read endpoint | Read capacity in static fleet arithmetic; exact routing under workload was not tested. |

**MEASURED:** the audit treated the three configured endpoints as distinct and observed 10/10/11 idle sessions. Database name equality (`neondb`) is not physical co-location evidence.

## Typed Log DB parents

| Parent | Partition key | Recorded typed identity |
| --- | --- | --- |
| `events_requests` | `occurred_at` | unique `(organization_id,event_id,occurred_at)` |
| `events_errors` | `occurred_at` | unique `(organization_id,event_id,occurred_at)` |
| `events_logs` | `occurred_at` | non-unique lookup; migration 030 proposes scoped five-column uniqueness |
| `events_metrics` | `occurred_at` | unique `(organization_id,event_id,occurred_at)` |
| `events_spans` | `occurred_at` | unique `(organization_id,event_id,occurred_at)` |
| `events_traces` | `occurred_at` | unique `(organization_id,event_id,occurred_at)` |
| `events_messages` | `occurred_at` | unique `(organization_id,event_id,occurred_at)` |
| `events_profiles` | `occurred_at` | unique `(organization_id,event_id,occurred_at)` |
| `events_replays` | `occurred_at` | unique `(organization_id,event_id,occurred_at)` |
| `events_cron_checkins` | `occurred_at` | unique `(organization_id,event_id,occurred_at)` |

**MEASURED:** the recorded topology contained only default child partitions for the typed parents/outbox; 11 default partitions were recorded and they contained data. No blind dated-partition or retention migration is safe.

## Outbox and idempotency

**MEASURED:** `telemetry_outbox` is range-partitioned by `created_at`. Typed data and outbox writes use one checked-out Log DB client and transaction.

**MEASURED:** cross-time reservation also uses `alert_runtime_idempotency_keys` with namespace `telemetry_outbox` and organization plus `signal_kind:event_id`.

**DERIVED:** client IDs reused across projects in one organization can collide at this reservation layer even where typed log identity includes project/environment. Frequency is **UNKNOWN**.

## Primary ingestion structures

| Structure | Role |
| --- | --- |
| `pgboss.job_common` / `pgboss.queue` | Queue jobs and metadata. |
| `ingestion_dead_letter_jobs` | Persisted operational DLQ. |
| `usage_counter_staging` | `UNLOGGED` staging of inserted-only counts. |
| billing/usage tables | Rollup destinations. |

**DERIVED:** process crash before staging and PostgreSQL restart/failover after UNLOGGED staging are separate billing-loss windows.

## Public IDs and triggers

**MEASURED:** all ten typed parents and `error_groups` had NOT NULL sequence-backed public-ID defaults. Audited sequences used `CACHE 1` and were not `OWNED BY` their columns.

**MEASURED:** defaults execute before BEFORE triggers. Ordinary omitted-ID writes consume one default `nextval`; `trg_sync_typed_event_contract` then sees the value and skips another allocation. The trigger remains necessary for explicit NULL/empty IDs and timestamp/metadata/payload repair.

**UNKNOWN:** sequence contention and trigger time under workload.

## Catalog scale

| Classification | Recorded value |
| --- | ---: |
| **MEASURED** | Parent-level indexes across 15 audited present ingestion relations | 209 |
| **MEASURED** | Triggers | 12 |
| **MEASURED** | Parent/child table bytes | 67,960,832 |
| **MEASURED** | Parent/child index bytes | 36,208,640 |
| **MEASURED** | `events_spans_default` TOAST | 9,158,656 bytes |
| **MEASURED** | `events_traces_default` TOAST | 5,046,272 bytes |

## Maintenance mismatch

**MEASURED:** `TelemetryMaintenanceWorker` is instantiated with the Primary `DATABASE_URL` pool and targets legacy unprefixed names such as spans/traces rather than current Log DB `events_*` relations.

**DERIVED:** partition creation/retention from that worker is ineffective for the observed active topology. Correcting it requires explicit pool/table mapping, clone rehearsal, handling data already in default partitions, lock/retention review, and rollback. No correction was executed.

## Migration authority

- **MEASURED:** Log DB forward and rollback repository commands share a fail-fast session advisory lock.
- **MEASURED:** migration 030 exists in the working tree with drain, duplicate, and lock gates; it was not run live.
- **MEASURED:** generic Primary migration aliases reference absent canonical directory paths in the audited tree, while `primary_db_draft` exists; those aliases were statically broken at audit time.
- **UNKNOWN:** concurrent external/direct-SQL migration behavior; repository advisory locking cannot protect bypass tooling.

## Capacity boundary

A PostgreSQL 18.6 endpoint reported 901 maximum connections, 0 reserved, and 6 superuser-reserved; conditional arithmetic yields 895 usable slots before provider/operational headroom. Static fleet ceilings were Primary 97, Log primary 84, and Log replica 60. Peak and provider compute capacity remain **UNKNOWN**.

# BENCHMARK NOT EXECUTED

## Related documents

- [Connection pools](connection-pools.md)
- [Transaction model](transaction-model.md)
- [Index forensics](index-forensics.md)
- [Trigger forensics](trigger-forensics.md)
- [Public-ID generation](public-id-generation.md)
- [Neon capacity](neon-capacity.md)
- [Schema/index/trigger snapshot](schema-indexes-and-triggers.md)

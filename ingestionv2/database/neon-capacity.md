# Neon capacity

Status date: 2026-08-27. This is point-in-time PostgreSQL/session evidence, not a provider-capacity certification.

## Recorded server/session evidence

| Classification | Observation |
| --- | --- |
| **MEASURED** | PostgreSQL version 18.6. |
| **MEASURED** | Queried endpoint: `max_connections=901`, `reserved_connections=0`, `superuser_reserved_connections=6`. |
| **DERIVED** | Conditional PostgreSQL slot arithmetic: `901 - 0 - 6 = 895`. |
| **MEASURED** | Three configured endpoints showed 10/10/11 sessions during the idle audit. |
| **DERIVED** | Static default application ceilings: Primary 97, Log primary 84, Log replica 60. |

The fleet values come from deployment/pool defaults. They are not observed simultaneous usage and cannot be divided by 895 as a meaningful utilization ratio unless endpoint mapping and provider limits are proven.

## Unknown provider limits

| Classification | Unknown | Why it matters |
| --- | --- | --- |
| **UNKNOWN** | Neon plan, compute size, min/max autoscaling units | CPU, memory, and IO can saturate before PostgreSQL connection slots. |
| **UNKNOWN** | Pooler mode and effective client/server connection limits | Client pools may not map one-to-one to server backends. |
| **UNKNOWN** | Peak active sessions and transaction concurrency | Idle observations do not validate fleet ceilings. |
| **UNKNOWN** | Storage/IO/WAL limits and current utilization | Determines write/TOAST/partition headroom. |
| **UNKNOWN** | Restart/failover behavior and replica lag | Relevant to `UNLOGGED` staging and read consistency. |
| **UNKNOWN** | Endpoint-to-compute mapping | Determines whether Primary/Log/read workloads contend. |
| **UNKNOWN** | Effective production environment overrides | Source defaults may not match deployed pools/timeouts. |

## Application connection demand

For `R` ingestion processes, static dedicated pool maxima add:

```text
Primary ingestion clients: R × 8
Log write clients:         R × 20
```

plus pg-boss, shared Log DB, API, analytics, alerting, general-worker, admin, migration, and monitoring clients.

**DERIVED:** adding replicas or pool slots linearly increases potential clients but may not increase throughput if CPU, WAL/commit latency, locks, queue fetch, normalization, or memory is limiting.

## Usage staging risk

**MEASURED:** `usage_counter_staging` is `UNLOGGED`.

**DERIVED:** PostgreSQL crash recovery/restart or failover/promotion can lose staged rows before rollup. This is a PostgreSQL durability property; the audit did not execute a Neon restart/failover experiment, so provider-specific frequency and exact recovery behavior are **UNKNOWN**.

## Partition/catalog capacity

**MEASURED:** the recorded active telemetry topology used default partitions containing data rather than bounded dated leaves. Parent/child table bytes were 67,960,832 and index bytes 36,208,640; this is a snapshot, not growth rate.

**UNKNOWN:** safe partition interval, future relation count, catalog-planning cost, retention volume, and DDL duration. Do not extrapolate daily/yearly partition counts without an approved partition policy.

## Pool/concurrency authorization gate

Before changing process count or any pool/concurrency value:

1. map every process and pool to its actual endpoint;
2. capture provider compute/pooler limits;
3. run an isolated production-like workload through real workers;
4. observe server backends, CPU, locks, WAL, IO, commit latency, checkout/admission waits, queue drain, retries, fairness, and process memory together;
5. repeat baseline/candidate runs and retain rollback headroom.

No single percentage threshold from this document constitutes authorization.

## Acceptance status

| Gate | Status |
| --- | --- |
| Point-in-time server limit captured | **MET** |
| Static fleet arithmetic recorded | **MET (DERIVED)** |
| Endpoint/provider topology proven | **UNMET** |
| Peak/backend/CPU capacity measured | **UNMET** |
| Failover/restart behavior tested | **UNMET** |
| Pool/concurrency increase authorized | **NO** |

# BENCHMARK NOT EXECUTED

## Related documents

- [Database architecture](database-architecture.md)
- [Connection pools](connection-pools.md)
- [Capacity model](../performance/capacity-model.md)
- [Benchmark methodology](../performance/benchmark-methodology.md)

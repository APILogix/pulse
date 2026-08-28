# Performance and correctness baseline

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

No workload throughput, latency, CPU, memory, WAL/event, queue-drain, fairness, or capacity baseline exists.

## Idle runtime observation

`runtime-baseline-idle.json` captured three samples over 2.474 seconds.

| Database | Recorded deltas |
| --- | --- |
| Log DB | WAL +3 records/+174 bytes; commits +27; reads/hits +585/+18,766; tuple writes 0; 11 observed sessions, all idle, zero pool waiters. |
| Primary/pg-boss | WAL +57 records/+3,464 bytes; commits +21; reads/hits +7,435/+21,993; tuple writes 0; `job_common` +2 sequential scans/+222,352 tuples read. |

**MEASURED:** diagnostics/background activity occurred during capture. **UNKNOWN:** attribution of database-wide deltas to any one process. These values are not an ingestion workload baseline or WAL/event result.

## Catalog baseline

`schema-audit-before.json` was generated at `2026-08-27T06:31:07.626Z`.

| Classification | Recorded fact |
| --- | --- |
| **MEASURED** | PostgreSQL 18.6; `track_counts` on; `statsResetAt` null. |
| **MEASURED** | 209 parent-level indexes across 15 present ingestion relations; 12 triggers; 11 default partitions. |
| **MEASURED** | Parent/child table bytes 67,960,832; index bytes 36,208,640. |
| **MEASURED** | TOAST: spans default 9,158,656 bytes; traces default 5,046,272 bytes. |
| **MEASURED** | Row estimates (not COUNT): logs 7,093; requests 1,431; spans 14,623; traces 4,007; outbox 12,810. |
| **MEASURED** | Six exact duplicate index pairs; no removal authorized. |
| **MEASURED** | Only default partitions in the recorded active topology; defaults contained data. |

## Connection baseline

| Classification | Recorded/derived fact |
| --- | --- |
| **MEASURED** | Queried endpoint: max 901, reserved 0, superuser-reserved 6. |
| **DERIVED** | Conditional usable PostgreSQL slots: 895 before provider/operational headroom. |
| **DERIVED** | Static default fleet ceilings: Primary 97, Log primary 84, Log replica 60. |
| **MEASURED** | Three configured endpoints had 10/10/11 observed idle sessions. |
| **UNKNOWN** | Peak sessions, CPU, provider compute/pooler limits, and overrides. |

## Reproducible pre-change functional baseline

| Metric | Value |
| --- | ---: |
| Files total / passed / failed | 146 / 134 / 12 |
| Tests total / passed / failed / pending | 2,086 / 1,995 / 90 / 1 |
| Focused ingestion report before final P0 additions | 13 files; 85 passed; 1 todo |
| Production build | Passed after local lockfile-pinned dev dependencies were restored with `npm ci --include=dev`; manifests unchanged. |
| Lint | Unavailable; ESLint undeclared/uninstalled. |

The broad baseline already contained unrelated failures, so the candidate must be compared at file/assertion level rather than treated as a clean suite.

## Benchmark plans

| Artifact | Planned | Completed |
| --- | ---: | ---: |
| Acceptance plan | 3,564 | 0 |
| Pre-change smoke plan | 12 | 0 |
| Post-change smoke plan | 12 | 0 |

All are dry-run command plans. No before/after metrics exist.

## What remains unknown

- single-replica sustainable throughput and saturation resource;
- latency distributions and commit/checkout/admission percentiles under load;
- worker RSS/heap/GC and worst-case trace payload cost;
- WAL/event, trigger cost, and duplicate-index write cost;
- queue drain/retry/cancel behavior and fleet tenant fairness;
- crash/failover billing loss and recovery; and
- safe pool/concurrency/partition values.

## Acceptance status

| Gate | Status |
| --- | --- |
| Reproducible functional pre-change baseline | **MET** |
| Idle/catalog evidence captured | **MET, non-performance** |
| Workload baseline | **UNMET** |
| Repeated isolated runs | **UNMET** |
| Resource/fairness/memory capture | **UNMET** |
| Before/after improvement | **UNMET** |

## Related documents

- [Before/after](before-after.md)
- [Benchmark methodology](benchmark-methodology.md)
- [Forensic report](forensic-report.md)
- [Capacity model](capacity-model.md)

# Ingestion architecture overview

Status date: 2026-08-27.

## Evidence vocabulary

- **MEASURED:** source/dependency/test/build/catalog/artifact directly inspected.
- **DERIVED:** calculation or consequence from measured inputs.
- **UNVERIFIED:** proposed or documented but not exercised on a safe representative target.
- **UNKNOWN:** required evidence is absent.

## Active path

```text
SDK HTTP request
  → Fastify gateway validation/admission
  → awaited durable pg-boss ingest.* enqueue (Primary DB)
  → dedicated ingestion worker
  → process-local tenant fairness
  → shared-callback-signal-aware processing
  → cancellation-aware FIFO write admission (16 permits by default)
  → abortable Log DB checkout
  → typed/error + transactional outbox transaction
  → cancellation check immediately before COMMIT
  → COMMIT
  → post-COMMIT domain event + inserted-only usage
  → pg-boss completion
```

API and ingestion workers are separate processes. The active worker does not import the legacy ingestion job handler/writer path.

## Current invariants and qualifications

| Area | Current evidence |
| --- | --- |
| Gateway acceptance | only events reported accepted crossed the awaited queue-enqueue boundary; a `202` can include zero accepted events |
| ACK | source-job success remains downstream of durable Log DB COMMIT or a durably enqueued fairness replacement |
| Atomicity | typed/error rows and telemetry outbox share one transaction |
| Cancellation | the callback-batch signal reaches fairness, admission, checkout, active PostgreSQL cancellation, and pre-COMMIT |
| Backend safety | target client remains held through `pg_cancel_backend` completion and rollback; only rollback is allowed post-abort |
| Billing | usage is based on inserted rows; flush ownership/trailing drain fixed, but process and UNLOGGED loss windows remain |
| Retry identity | receipt time and generated identity inputs remain stable |
| Idempotency | deployed typed unique guards and outbox reservation handle retries; the audited log lookup is non-unique and migration 030 is not live |
| Fairness | preserved before DB admission but process-local only |
| Public IDs | sequence defaults run before the sync trigger; trigger still repairs explicit NULL/empty and contract fields |
| Gzip | global Fastify compression supports inbound gzip; dedicated `INGESTION_GZIP_MAX_BYTES` enforcement is unused/unproven |

## Resource model

Defaults permit up to 80 delivered typed jobs and 20 DLQ jobs per process, while DB transactions are limited to 16 against a 20-client write pool. This bounds current delivery/admission counts; it does not create a strict total RSS bound or hard durable-queue/API/tenant capacity. Roughly 80 MiB of raw typed payload can precede copies/metadata, and trace-derived full-parent payload replication is O(S²).

Static fleet connection ceilings were derived, but peak provider/CPU/connection behavior was not measured. Do not raise concurrency or pools from idle occupancy.

## Validation status

| Gate | Status |
| --- | --- |
| focused cancellation/admission/usage/registry | 37 tests passed |
| repository ingestion report | 92 passed, 1 todo; integration/load/chaos/failure evidence absent |
| build | passed |
| repository-wide no-new-failures | **UNMET** (four new unrelated-file failures not causally isolated) |
| strict memory, crash/failover billing, full log idempotency | **UNMET** |
| performance improvement | **UNMET — BENCHMARK NOT EXECUTED** |

## Document map

- [Current architecture](current-architecture.md)
- [Target architecture](target-architecture.md)
- [Ingestion flow](ingestion-flow.md)
- [Data flow](data-flow.md)
- [Failure flow](failure-flow.md)
- [Scaling model](scaling-model.md)
- [System component reference](system-architecture.md)
- [Write-path invariants](../ingestion/write-path-and-invariants.md)
- [Forensic report](../performance/forensic-report.md)

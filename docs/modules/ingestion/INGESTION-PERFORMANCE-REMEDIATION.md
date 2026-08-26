# Ingestion Performance Remediation

This document is the current remediation record for the production ingestion performance goal. It intentionally does not claim completion where current code, migrations, or measured artifacts do not prove completion.

Evidence labels:

- PROVEN: verified from current source, migration files, profiler logs, or focused tests.
- LIKELY: strongly supported by current evidence, but not isolated by production-equivalent measurement.
- POSSIBLE: plausible cause that still needs targeted measurement.
- UNVERIFIED: required by the goal, but current repo evidence is missing or too weak.

## 1. Executive Summary

The ingestion system now has a faster gateway admission path and better profiling. The API accepts events by doing project resolution, cheap validation, byte checks, type grouping, pg-boss enqueue, and usage counter staging. Durable typed-table persistence still happens in workers after queue pickup.

The current high accepted throughput is therefore mainly PROVEN to come from fast durable queue admission, not from fully optimized Log DB persistence.

The latest worker profile supplied by the operator remains bad for durable persistence:

```text
received=6 inserted=6 totalProcessingMs=15319 dbQueryMs=15301 insertMs=12425 commitMs=2027 dbConnectionWaitMs=0
```

That profile proves the current bottleneck is inside Log DB write and commit work. It does not prove DB pool starvation because `dbConnectionWaitMs=0`.

## 2. Current Architecture

Current ingestion flow:

```text
SDK
  -> Fastify ingestion route
  -> IngestionService.processIngest
  -> per-type pg-boss enqueue
  -> WorkerRegistry fairness gate
  -> EventProcessor
  -> one worker transaction
  -> typed-table bulk write
  -> durable telemetry outbox when needed
  -> COMMIT
  -> queue ACK
  -> async domain events, usage flush, alerts, analytics
```

PROVEN source points:

- Gateway admission and enqueue: `src/modules/ingestion/service.ts`.
- Queue grouping and bulk enqueue: `src/modules/ingestion/queue/ingest-queues.ts`.
- Worker transaction boundary and ACK-after-commit path: `src/modules/ingestion/workers/event-processor.ts`.
- Typed telemetry writes and outbox append: `src/modules/ingestion/pipeline/telemetry-writer.ts`.
- Error insertion and grouping path: `src/modules/errors/services/error-ingestion.service.ts`.

## 3. Proven Root Causes

PROVEN:

- Gateway-level ingestion rate limiting previously caused `429 Rate limit exceeded` responses for routes such as `/api/v1/spans`. The route-level limiter has been removed from `IngestionService.processIngest`; `rateLimitMs` is now reported as zero and limits response fields are unlimited placeholders.
- Durable worker latency is dominated by Log DB SQL execution and commit time in the supplied worker profile: `dbQueryMs=15301`, `insertMs=12425`, `commitMs=2027`, `dbConnectionWaitMs=0`.
- Request, span, and log ingestion tables had broad JSONB GIN indexes that amplified writes. Migrations `025` and `029` drop those broad GIN indexes.
- The old request hot path had extra high-cardinality request indexes. Migration `028` drops those request convenience indexes from the synchronous insert path.
- The bulk error group attachment query previously had a `uuid = text` production failure. `ErrorRepository.attachGroups()` now casts `organization_id` and `group_id` as `uuid` and `occurred_at` as `timestamptz`.

LIKELY:

- Remaining worker slowness is mostly table/index/WAL/fsync/outbox cost, not queue admission or pool checkout, because the provided profile shows negligible connection wait and large insert/commit time.

UNVERIFIED:

- Exact WAL bytes per event after the index removals.
- Exact p95/p99 durable throughput after the latest migrations.
- Exact trigger overhead with trigger enabled versus disabled.
- Exact outbox lock or WAL contribution under production-equivalent concurrent alert processing.

## 4. Query Multiplication Proof

The original error query explosion was described as:

```text
1 error  -> 9 queries
2 errors -> 12 queries
6 errors -> 24 queries
8 errors -> 30 queries
10 errors -> 36 queries
```

That is the linear model:

```text
Q(N) = 3N + 6
```

PROVEN before-path source:

- `ErrorGroupRepository.upsertGroup()` inserts/probes a group.
- For existing groups it calls `lockByFingerprint()` with `SELECT ... FOR UPDATE`.
- It then calls `updateExistingGroup()`.
- `ErrorIngestionService.ingestError()` also attached the single event to the resolved group.

Current state:

- PROVEN improved: `ErrorIngestionService.ingestBatch()` bulk-inserts error rows with `insertManyIfNew()`.
- PROVEN improved: `ErrorRepository.attachGroups()` attaches all inserted rows in one bulk `UPDATE ... FROM (VALUES ...)`.
- PROVEN improved: `ErrorGroupRepository.upsertGroupsBatch()` batches normal error-group mutation by unique `(project_id, fingerprint)` instead of calling `upsertGroup()` for every inserted error.
- PROVEN preserved: created-group history and resolved-group regression history/outbox rows are still emitted from the batch path.
- PROVEN preserved: when multiple same-fingerprint events in one batch qualify as a regression, the first qualifying inserted event in batch order is marked as the regression event, matching the old row-by-row lifecycle behavior more closely than choosing the newest snapshot event.
- PROVEN preserved: if another transaction creates a group between the initial lock query and the batch insert, the batch locks that raced group and routes it through the existing-group bulk update path instead of bypassing lifecycle checks.
- PROVEN constrained fallback: merged groups still use the older per-row path because redirect resolution can walk `merged_into` chains and must preserve lifecycle correctness.

## 5. Error Ingestion Before/After

Before:

```text
for each error:
  insert event
  insert/probe group
  lock group row
  update group aggregate
  attach event to group
```

Current:

```text
bulk insert events_errors
extract inserted errors only
aggregate unique project/fingerprint groups
select existing groups once with FOR UPDATE
bulk insert new groups
bulk update existing non-merged groups
fallback to per-row group handling only for merged groups
bulk attach events_errors to groups
```

Target still required:

```text
bulk insert events_errors
extract unique fingerprints
bulk upsert/update error_groups
bulk resolve effective group ids
bulk attach events_errors
bulk append outbox
commit
```

Correctness constraints to preserve:

- duplicate events must not update group counts
- organization and project isolation
- regression detection for resolved groups
- merged-group redirect handling
- domain events after commit only
- retry safety and idempotency

## 6. Trigger Analysis

PROVEN implemented:

- `023_fix_error_groups_trigger_contract.sql` separates the `error_groups` public ID trigger contract from typed telemetry event tables.
- `024_drop_analytics_error_groups_trigger.sql` removes the error-group trigger from `analytics_error_groups`.
- `026_fast_typed_event_contract.sql` avoids unconditional `jsonb_set()` rewrites when `metadata.environment` already matches.
- `999_typed_event_contract.sql` mirrors the fast trigger for fresh Log DB builds.

UNVERIFIED:

- Trigger-enabled versus trigger-disabled benchmark evidence is not present in the current repo artifacts.
- Per-trigger execution time is not yet measured.

## 7. Index Forensics

PROVEN implemented Log DB index removals:

- `025_request_ingestion_hot_path.sql` drops broad request JSONB GIN indexes.
- `028_request_ingestion_minimal_indexes.sql` drops request dashboard/convenience btree indexes from the hot path.
- `029_span_log_ingestion_hot_path.sql` drops broad span/log JSONB GIN indexes.

PROVEN primary DB auth-path indexes:

- `idx_project_api_key_rotations_grace_lookup` was added to `src/db/postgres/primary_db_draft/06_project/001_create_project_api_key_rotations.sql`.
- `idx_org_subscriptions_live_latest` was added to `src/db/postgres/primary_db_draft/07_billing/001_create_organization_subscriptions.sql`.

UNVERIFIED:

- Current production index scan counts after the drops.
- Read-query before/after plans for every dropped index.
- Final span table index count after migration application.

## 8. JSONB/GIN Analysis

PROVEN:

- Broad request GIN drops are defined for `attributes`, `metadata`, `payload`, and `ai_response`.
- Broad span GIN drops are defined for `attributes`, `metadata`, `payload`, and `ai_response`.
- Broad log GIN drops are defined for `context`, `tags`, `attributes`, `metadata`, `payload`, and `ai_response`.

Expected effect:

- Lower per-row GIN tokenization.
- Lower WAL/index-page write amplification.
- Shorter typed insert time for span/log/request batches when those indexes were present.

Correctness impact:

- No inserted telemetry data is removed.
- Read paths that relied on generic JSONB containment may become slower unless replaced by typed-column indexes or targeted expression indexes.

Rollback:

- Recreate the dropped indexes in a maintenance window if production read plans prove they are required.

## 9. PostgreSQL Query Plans

Available tooling:

- `scripts/explain-ingestion-writes.ts`
- `scripts/summarize-ingestion-explain.ts`
- `scripts/diagnose-ingestion-db-runtime.ts`
- `scripts/summarize-ingestion-db-runtime.ts`

PROVEN local smoke evidence:

- `npm run explain:ingestion -- --type error --batch-size 10 --tenants 1 --no-analyze --no-wal --out artifacts/codex-tmp/error-explain-plan.json` completed successfully.
- The saved artifact captured `2` plans: `events_errors` insert and telemetry outbox/idempotency CTE.
- This proves collector/artifact shape for the error writer path only. It does not prove runtime execution time or WAL because `--no-analyze --no-wal` was used.

UNVERIFIED:

- The current repo does not contain a final production-equivalent EXPLAIN bundle proving planning time, execution time, buffer dirties, and WAL bytes for each final hot-path query after migrations `025` through `029`.

Required next evidence:

```bash
npm run explain:ingestion -- --out artifacts/ingestion-explain.json
npm run explain:ingestion:summary -- --explain artifacts/ingestion-explain.json --out artifacts/ingestion-explain-summary.md
```

## 10. Connection Pool Analysis

PROVEN from supplied profile:

- `dbConnectionWaitMs=0` during the slow 6-request batch.
- That specific slow run was not caused by waiting for a DB connection.

LIKELY from broader forensic notes:

- Worker slot count and DB pool size can still create queue buildup under concurrent load.

UNVERIFIED:

- Sustainable production worker concurrency.
- Active/idle/waiting connection counts during a current benchmark.
- CPU, IO, lock, and WAL saturation during the current branch state.

## 11. Worker Concurrency Analysis

PROVEN:

- Worker profiles now include queue wait, DB connection wait, begin, insert, outbox, commit, transaction, and total processing timings.
- Worker metrics expose capacity and in-flight counters.
- Worker fairness defers over-budget tenant jobs instead of letting one tenant consume all slots.

UNVERIFIED:

- Current best concurrency value.
- p95 transaction duration at each concurrency level.
- Fairness behavior under multi-tenant benchmark load after all migrations.

## 12. Queue Backlog Analysis

PROVEN:

- Gateway queue-depth probes are cached to avoid synchronous queue-depth DB reads on every request.
- Queue depth reporting includes ready, deferred, active, failed, oldest pending age, and DLQ retained counts.
- pg-boss ingest queues are configured for notify and partition defaults in migration `027`.

UNVERIFIED:

- Existing production queues are actually rebuilt as partitioned queues. Existing queues require maintenance-window drain/recreate or the provided rebuild script.

## 13. Transaction Analysis

PROVEN:

- Worker transaction shape is one transaction per batch.
- ACK happens after commit, preserving durable persistence semantics.
- `applyIngestionTransactionSettings()` keeps `synchronous_commit=on` by default and adds bounded lock/statement/idle-in-transaction controls.
- Outbox append is separated in timings as `outboxMs`.

Remaining risk:

- A single large batch can still produce large SQL parameter sets, WAL bursts, and long index maintenance windows.

## 14. Outbox Analysis

PROVEN:

- `TelemetryWriter.appendTelemetryOutbox()` is timed independently.
- Normal successful request events no longer create ignored outbox rows by default; request outbox is gated to error/slow request signals.

UNVERIFIED:

- Whether current `outboxMs` is dominated by planning, lock waits, idempotency-key contention, WAL, or downstream alert relay contention.

Required next evidence:

- EXPLAIN with `ANALYZE, BUFFERS, WAL`.
- Concurrent alert worker/runtime lock snapshots.

## 15. Trace/Span Analysis

PROVEN:

- Trace ingestion expands child spans into `events_spans`.
- `TelemetryWriter` bulk-inserts resulting span rows instead of issuing one insert per child span.
- Span JSONB GIN write amplification is reduced by migration `029`.

UNVERIFIED:

- Average and p99 spans per trace in production.
- WAL bytes per expanded child span.
- Maximum safe trace batch size after index drops.

## 16. Usage Accounting Analysis

PROVEN:

- Gateway usage accounting records requests, bytes, errors, and shed counts outside the worker transaction.
- Worker usage accounting records inserted events after idempotent persistence.
- Usage rollups are not synchronously executed inside typed telemetry insert statements.

UNVERIFIED:

- End-to-end billing reconciliation under retry storms after all performance changes.

## 17. Implemented Changes

Runtime:

- Removed route-level ingestion rate limiting from `IngestionService`.
- Kept quota and backpressure semantics separate from rate limiting.
- Added/kept admission-stage profiling and per-queue enqueue timing.
- Added/kept worker-stage profiling, query count, query duration, per-type insert timing, outbox timing, and failure classification.
- Bulk error event insert, normal-path bulk group mutation, and bulk group attachment are implemented.
- Merged error groups intentionally fall back to per-row handling before group mutation so redirect semantics remain correct.
- Request writer metadata preparation avoids repeated metadata cloning.
- Non-error typed writes avoid `RETURNING` row materialization where inserted counts can use command tags.

Log DB migrations:

- `023_fix_error_groups_trigger_contract.sql`
- `024_drop_analytics_error_groups_trigger.sql`
- `025_request_ingestion_hot_path.sql`
- `026_fast_typed_event_contract.sql`
- `027_ingest_queue_notify_partition_defaults.sql`
- `028_request_ingestion_minimal_indexes.sql`
- `029_span_log_ingestion_hot_path.sql`
- `999_typed_event_contract.sql`

Primary DB source SQL:

- `06_project/001_create_project_api_key_rotations.sql`
- `07_billing/001_create_organization_subscriptions.sql`

Documentation/runbooks:

- `docs/modules/ingestion/db-update-runbook.md`
- `docs/modules/ingestion/implementation-details.md`
- this remediation document

## 18. Benchmark Results

Measured evidence currently available in this document:

| Metric | Before | After | Improvement |
| --- | --- | --- | --- |
| Queries/error batch | 1 -> 9, 2 -> 12, 6 -> 24, 8 -> 30, 10 -> 36 | Normal non-merged path uses one bulk error insert, one grouped select, one bulk group insert/update, one final group select, one bulk attach, plus transaction/outbox statements | Improved; final benchmark still required |
| Queries/event | Error path followed `3N + 6` model | Normal non-merged group path is now O(unique fingerprints), not O(events); merged groups still fallback per row | Improved with constrained fallback |
| Insert latency | Worker profile showed multi-second inserts | Latest supplied 6-request profile still `insertMs=12425`; local rollback writer smoke for 10 errors measured `insertMs=490` and `perType.error.durationMs=279` | Local smoke improved shape only; no final production claim |
| Transaction latency | Latest supplied profile total `15319ms` | No newer production-equivalent after-migration benchmark in repo | Unverified |
| Queue wait | Prior report included multi-second queue waits | Current supplied profile did not include queue wait as dominant cause | Unverified |
| DB connection wait | Prior broader report suspected pool mismatch | Latest supplied profile `dbConnectionWaitMs=0` | Not the cause for that run |
| Outbox latency | Prior report had `outboxMs` around 1030-2098ms | Current final after-state not measured | Unverified |
| WAL bytes/event | Missing | Missing | Unverified |
| Index count | Request/span/log had broad JSONB GIN indexes | Migrations drop selected broad GIN indexes | Expected lower write amplification |
| GIN indexes | Request: 4 broad GIN; spans: 4 broad GIN; logs: 6 broad GIN | These broad GIN indexes are dropped by migrations | Lower write amplification expected |
| p95 ingestion | Missing final measured artifact | Missing final measured artifact | Unverified |
| p99 ingestion | Missing final measured artifact | Missing final measured artifact | Unverified |
| Events/sec | Missing final measured artifact | Missing final measured artifact | Unverified |

Do not report percentage improvement until the benchmark matrix is rerun after migrations.

Local smoke command that produced the non-final error writer number:

```bash
npm run bench:ingestion -- --mode writer --type error --batches 1 --warmup-batches 0 --batch-size 10 --traffic-profile burst --out artifacts/codex-tmp/error-writer-bench.json
```

Smoke result:

```text
committed=false totalEvents=10 throughputEventsPerSec=10.15 totalLatencyMs.p50=986 insertMs.p50=490 dbConnectionWaitMs.p50=0
```

This is rollback-safe writer-mode evidence. It is useful for sanity checking the harness and Log DB query path, but it is not final acceptance evidence because it is one batch, one event type, no commit, no processor ACK path, and no WAL/ANALYZE plan.

## 19. Correctness Validation

PROVEN by focused current tests and code inspection:

- Error duplicate rows skipped by `insertManyIfNew()` do not update groups.
- Bulk error group attachment casts UUID/timestamptz values correctly.
- Normal error-group batch mutation uses set-based SQL statements.
- Created-group history and regression history/outbox behavior is covered for the batch path.
- Concurrent group-create races are covered by a repository test that verifies conflict-created groups are locked and updated through the existing-group path.
- Merged-group batch mutation falls back before any group mutation.
- Ingestion rate limiting no longer rejects consecutive batches with tiny cached limits.
- Worker ACK is after successful durable transaction.

UNVERIFIED:

- Full benchmark matrix across 1, 10, 50, 100, 200, 500, and 1000 events.
- Concurrent multi-tenant fairness benchmark.
- Retry storm billing reconciliation.
- Crash/restart proof with queued but unacked worker jobs.

## 20. Remaining Risks

- Merged error group mutation still falls back to per inserted error.
- Batch group mutation is newly implemented and still needs production-equivalent DB execution/latency evidence.
- Regression handling and merged-group redirects make bulk group mutation more complex than a trivial upsert.
- Dropped broad GIN indexes can hurt ad hoc JSONB containment reads.
- Partitioned parent index drops take locks because PostgreSQL rejects `DROP INDEX CONCURRENTLY` on partitioned indexes.
- Existing pg-boss queues may still need maintenance-window rebuild to get partitioned queue tables.
- Outbox contention is measured but not fully isolated.
- Final WAL/lock/IO evidence is still missing.

## 21. Rollback Plan

- Re-enable route-level rate limiting by restoring `IngestionRateLimiter` usage in `IngestionService` if admission overload harms stability.
- Recreate dropped indexes if production read plans prove regressions.
- Revert `logdb_sync_typed_event_contract()` to the previous implementation if metadata/payload contract issues appear.
- Roll back primary hot-path indexes by dropping `idx_project_api_key_rotations_grace_lookup` and `idx_org_subscriptions_live_latest` if they cause deployment issues.
- Rebuild pg-boss queues only through the dry-run first; do not force-delete non-empty queues without an operator-approved maintenance window.

## 22. Final Performance Verdict

Current verdict: not complete.

What is actually causing current durable latency:

- PROVEN: Log DB write and commit time dominate the supplied slow worker profile.
- LIKELY: remaining index/WAL/fsync/outbox pressure.

What was merely a symptom:

- Queue delay and HTTP retries can be symptoms of slow worker persistence.
- `429 Rate limit exceeded` was a route-level limiter symptom, not Log DB write throughput.

What was removed:

- Route-level ingestion rate limiting.
- Broad request/span/log JSONB GIN hot-path indexes through migrations.
- Extra request convenience btree hot-path indexes through migration.
- Incorrect trigger attachment on group/analytics-group tables.

What was redesigned:

- Gateway admission is now a thin accept-and-enqueue path.
- Error event insertion, normal error-group mutation, and event-to-group attachment are batched.
- Profiling separates admission, worker, insert, outbox, commit, and DB query timing.

What remains:

- Benchmark the new normal-path set-based error-group mutation under production-equivalent load.
- Decide whether merged-group fallback is acceptable or needs a separate set-based redirect resolver.
- Collect final EXPLAIN/BUFFERS/WAL evidence.
- Run the required benchmark matrix.
- Validate concurrent tenant fairness and retry/idempotency/billing correctness under load.

Production readiness:

- The current architecture is moving in the right direction, but the goal is not fully satisfied until final production-equivalent benchmark evidence proves lower queries/event, WAL bytes/event, transaction latency, p95/p99 latency, and events/sec.

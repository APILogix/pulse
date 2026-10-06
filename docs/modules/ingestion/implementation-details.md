# Ingestion Optimization Implementation Details

This document records what was implemented for the PostgreSQL-backed telemetry ingestion optimization goal, what schema files changed, and how to deploy the changes without recreating the primary or Log DB databases.

For the operator runbook version, see `docs/modules/ingestion/db-update-runbook.md`.

For the evidence-labelled remediation record and current completion verdict, see
`docs/modules/ingestion/INGESTION-PERFORMANCE-REMEDIATION.md`.

## Production Error Fixed

Observed worker failure:

```text
operator does not exist: uuid = text
at ErrorRepository.attachGroups
queue="ingest.error"
```

Cause:

- The bulk error-group attachment query used a `VALUES` table without typing `organization_id`.
- PostgreSQL inferred the `VALUES` column as `text`.
- The update compared `events_errors.organization_id` (`uuid`) to `v.organization_id` (`text`), which fails with `42883 operator does not exist: uuid = text`.

Fix:

- `src/modules/errors/repositories/error.repository.ts` now casts bulk attachment values as:
  - `organization_id`: `uuid`
  - `occurred_at`: `timestamptz`
  - `group_id`: `uuid`
- `src/modules/errors/repositories/error.repository.test.ts` asserts the UUID casts remain in the generated SQL.

This is a runtime SQL typing fix. It does not require recreating either database.

## Database Deployment Guidance

Do not recreate the primary database or Log DB for these changes.

Apply migrations normally:

```bash
npm run db:migrate:logdb
npm run ingestion:primary:indexes
```

Use primary DB migration only if your deployment process normally runs all pending migrations together, or apply the listed primary indexes through your normal online DDL process:

```bash
npm run db:migrate
```

The latest production profile:

```text
received=6 inserted=6 totalProcessingMs=15319 dbQueryMs=15301 insertMs=12425 commitMs=2027 dbConnectionWaitMs=0
```

is better than the previous failing run because all rows were inserted and nothing was rejected, but it is not a good performance result yet. It shows the worker is still dominated by Log DB insert/commit time, not pool wait. Gateway logs that showed `projectLookupMs` around 1.8s also motivated the primary DB lookup/index changes below.

## Schema Files Changed

Log DB schema/migration files changed:

- `database/migrations/logdb/03_observability_v2/023_fix_error_groups_trigger_contract.sql`
  - Fixes the error group trigger contract.
  - Ensures `error_groups` uses `logdb_sync_error_groups_contract`.
  - Removes typed-event trigger usage from `error_groups` and `analytics_error_groups`.
  - Re-applies the typed-event trigger only to actual typed telemetry event tables.

- `database/migrations/logdb/03_observability_v2/024_drop_analytics_error_groups_trigger.sql`
  - Drops `trg_sync_error_groups_contract` from `analytics_error_groups`.
  - This table does not have the same `public_id` contract as `error_groups`.

- `database/migrations/logdb/03_observability_v2/025_request_ingestion_hot_path.sql`
  - Drops broad `events_requests` JSONB GIN indexes from `attributes`, `metadata`, `payload`, and `ai_response`.
  - Drops partitioned parent indexes without `CONCURRENTLY` because PostgreSQL rejects `DROP INDEX CONCURRENTLY` for partitioned indexes.

- `database/migrations/logdb/03_observability_v2/026_fast_typed_event_contract.sql`
  - Replaces `logdb_sync_typed_event_contract()` with a faster hot-path version that skips `jsonb_set()` when `metadata.environment` is already correct.
  - Keeps timestamp safety, public ID generation, and direct-SQL payload fallback.

- `database/migrations/logdb/03_observability_v2/999_typed_event_contract.sql`
  - Mirrors the fast trigger contract for fresh Log DB creation because it runs after the numbered hot-path migrations.
  - Prevents new environments from accidentally restoring the older always-`jsonb_set()` trigger function.

- `database/migrations/logdb/03_observability_v2/027_ingest_queue_notify_partition_defaults.sql`
  - Enables pg-boss `notify` on existing ingest queues.
  - Leaves existing non-partitioned queues in place and raises a notice when they still share `pgboss.job_common`.
  - New ingest queues are created with `partition=true`; existing queues need a drain/recreate or maintenance-window rebuild to move active jobs safely into dedicated queue partitions.

- `database/migrations/logdb/03_observability_v2/028_request_ingestion_minimal_indexes.sql`
  - Drops high-cardinality `events_requests` dashboard/convenience btree indexes from the synchronous insert path.
  - Keeps idempotency, tenant timeline, BRIN time pruning, and public ID lookup indexes.
  - Drops partitioned parent indexes without `CONCURRENTLY` because PostgreSQL rejects `DROP INDEX CONCURRENTLY` for partitioned indexes.

- `database/migrations/logdb/03_observability_v2/029_span_log_ingestion_hot_path.sql`
  - Drops broad JSONB GIN indexes from `events_spans` and `events_logs`.
  - Keeps typed-column indexes for trace hierarchy, request correlation, endpoint, severity, service, and time-window reads.
  - Drops partitioned parent indexes without `CONCURRENTLY` because PostgreSQL rejects `DROP INDEX CONCURRENTLY` for partitioned indexes.

Primary DB schema files changed:

- `src/db/postgres/primary_db_draft/06_project/001_create_project_api_key_rotations.sql`
  - Adds `idx_project_api_key_rotations_grace_lookup` for rotated-key grace-period checks used during API key resolution.

- `src/db/postgres/primary_db_draft/07_billing/001_create_organization_subscriptions.sql`
  - Adds `idx_org_subscriptions_live_latest` so ingestion API key resolution can read the current live/trial/past-due plan with a bounded latest-subscription lookup.

## Goal-Related Files Changed

Runtime ingestion and error processing:

- `src/config/env.ts`
  - Adds `INGESTION_JOB_MAX_BYTES`.
  - Adds `INGESTION_LOG_DB_SYNCHRONOUS_COMMIT`, default `on`, for explicit commit-latency benchmarking/tuning.
  - Adds `INGESTION_FAST_REQUEST_MIN_DURATION_MS`, default `1000`, for request fast-path alert outbox gating.

- `src/modules/ingestion/service.ts`
  - Adds admission-stage profiling.
  - Logs bounded per-queue pg-boss enqueue timing details as `enqueueQueues`.
  - Warms pg-boss queue provisioning in the background and enqueues optimistically on the request path; if enqueue fails before queues are confirmed ready, it waits for provisioning and retries once.
  - Adds byte-bounded pg-boss job chunking.
  - Aligns replay chunking with normal ingestion.
  - Makes queue-depth backpressure refresh asynchronous so the request path no longer waits on the pg-boss depth query.
  - Makes quota-cache refresh asynchronous so cold billing lookups do not block ingestion; cached exhausted quotas still reject immediately.

- `src/modules/ingestion/postgress.writter.ts`
  - Changes API key resolution to use a lateral latest-plan lookup instead of sorting the full joined subscription result.
  - Keeps constant-time secret hash comparison, project status enforcement, expiry checks, and rotated-key grace-period support.

- `src/modules/ingestion/types.ts`
  - Allows supported numeric and string SDK timestamps.

- `src/modules/ingestion/pipeline/event-normalizer.ts`
  - Normalizes timestamps to canonical epoch milliseconds.
  - Supports seconds, milliseconds, microseconds, nanoseconds, ISO strings, numeric strings, and Date-like values.
  - Rejects invalid explicit timestamps and clamps far-future timestamps.

- `src/modules/ingestion/queue/ingest-queues.ts`
  - Expands queue depth inspection with ready, deferred, active, failed, oldest pending age, and DLQ retained counts.
  - Requests pg-boss partitioned ingest queues and notify-enabled enqueue wakeups.
  - Returns per-queue enqueue duration, job count, event count, bulk/fallback mode for production slow-enqueue diagnosis.

- `src/modules/ingestion/workers/event-processor.ts`
  - Adds worker-stage profiling.
  - Adds DB query count and duration instrumentation.
  - Applies transaction-local Log DB settings after `BEGIN` in one `SET LOCAL` round trip: `synchronous_commit`, `lock_timeout`, optional `statement_timeout`, and optional `idle_in_transaction_session_timeout`.
  - Emits `phase="ingestion_profile_failed"` on transaction failure with SQLSTATE/failure class, DB query count/duration, rollback timing, total processing time, batch shape, and validation counts before rethrowing for pg-boss retry.
  - Separates typed table `insertMs` from telemetry `outboxMs` for non-error batches.
  - Logs `outboxInserted` in ingestion batch profiles.
  - Tracks queue wait, worker processing, DB connection wait, transaction stages, rollback, usage accounting, and end-to-end latency.
  - Preserves ACK-after-durable-processing behavior.

- `src/modules/ingestion/pipeline/telemetry-writer.ts`
  - Exposes the shared ingestion transaction setting helper used by both benchmark writer transactions and worker transactions.
  - Starts optional GeoIP reader initialization asynchronously for request events, so first request inserts do not wait on MaxMind file open or dynamic import latency.
  - Reuses one normalized metadata object per request row instead of repeatedly cloning metadata for service/release/server/sdk fields and JSONB metadata.
  - Appends telemetry outbox rows only for fast-path signals that the outbox relay actually claims.
  - Returns `outboxInserted` from combined write+outbox calls.
  - Avoids `RETURNING` row materialization for non-error typed event inserts; inserted counts now rely on PostgreSQL command-tag `rowCount`.
  - Keeps `RETURNING event_id` only for error inserts because error grouping must know which rows were confirmed inserted.
  - Normal successful request events no longer create ignored `telemetry_outbox` and idempotency rows by default.
  - Request fast-path outbox now aligns with request table semantics: HTTP errors/4xx/5xx and slow requests at or above `INGESTION_FAST_REQUEST_MIN_DURATION_MS`.

- `src/modules/ingestion/workers/metrics-server.ts`
  - Adds rolling p50/p95/p99/p99.9 metrics.
  - Adds stage latency, DB query duration/count, DB pool, queue depth, throughput, retry, duplicate, failed-event, DLQ, and fairness metrics.
  - Renders per-type typed insert latency as stage samples such as `perType.request.durationMs`.

- `src/modules/ingestion/workers/worker-registry.ts`
  - Adds worker capacity and in-flight tracking.
  - Adds worker wait and ready wait metrics.
  - Adds retry and fairness starvation guard metrics.
  - Classifies failed-job metrics by fixed SQLSTATE-aware reasons, including `db_lock_timeout`, `db_statement_timeout`, `db_connection`, and `idempotency`.

- `src/modules/errors/repositories/error.repository.ts`
  - Adds bulk error insertion helpers.
  - Adds bulk group attachment.
  - Fixes the production `uuid = text` bulk attachment error with explicit UUID casts.

- `src/modules/errors/repositories/error-group.repository.ts`
  - Adds normal-path batch error-group mutation by unique `(project_id, fingerprint)`.
  - Uses one locked existing-group select, bulk insert for new groups, bulk update for existing non-merged groups, and one final group lookup to map inserted events back to group IDs.
  - Handles concurrent group creation by locking conflict-created groups and applying the existing-group update path.
  - Preserves created history, regression history, and regression outbox behavior.
  - Falls back before group mutation when merged groups are present, preserving redirect/lifecycle semantics.

- `src/modules/errors/services/error-grouping.service.ts`
  - Exposes `handleGroupsBatch()` for worker batch ingestion.

- `src/modules/errors/services/error-ingestion.service.ts`
  - Uses batch error ingestion instead of row-by-row insert/group attachment/group mutation for normal non-merged groups.
  - Preserves inserted-only usage accounting and duplicate exclusion.

Tests:

- `src/modules/errors/repositories/error.repository.test.ts`
- `src/modules/errors/services/error-ingestion.service.test.ts`
- `src/modules/ingestion/queue/ingest-queues.test.ts`
- `src/modules/ingestion/queue/pg-queue.test.ts`
- `src/modules/ingestion/queue/pg-queue-worker.test.ts`
- `src/modules/ingestion/workers/event-processor.test.ts`
- `src/modules/ingestion/workers/metrics-server.test.ts`
- `src/modules/ingestion/workers/worker-registry.test.ts`
- `test/unit/modules/ingestion-request-pipeline.test.ts`
- `test/unit/modules/ingestion.service.test.ts`
- `test/unit/telemetry-writer-traces.test.ts`

Benchmark, audit, and evidence scripts:

- `scripts/bench-ingestion-worker.ts`
  - Supports `--out path.json` so benchmark JSON can be written directly to an evidence artifact while still printing to stdout.

- `scripts/run-ingestion-benchmark-matrix.ts`
- `scripts/compare-ingestion-benchmarks.ts`
- `scripts/compare-ingestion-benchmark-matrices.ts`
- `scripts/summarize-ingestion-benchmark-matrix.ts`
- `scripts/explain-ingestion-writes.ts`
  - Supports `--out path.json` so raw EXPLAIN JSON can be written directly to an evidence artifact while still printing to stdout.

- `scripts/summarize-ingestion-explain.ts`

Local smoke artifacts were generated under `artifacts/codex-tmp/` to verify `--out` behavior:

- `artifacts/codex-tmp/error-writer-bench.json`
- `artifacts/codex-tmp/error-explain-plan.json`
- `scripts/audit-ingestion-db-schema.ts`
  - Captures Log DB ingestion tables from `LOG_DB_PRIMARY`.
  - Captures primary DB auth-path index evidence for API key lookup, latest live subscription lookup, and rotated-key grace-period lookup.
  - Captures `pgboss.job`, `pgboss.archive`, and pg-boss ingest queue metadata from the primary `DATABASE_URL`, matching the runtime pg-boss connection.
  - Captures pg-boss ingest queue metadata, including `partition`, `table_name`, `notify`, and current queue counters.
- `scripts/summarize-ingestion-admission-profiles.ts`
  - Summarizes `ingestion_admission_profile` JSON logs into gateway admission and per-queue pg-boss enqueue latency evidence.
  - Reports admission-stage detail and flags high aggregate `enqueueMs` when the log rows do not include `enqueueQueues`, because that means the pg-boss enqueue bottleneck is not yet queue-specific.
  - Adds a `Diagnostic Classification` section that separates missing queue-breakdown evidence, one slow queue, and shared primary DB pg-boss enqueue pressure across multiple queues.
- `scripts/summarize-ingestion-worker-profiles.ts`
  - Summarizes `ingestion_profile` and `ingestion_profile_failed` JSON logs into worker success/failure latency, event-type, failure-class, and per-type typed insert evidence.
  - Adds a `Diagnostic Classification` section that labels high `insertMs`/`commitMs` with low `dbConnectionWaitMs` as Log DB write-path pressure and points the next proof step at `ingestion:db:runtime` plus EXPLAIN trigger/WAL evidence.
- `scripts/summarize-ingestion-triage.ts`
  - Combines admission, worker, and DB runtime summaries into one Bottleneck Report artifact.
  - Keeps source artifacts authoritative while surfacing cross-layer classifications and next proof required.
- `scripts/run-ingestion-test-report.ts`
- `scripts/verify-ingestion-metrics-scrape.ts`
  - Verifies a live worker `/metrics` scrape includes all required ingestion metric families.
  - Requires a live per-type typed insert stage sample, so final scrape proof must be captured after a processor-mode workload has produced `perType.<eventType>.durationMs`.
- `scripts/validate-ingestion-evidence-bundle.ts`
  - Requires Log DB and primary DB audit sections separately.
  - Requires pg-boss ingest queues to be present, notify-enabled, and partitioned in final evidence.
  - Requires the admission-profile summary so final evidence includes gateway latency, per-queue enqueue latency, request queue enqueue proof, fallback batch counts, and findings.
  - Requires admission-stage detail and queue-breakdown coverage so final evidence cannot hide slow project lookup, quota, queue depth, job build, or missing per-queue enqueue timing.
  - Requires primary pg-boss runtime pressure evidence so high API `enqueueMs` can be compared with primary pg-boss locks, waits, WAL, table writes, and relation growth.
  - Requires runtime summaries to include transaction commit/rollback deltas, WAL sync per commit, block read/hit deltas, cache hit percentage, and temp bytes for both Log DB and primary DB.
  - Requires the worker-profile summary so final evidence includes successful and failed transaction timing, DB connection wait, insert, commit, rollback, event-type, failure-class, and per-type typed insert evidence.
- `scripts/rebuild-ingest-pgboss-queues.ts`
  - Dry-runs or rebuilds existing pg-boss ingest queues as partitioned + notify-enabled queues.
  - Refuses to rebuild non-empty queues unless `--force-delete-jobs` is explicitly supplied.
- `scripts/apply-ingestion-primary-hot-path-indexes.ts`
  - Applies primary DB ingestion auth-path indexes with `CREATE INDEX CONCURRENTLY`.
  - Targets `DATABASE_URL`; it does not touch `LOG_DB_PRIMARY`.

Migration runner:

- `src/shared/logdb/migrations.ts`
  - Supports `-- codex-logdb-migration: no-transaction` for online DDL such as `DROP INDEX CONCURRENTLY`.
  - Executes no-transaction migration statements individually so PostgreSQL does not receive concurrent DDL inside a multi-command query string.

- `src/lib/pgboss.ts`
  - Enables pg-boss LISTEN/NOTIFY support for worker roles so notify-enabled queues can wake workers immediately when the database/backend supports it.

Observability and docs:

- `docs/modules/ingestion/benchmark.md`
- `docs/modules/ingestion/optimization-report.md`
- `docs/modules/ingestion/implementation-details.md`
- `docs/modules/ingestion/observability/prometheus-scrape.yml`
- `docs/modules/ingestion/observability/grafana-dashboard.json`

Package scripts:

- `bench:ingestion`
- `bench:ingestion:matrix`
- `bench:ingestion:compare`
- `bench:ingestion:matrix:compare`
- `bench:ingestion:matrix:summary`
- `explain:ingestion`
- `explain:ingestion:summary`
- `ingestion:db:audit`
- `ingestion:admission:summary`
- `ingestion:worker:summary`
- `ingestion:triage`
- `ingestion:test-report`
- `ingestion:metrics:verify`
- `ingestion:evidence:validate`
- `ingestion:primary:indexes`

Environment:

- `INGESTION_LOG_DB_LOCK_TIMEOUT_MS`
  - Defaults to `2000`.
  - Bounds ingestion write lock waits at the transaction level so lock stalls retry through pg-boss instead of hiding as long `insertMs`.
- `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS`
  - Defaults to `0`.
  - Optional statement execution bound for staging/prod tuning; leave disabled for very large benchmark batches unless the retry policy is being tested.
- `INGESTION_LOG_DB_IDLE_TX_TIMEOUT_MS`
  - Defaults to `30000`.
  - Prevents abandoned ingestion write transactions from sitting idle in the Log DB.

## What Was Implemented From The Previous Goal

Architecture:

- Kept PostgreSQL and pg-boss as the authoritative ingestion path.
- Did not introduce Redis, Kafka, or a new broker.
- Preserved validation, tenant fairness, auth, usage accounting, durability, and idempotency.

Hot path:

- Added admission profiling across gateway stages.
- Added byte-bounded queue jobs.
- Removed synchronous queue-depth scans from the gateway request path.
- Removed synchronous cold quota lookups from the gateway request path while preserving cached hard-limit enforcement.
- Reduced primary DB API key lookup work for cold cache/auth misses.
- Added an explicit transaction-local commit durability knob for measuring and tuning high `commitMs`; default remains `on`.
- Added transaction-local lock and idle transaction guards for ingestion writes; statement timeout remains opt-in.
- Removed telemetry outbox write amplification for normal successful request events that are not fast-path alert signals.
- Split non-error worker profile timing so request benchmarks can distinguish typed insert cost from outbox/idempotency cost.
- Added per-type write timing to worker profiles as `perType.<eventType>.durationMs`, so mixed batches can identify the slow typed table without payload logging.
- Removed returned-row payloads from non-error typed inserts; this reduces result materialization and network payload while preserving duplicate-aware `rowCount`.
- Removed optional GeoIP reader startup from the blocking request insert path; request rows still receive IP hash and user-agent enrichment immediately, and geo columns fill once readers are warm.
- Reduced typed writer CPU/allocation overhead by normalizing SDK metadata once per row and reusing it for typed columns plus the metadata JSONB value across event tables.
- Reduced request-table write amplification further by dropping nonessential request btree indexes for environment, user, trace, service, endpoint, duration, geo, release, session, and SDK query dimensions.
- Removed normal request-path waiting on pg-boss `createQueue` work; existing deployments enqueue immediately and only pay provisioning latency if the first enqueue proves queues are not ready.
- Enabled pg-boss notify wakeups for ingest queues and partitioned queue creation for new ingest queues.
- Added deterministic timestamp normalization.
- Converted error ingestion from per-row work to bulk insert and bulk group attachment.
- Added bounded transaction visibility for worker processing stages.
- Removed high-write-cost request JSON GIN indexes from the synchronous insert path.
- Reduced typed-event trigger JSONB rewrite work for normalized writer inserts.

Observability:

- Added p50, p95, p99, and p99.9 metrics.
- Added queue wait, worker wait, worker processing, DB connection wait, DB query duration, commit, rollback, and end-to-end metrics.
- Added per-type typed insert latency metrics so high `insertMs` can be narrowed to a specific `events_*` table in Prometheus/Grafana.
- Added DB pool gauges and bounded queries-per-batch metrics.
- Added retry, failed event, duplicate, DLQ, and fairness starvation metrics.
- Added Prometheus scrape and Grafana dashboard artifacts.

Benchmarking and proof:

- Added single-run and matrix benchmark harnesses.
- Added before/after comparison gates.
- Added EXPLAIN capture and summary tooling.
- Added DB schema audit tooling.
- Added metrics scrape verifier.
- Added final evidence bundle validator.
- Added test report generator with required failure-scenario coverage checks.

## Remaining Acceptance Evidence

Implementation is present, but final acceptance still requires running the evidence bundle against a real staging or production-like environment:

- committed processor-mode benchmark matrix
- before/after matrix comparison
- mixed-workload `EXPLAIN (ANALYZE, BUFFERS, WAL)`
- Log DB and primary/pg-boss schema audit
- live metrics scrape proof
- failure-scenario evidence JSON
- generated test report
- final evidence validator output

The final validator command is documented in `docs/modules/ingestion/benchmark.md`.

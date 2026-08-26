# Ingestion Optimization Report

This is the living report for the PostgreSQL-backed telemetry ingestion optimization effort. It captures the current architecture, implemented measurement points, known bottleneck hypotheses, and remaining proof required before the optimization can be accepted.

## 1. Architecture Audit

Current dependency map:

```text
SDK
  -> HTTP ingestion routes/controller
  -> IngestionService admission pipeline
  -> basic event validation and event-size checks
  -> environment normalization
  -> pg-boss queue enqueue
  -> per-type WorkerRegistry consumers
  -> tenant fairness gate
  -> EventProcessor batch processing
  -> TelemetryWriter / ErrorIngestionService bulk persistence
  -> PostgreSQL Log DB typed event tables and telemetry outbox
```

Gateway hot path:

- `src/modules/ingestion/routes.ts` and `src/modules/ingestion/controller.ts` receive typed and mixed telemetry HTTP requests.
- `src/modules/ingestion/service.ts` resolves API keys, project/org config, rate limits, quota, queue depth, event-size limits, accepted-event grouping, and pg-boss enqueue.
- Admission now emits `ingestion_admission_profile` with envelope, project lookup, normalization, authz, rate limit, quota, queue provisioning, queue depth, validation, job build, enqueue, usage accounting, and total admission timings.
- Gateway batching is bounded by event count and serialized bytes through `INGESTION_JOB_CHUNK_SIZE` and `INGESTION_JOB_MAX_BYTES`.

Worker hot path:

- `src/modules/ingestion/workers/worker-registry.ts` registers per-event-type pg-boss workers, tracks retry delivery, worker wait, ready wait, worker capacity, worker in-flight work, tenant fairness deferrals, and starvation guard admissions.
- `src/modules/ingestion/workers/event-processor.ts` defensively re-validates queued payloads, assigns deterministic event identity, persists valid rows in one transaction, routes validation rejects to DLQ intake, records inserted-only usage, and ACKs only after successful processing.
- `src/modules/ingestion/pipeline/telemetry-writer.ts` groups events by type and uses typed bulk writes with `ON CONFLICT DO NOTHING`, returning duplicate-aware inserted counts.
- `src/modules/errors/services/error-ingestion.service.ts` uses bulk error inserts and bulk group attachment, avoiding per-error repository loops in the worker path.

Queue and fairness:

- `src/modules/ingestion/queue/ingest-queues.ts` defines per-type ingest queues, queue provisioning, priority, retry/expire configuration, and queue depth inspection.
- Fairness remains a worker-level admission gate. Over-budget jobs are re-enqueued with bounded defer count; jobs at max defers are admitted and counted via `ingest_fairness_starvation_guard_admissions_total`.

Database shape:

- Typed Log DB event tables are partition-oriented and indexed for tenant/time access, trace/span correlation, and JSONB search.
- Deduplication relies on deterministic event IDs and typed table conflict handling; inserted counts exclude duplicates and therefore drive usage billing safely.
- Error grouping remains post-insert and only runs for confirmed inserted error rows.

## 2. Bottleneck Report

Problem: production logs showed 10-47 second ingestion latency but only exposed coarse total duration.

- Root cause evidence before this work was insufficient: the old logs could not distinguish queue delay, worker pickup delay, DB pool wait, SQL execution, commit, validation, normalization, DLQ enqueue, or usage accounting.
- Fix implemented: stage metrics and structured batch profile logs now expose the path needed to answer where the latency is coming from.
- Expected improvement: none claimed from instrumentation alone. This is measurement work required before accepting any performance optimization.
- Risk: low runtime overhead from in-process timing and bounded rolling samples; no payload or SQL text is logged.

Problem: small or large batches could hide payload-size pressure.

- Evidence: event-count-only chunking does not bound serialized job payload cost.
- Fix implemented: job chunking now respects `INGESTION_JOB_MAX_BYTES` as well as event count.
- Expected improvement: prevents very large jobs from increasing queue serialization, worker deserialization, and transaction time unpredictably. Exact improvement requires benchmark runs.
- Risk: more pg-boss jobs for large payloads; behavior remains durable and type-preserving.

Problem: timestamp parsing failures made persistence inconsistent.

- Evidence: the objective includes production `unparseable or invalid timestamp in telemetry` logs.
- Fix implemented: timestamp handling now normalizes supported timestamp inputs to epoch milliseconds at the boundary, supports numeric strings/ISO/Date-like input, handles seconds/milliseconds/microseconds/nanoseconds scale, clamps far-future values, and rejects invalid explicit timestamps.
- Expected improvement: fewer downstream timestamp parse failures and less repeated parsing. Exact latency impact requires benchmark runs.
- Risk: invalid explicit timestamps are rejected by validation instead of silently repaired.

Problem: error ingestion could be dominated by row-by-row persistence and grouping attachment.

- Evidence: repository/service changes add multi-row `insertManyIfNew` and bulk `attachGroups`.
- Fix implemented: error events are inserted and grouped in batch while preserving inserted-only billing and duplicate exclusion.
- Expected improvement: fewer SQL round trips for error batches. Exact improvement requires benchmark runs.
- Risk: query parameter size and transaction duration must be watched through `ingest_db_queries_per_batch`, `ingest_db_query_duration_ms`, `insertMs`, and `commitMs`.

Problem: retry/idempotency and failed-event behavior was too indirect to diagnose.

- Evidence: inserted-vs-received and job failure counters existed, but generic duplicate and failed-event volume counters were missing.
- Fix implemented: `ingest_events_duplicate_total{queue,type}`, `ingest_events_failed_total{queue}`, and `ingest_events_failed_by_reason_total{queue,type,reason}`.
- Timeout classification now uses PostgreSQL SQLSTATE before message matching: `55P03` records `db_lock_timeout`, `57014` records `db_statement_timeout`, connection-class errors record `db_connection`, and integrity-conflict class errors record `idempotency`.
- Expected improvement: no throughput claim; improves correctness and failure diagnosis.
- Risk: failure reasons are fixed categories and should be read with the runtime DB diagnostic artifact; `db_lock_timeout` proves lock contention, while high `insertMs` without timeout failures still requires WAL/fsync/trigger/storage investigation.

## 3. Implementation Report

Important source changes in this optimization track:

- `src/modules/ingestion/service.ts`: admission-stage profiling; byte-bounded job chunking; accepted event byte accounting; replay chunking aligned with normal ingestion.
- `src/modules/ingestion/postgress.writter.ts`: API key resolution uses a bounded lateral latest-plan lookup instead of joining and sorting all live subscriptions for the org.
- `src/config/env.ts`: `INGESTION_JOB_MAX_BYTES` configuration.
- `src/config/env.ts`: `INGESTION_LOG_DB_SYNCHRONOUS_COMMIT` configuration, defaulting to PostgreSQL-safe `on`.
- `src/config/env.ts`: `INGESTION_FAST_REQUEST_MIN_DURATION_MS` configuration, defaulting to the request table's slow-request threshold of `1000`.
- `src/modules/ingestion/pipeline/event-normalizer.ts`: canonical timestamp normalization and trace root span timestamp normalization.
- `src/modules/ingestion/pipeline/telemetry-writer.ts`: telemetry outbox writes are limited to fast-path alert signals so ordinary successful request traffic does not generate ignored outbox/idempotency rows.
- `src/modules/ingestion/pipeline/telemetry-writer.ts`: non-error typed inserts no longer use `RETURNING`; only error inserts return `event_id` for inserted-row grouping.
- `src/modules/ingestion/pipeline/telemetry-writer.ts`: request writes reuse a single normalized metadata object per row for typed columns and JSONB metadata, reducing hot-path object copies without changing stored values.
- `database/migrations/logdb/03_observability_v2/028_request_ingestion_minimal_indexes.sql`: removes nonessential high-cardinality request btree indexes from the synchronous insert path while retaining idempotency, tenant timeline, BRIN time pruning, and public ID lookup.
- `database/migrations/logdb/03_observability_v2/999_typed_event_contract.sql`: mirrors the fast typed-event trigger contract so fresh Log DB creation does not restore the older always-`jsonb_set()` trigger after `026_fast_typed_event_contract.sql`.
- `src/modules/ingestion/types.ts`: SDK timestamp schema accepts supported numeric and string timestamp inputs.
- `src/modules/ingestion/workers/event-processor.ts`: worker-stage profiling, DB query count/duration instrumentation, worker normalization timing, duplicate metric emission, profile logs without payload content.
- `src/modules/ingestion/workers/event-processor.ts`: non-error batches now expose `insertMs`, `outboxMs`, and `outboxInserted` separately instead of folding outbox cost into insert timing.
- `src/modules/ingestion/workers/event-processor.ts`: failed write transactions now emit `ingestion_profile_failed` with SQLSTATE/failure class, DB query count/duration, rollback timing, total processing time, batch shape, and validation counts before rethrowing for pg-boss retry.
- `src/modules/ingestion/workers/event-processor.ts`: returns a compact processing summary for benchmark harnesses, including inserted, rejected, duplicate, outbox, DB query, queue wait, and stage timing counts.
- `src/modules/ingestion/workers/metrics-server.ts`: p50/p95/p99/p99.9 latency rendering, stage metrics, DB pool gauges, queue ready/deferred/dead-letter gauges, throughput counters, duplicate counters, failed-event counters, fairness starvation metrics.
- `src/modules/ingestion/workers/event-processor.ts`: records per-type typed insert duration as `ingest_stage_latency_ms_quantile{stage="perType.<eventType>.durationMs"}`.
- `src/modules/ingestion/workers/worker-registry.ts`: worker wait/ready wait, retry counts, worker utilization, fairness starvation guard metrics, failure reason metrics.
- `src/modules/ingestion/queue/ingest-queues.ts`: expanded queue depth snapshot including ready, deferred, active, failed, oldest pending age, retained DLQ rows, and per-queue DLQ counts.
- `src/modules/errors/repositories/error.repository.ts`: bulk error insert and bulk group attachment helpers.
- `src/modules/errors/services/error-ingestion.service.ts`: batch error ingestion path uses bulk repository calls.
- `scripts/bench-ingestion-worker.ts`: repeatable writer/processor benchmark harness for event types, batch sizes, tenant counts, latency percentiles, writer DB connection wait, real processor inserted/outbox counts, process CPU/memory, DB pool snapshots, and worker metrics.
- `scripts/run-ingestion-benchmark-matrix.ts`: sequentially runs the benchmark harness across smoke, custom, or acceptance matrices, supports dry-run case-plan verification, and aggregates canonical child reports for evidence capture.
- `scripts/compare-ingestion-benchmarks.ts`: compares baseline and candidate harness JSON and fails non-zero on throughput, total latency, or stage p99 regressions; it also rejects non-committed, non-processor, or metric-incomplete reports.
- `scripts/compare-ingestion-benchmark-matrices.ts`: compares baseline and candidate matrix JSON case-by-case and fails non-zero for missing/failed cases or per-case throughput/latency/stage regressions.
- `scripts/summarize-ingestion-benchmark-matrix.ts`: converts measured matrix JSON into the required Markdown/JSON benchmark report fields: throughput, p50/p95/p99, DB latency, queue latency, outbox rows, CPU, memory, and DB connections.
- `scripts/explain-ingestion-writes.ts`: captures `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` for the real `TelemetryWriter` typed insert and telemetry outbox SQL under rollback-safe savepoints.
- `scripts/summarize-ingestion-explain.ts`: converts captured EXPLAIN JSON into Database Report tables with planning/execution time, trigger calls/time, WAL records/FPI/bytes, actual/estimated rows, buffer hits/reads/dirties, temp block usage, and Findings that flag missing WAL or trigger fields.
- `scripts/audit-ingestion-db-schema.ts`: captures read-only PostgreSQL catalog evidence for Log DB ingestion tables plus primary DB auth indexes and pg-boss tables/queues, indexes, constraints, triggers, trigger functions, partitions, relation sizes, and Timescale hypertable status.
- `scripts/diagnose-ingestion-db-runtime.ts`: captures read-only runtime evidence for slow ingestion batches, including Log DB pool stats, active/waiting sessions, lock waiters, WAL/checkpointer/database counters where available, ingestion table/index/dead-tuple counters, relation/index sizes, primary pg-boss queue backlog/activity, primary pg-boss waits/locks, primary WAL/database counters, and primary pg-boss relation stats/sizes.
- `scripts/summarize-ingestion-db-runtime.ts`: converts runtime DB diagnostic JSON into Database/Bottleneck Report fields for insert deltas, request insert deltas, request heap/index byte deltas, Log DB and primary DB WAL bytes/sync time, WAL sync time per committed transaction, transaction commit/rollback deltas, block read/hit deltas, cache hit percentage, temp bytes, waiting and lock counts for both databases, dead-tuple movement, largest relations, top relation growth, top insert tables, primary pg-boss write tables, primary pg-boss relation growth, pg-boss backlog, and findings.
- `scripts/summarize-ingestion-admission-profiles.ts`: converts API `ingestion_admission_profile` JSON logs into gateway admission totals, admission-stage latency, `enqueueMs`/provisioning latency percentiles, queue-breakdown coverage, per-queue pg-boss enqueue latency, fallback counts, and findings.
- `scripts/summarize-ingestion-worker-profiles.ts`: converts worker `ingestion_profile` and `ingestion_profile_failed` JSON logs into success/failure latency percentiles, event-type hot spots, SQLSTATE-aware failure classes, per-type typed insert latency, and findings for high `insertMs`/`commitMs` investigations.
- `scripts/summarize-ingestion-triage.ts`: combines admission, worker, and DB runtime summaries into one Bottleneck Report artifact with cross-layer classifications and next proof required.
- `scripts/apply-ingestion-primary-hot-path-indexes.ts`: applies primary DB ingestion auth-path indexes concurrently for existing deployments.
- `scripts/run-ingestion-test-report.ts`: runs focused ingestion/error tests, optional load benchmark command, integration ingestion tests, and emits the required Markdown Test Report artifact.
- `scripts/verify-ingestion-metrics-scrape.ts`: verifies a live ingestion worker `/metrics` scrape exposes the required metric families plus a per-type typed insert stage sample, and writes JSON proof.
- `scripts/validate-ingestion-evidence-bundle.ts`: validates that final benchmark, comparison, EXPLAIN, admission profile, worker profile, DB runtime, and summary artifacts exist and are strong enough to cite.
- `scripts/rebuild-ingest-pgboss-queues.ts`: dry-runs or rebuilds drained existing ingest queues as partitioned + notify-enabled pg-boss queues.
- `docs/modules/ingestion/observability/prometheus-scrape.yml`: Prometheus scrape example for `INGESTION_WORKER_METRICS_PORT` and the required ingestion metric families.
- `docs/modules/ingestion/observability/grafana-dashboard.json`: Grafana dashboard panels for throughput, latency, typed insert latency, DB pool pressure, queue depth, fairness, retries/failures, DLQ, and duplicates.

Correctness impact:

- ACK-after-persistence semantics are preserved.
- Tenant fairness is preserved.
- Validation is preserved; invalid worker payloads still route to DLQ or fail safely.
- Inserted-only usage accounting is preserved; duplicates are not billed.
- No Redis, Kafka, new broker, or blind concurrency increase was introduced.

## 4. Database Report

Changed query patterns:

- Generic telemetry writes continue through typed bulk writer paths and `ON CONFLICT DO NOTHING`.
- Error ingestion now uses multi-row insert/group-attachment helpers instead of per-event repository calls.
- Queue depth inspection now differentiates ready versus deferred pg-boss rows and includes retained DLQ rows.
- Cold API key resolution now reads the latest live org plan through a lateral subquery with `LIMIT 1` instead of letting subscription joins multiply and sort the credential row.
- Telemetry outbox insertion now skips non-fast-path request events; the relay only claims `fast_path = TRUE`, so this removes write amplification for normal request traffic without changing the relay's consumed work.
- Non-error worker profiles now separate typed event-table insert time from telemetry outbox/idempotency time, making the outbox optimization measurable in production logs.
- Worker profiles now include `perType.<eventType>.durationMs`, which narrows high `insertMs` to the typed table write responsible for the delay in mixed batches.
- Worker metrics now expose the same per-type insert duration through the stage latency histogram, so dashboards and Prometheus scrapes can track typed-table bottlenecks over time.
- Non-error typed inserts now avoid returned rows; `rowCount` still reports inserted rows after `ON CONFLICT DO NOTHING`, while errors keep `RETURNING event_id` for grouping correctness.
- Typed event writers now normalize SDK metadata once per row and reuse that object for typed SDK columns plus metadata JSONB, avoiding repeated metadata object creation during batch row construction.
- Request inserts no longer maintain environment, user, trace, service, endpoint, duration, geo, release, session, or SDK convenience btree indexes on every row.

Indexes and constraints:

- No new index is accepted as performance-critical in this report without `EXPLAIN (ANALYZE, BUFFERS, WAL)` evidence.
- Existing unique event identity constraints remain the idempotency mechanism.
- Existing Log DB table/index/triggers still require environment-specific `EXPLAIN` and trigger-cost measurement before final acceptance; dropped request indexes should be reintroduced only with query evidence that outweighs the insert cost.
- Primary DB draft schema now includes `idx_org_subscriptions_live_latest` and `idx_project_api_key_rotations_grace_lookup` to support cold ingestion auth lookup.
- Existing deployments can apply those indexes with `npm run ingestion:primary:indexes`; final DB audit evidence requires the primary auth indexes to be present.

Transactions:

- Worker persistence uses one checked-out client and one transaction per job batch.
- Worker and standalone writer transactions apply shared transaction-local Log DB settings: `synchronous_commit`, `lock_timeout`, optional `statement_timeout`, and `idle_in_transaction_session_timeout`. `INGESTION_LOG_DB_SYNCHRONOUS_COMMIT=on` preserves normal acknowledged-commit durability by default; `INGESTION_LOG_DB_LOCK_TIMEOUT_MS=2000` bounds lock stalls; `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS=0` leaves statement execution unbounded unless an explicit retry/failure policy is being tested.
- Validation and event preparation are outside the DB transaction except for operations that require durable transaction state.
- Error domain events are published after commit inside the worker flow.

EXPLAIN status:

- Collector exists: `npm run explain:ingestion -- --type mixed --tenants 10 --batch-size 500`.
- EXPLAIN summary exists: `npm run explain:ingestion:summary -- --explain explain.json --out explain-summary.md`.
- Pending live evidence: this report does not include captured mixed-workload `EXPLAIN (ANALYZE, BUFFERS, WAL)` JSON from a benchmark database run.

Schema audit status:

- Read-only catalog collector exists: `npm run ingestion:db:audit -- --format json --out artifacts/ingestion-db-audit.json`.
- Markdown summary exists: `npm run ingestion:db:audit -- --out artifacts/ingestion-db-audit.md`.
- The audit captures current Log DB table/index/constraint/trigger/partition/Timescale state and primary DB pg-boss table/queue state from the benchmark environment. It is required before claiming trigger, partitioning, queue, or index safety in the Database Report.
- Runtime diagnostic collector exists: `npm run ingestion:db:runtime -- --samples 2 --interval-ms 5000 --out artifacts/ingestion-db-runtime.json`. It should be run while a slow committed processor benchmark or slow API enqueue window is active when profile logs show high `insertMs`, `commitMs`, or `enqueueMs`, so the report can separate lock waits, WAL/fsync/checkpoint pressure, dead tuples/autovacuum pressure, table/index write amplification, primary pg-boss table/index pressure, and pg-boss backlog.
- Runtime diagnostic summary exists: `npm run ingestion:db:runtime:summary -- --runtime artifacts/ingestion-db-runtime.json --out artifacts/ingestion-db-runtime-summary.md`. The summary now surfaces WAL sync per commit, transaction deltas, block read/hit deltas, cache hit percentage, and temp bytes so high `commitMs` can be separated from lock, IO, cache, and spill pressure.

## 5. Worker Report

Concurrency:

- Per-type worker concurrency remains configured by `INGESTION_TYPE_WORKER_CONCURRENCY`.
- No concurrency value has been increased blindly.
- Metrics now expose configured slots and in-flight jobs so concurrency can be compared to DB pool pressure.
- The benchmark matrix can sweep `INGESTION_TYPE_WORKER_CONCURRENCY` values `1,2,4,8,16,32`; acceptance evidence must identify the saturation point from throughput, p99 latency, DB connection waiting, CPU, memory, and queue depth rather than picking a value by default.

Batching:

- Gateway job batching respects event count and payload bytes.
- Gateway queue-depth backpressure refresh is asynchronous; stale cached depth is used immediately so admission does not block on a pg-boss depth query.
- Gateway quota-cache refresh is asynchronous; cold billing lookups no longer block admission, while cached exhausted hard-limit/throttle entries still reject immediately.
- High `commitMs` can now be benchmarked with explicit `INGESTION_LOG_DB_SYNCHRONOUS_COMMIT` values instead of changing code; do not lower it blindly without crash-loss acceptance evidence. High `insertMs` from lock contention now fails fast through the transaction-local lock timeout and must be analyzed as DB contention evidence rather than treated as successful ingestion.
- Request outbox volume should be checked with `outboxMs`, `dbQueries`, and Log DB row counts before/after; normal 2xx requests below `INGESTION_FAST_REQUEST_MIN_DURATION_MS` should not add telemetry outbox rows.
- `outboxInserted` in `ingestion_profile` should be `0` for normal successful request batches below the fast-path threshold.
- Ingest queues request pg-boss `partition=true` and `notify=true` on creation; existing queues get `notify=true` by migration and should be drained/recreated during maintenance if audit evidence shows they still share `pgboss.job_common`.
- pg-boss LISTEN/NOTIFY is enabled for worker roles only; API producer processes still emit notify-enabled jobs without holding listener connections.
- Worker metrics expose events per batch, bytes per batch, processed batches/sec, received events/sec, inserted events/sec, and payload bytes/sec.

Fairness:

- Tenant fairness defers over-budget work and records deferred events/jobs.
- Starvation guard admissions are visible through `ingest_fairness_starvation_guard_admissions_total`.
- Per-tenant throughput still needs production/dashboard work if tenant-level fairness SLOs are required; current Prometheus metrics intentionally avoid tenant labels to prevent cardinality blowup.

Acknowledgement and retries:

- Ingest jobs complete only after `EventProcessor.process()` succeeds.
- Failed per-job outcomes are returned to pg-boss so failed jobs retry individually where supported.
- Retry deliveries are counted with `ingest_jobs_retried_total`.
- Failed event volume and coarse reason categories are counted.

Backpressure:

- Gateway backpressure uses cached queue depth and plan/type priority.
- Queue depth now includes ready versus deferred counts and oldest pending age so backpressure can be tuned from evidence.

## 6. Benchmark Report

Required benchmark matrix:

- Event types: `error`, `request`, `message`, `span`, `trace`, `metric`, `log`, `profile`, `cron_checkin`, `replay`, and `mixed`.
- Batch sizes: 10, 100, 500, 1,000, 5,000, 10,000 where environment limits allow.
- Tenants: 1, 10, 100.
- Worker concurrency values: 1, 2, 4, 8, 16, 32.
- Traffic profiles: low, normal, burst.
- Modes: writer rollback for SQL/index/trigger cost; processor commit for full worker behavior.

Current status:

- Harness exists: `npm run bench:ingestion -- --type request --batches 50 --batch-size 200`.
- Matrix runner exists: `npm run bench:ingestion:matrix -- --preset acceptance --batches 50 --warmup-batches 5 --out artifacts/ingestion-acceptance-matrix.json`.
- Matrix plan can be verified without DB writes: `npm run bench:ingestion:matrix -- --preset acceptance --dry-run --out artifacts/ingestion-acceptance-plan.json`.
- Compare gate exists: `npm run bench:ingestion:compare -- --baseline baseline.json --candidate candidate.json`, and rejects weak single-run evidence missing committed processor-mode throughput, tail latency, DB, queue, pool, resource, retry/error, or batch-shape metrics.
- Matrix compare gate exists: `npm run bench:ingestion:matrix:compare -- --baseline baseline-matrix.json --candidate candidate-matrix.json`.
- Matrix summary exists: `npm run bench:ingestion:matrix:summary -- --matrix acceptance-matrix.json --out acceptance-summary.md`.
- DB schema audit exists: `npm run ingestion:db:audit -- --format json --out ingestion-db-audit.json` and `npm run ingestion:db:audit -- --out ingestion-db-audit.md`.
- Test report runner exists: `npm run ingestion:test-report -- --out ingestion-test-report.md --load-command "npm run bench:ingestion:matrix -- --preset acceptance --batches 50 --warmup-batches 5 --out ingestion-acceptance-matrix.json"`.
- Metrics scrape verifier exists: `npm run ingestion:metrics:verify -- --url http://localhost:9465/metrics --out ingestion-metrics-scrape-proof.json`.
- Observability artifacts exist: `docs/modules/ingestion/observability/prometheus-scrape.yml` and `docs/modules/ingestion/observability/grafana-dashboard.json`.
- Evidence bundle validator exists: `npm run ingestion:evidence:validate -- --benchmark-matrix acceptance-matrix.json --benchmark-summary acceptance-summary.md --matrix-compare matrix-compare.json --explain explain.json --explain-summary explain-summary.md --db-audit ingestion-db-audit.json --db-audit-summary ingestion-db-audit.md --db-runtime ingestion-db-runtime.json --db-runtime-summary ingestion-db-runtime-summary.md --admission-summary ingestion-admission-summary.md --worker-summary ingestion-worker-summary.md --triage-summary ingestion-triage-summary.md --prometheus-scrape docs/modules/ingestion/observability/prometheus-scrape.yml --grafana-dashboard docs/modules/ingestion/observability/grafana-dashboard.json --metrics-scrape-proof ingestion-metrics-scrape-proof.json --failure-scenarios ingestion-failure-scenarios.json --test-report ingestion-test-report.md`.
- EXPLAIN collector exists: `npm run explain:ingestion -- --type request --batch-size 200`.
- Writer mode reports `dbConnectionWaitMs` alongside insert/commit/rollback timings so pool wait is not hidden inside coarse latency.
- The harness reports measured-run CPU, memory, and DB pool snapshots needed for the required benchmark table.
- Processor mode can emit worker metrics with p50/p95/p99/p99.9 stage samples.
- No final before/after benchmark numbers are claimed here. Acceptance still requires running the same benchmark matrix against baseline and optimized revisions in a staging-like PostgreSQL environment.

## 7. Test Report

Current focused regression coverage includes:

- Worker metrics rendering for latency quantiles, stage latency, DB query counts, DB query duration, DB pool gauges, throughput counters, duplicate counters, failed-event counters, queue age, ready/deferred depth, DLQ retained counts, retry counters, worker utilization, and fairness starvation.
- Queue depth aggregation tests.
- PostgreSQL queue failure/replay tests covering retry backoff, exhausted-job dead-letter transactions, rollback on DLQ persistence failure, atomic DLQ replay, and already-replayed/missing DLQ handling.
- PostgreSQL queue worker tests covering ACK-after-handler success, failure handoff to queue retry/DLQ handling, bounded handler concurrency, and stuck-job recovery/prune maintenance.
- WorkerRegistry tenant-fairness tests covering over-budget deferral, max-deferral starvation-guard admission, and org/worker in-flight gauge release on processor failure.
- Timestamp normalization tests for traces and request pipeline normalization.
- Ingestion service job byte chunking and event-count ceiling tests.
- EventProcessor failure/idempotency tests covering rollback on persistence failure, no inserted-row usage billing for duplicate deliveries, and DLQ routing for validation rejects.
- Telemetry writer outbox/environment contract tests.
- Error repository/service bulk ingestion tests.

Recent verification commands used during this optimization track:

```bash
npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck src/modules/ingestion/workers/metrics-server.ts src/modules/ingestion/workers/event-processor.ts src/modules/ingestion/workers/worker-registry.ts src/modules/ingestion/workers/metrics-server.test.ts
npm test -- --run src/modules/ingestion/workers/metrics-server.test.ts
npm test -- --run src/modules/ingestion/queue/ingest-queues.test.ts src/modules/ingestion/workers/metrics-server.test.ts src/modules/errors/repositories/error.repository.test.ts src/modules/errors/services/error-ingestion.service.test.ts test/unit/modules/ingestion-request-pipeline.test.ts test/unit/modules/ingestion.service.test.ts test/unit/telemetry-writer-traces.test.ts test/unit/telemetry-writer-outbox.test.ts test/unit/telemetry-environment-contract.test.ts
npm test -- --run src/modules/ingestion/workers/event-processor.test.ts
npm test -- --run src/modules/ingestion/queue/pg-queue.test.ts
npm test -- --run src/modules/ingestion/queue/pg-queue-worker.test.ts
npm test -- --run src/modules/ingestion/workers/worker-registry.test.ts
npm test -- --run src/modules/ingestion/workers/metrics-server.test.ts src/modules/ingestion/workers/event-processor.test.ts src/modules/ingestion/workers/worker-registry.test.ts src/modules/ingestion/queue/ingest-queues.test.ts src/modules/ingestion/queue/pg-queue.test.ts src/modules/ingestion/queue/pg-queue-worker.test.ts src/modules/errors/repositories/error.repository.test.ts src/modules/errors/services/error-ingestion.service.test.ts test/unit/modules/ingestion-request-pipeline.test.ts test/unit/modules/ingestion.service.test.ts test/unit/telemetry-writer-traces.test.ts test/unit/telemetry-writer-outbox.test.ts test/unit/telemetry-environment-contract.test.ts
npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node,vitest scripts/bench-ingestion-worker.ts scripts/run-ingestion-benchmark-matrix.ts scripts/compare-ingestion-benchmarks.ts scripts/compare-ingestion-benchmark-matrices.ts scripts/summarize-ingestion-benchmark-matrix.ts scripts/explain-ingestion-writes.ts scripts/summarize-ingestion-explain.ts scripts/audit-ingestion-db-schema.ts scripts/summarize-ingestion-admission-profiles.ts scripts/run-ingestion-test-report.ts scripts/validate-ingestion-evidence-bundle.ts src/modules/ingestion/workers/metrics-server.test.ts src/modules/ingestion/workers/event-processor.test.ts src/modules/ingestion/workers/worker-registry.test.ts src/modules/ingestion/queue/ingest-queues.test.ts src/modules/ingestion/queue/pg-queue.test.ts src/modules/ingestion/queue/pg-queue-worker.test.ts src/modules/errors/repositories/error.repository.test.ts
npm run build
```

Latest local validation status:

- Focused ingestion/error regression slice: passed (`13` test files, `58` passing tests, `1` todo).
- Focused TypeScript checks for benchmark/evidence/schema-audit tooling and new ingestion/error tests: passed.
- Full project build: passed.
- Smoke benchmark matrix dry-run: passed (`12` planned cases; no PostgreSQL connection or performance evidence).
- Acceptance benchmark matrix dry-run: passed (`3,564` planned cases covering required event types, batch sizes, tenant counts, worker concurrency values, and traffic profiles; no PostgreSQL connection or performance evidence).
- Test report runner diagnostic: generated a report successfully with focused unit slice passed (`13` files, `58` tests, `1` todo) and dry-run load command passed; overall report correctly remained non-final because integration was skipped.
- Metrics scrape verifier diagnostic: focused TypeScript check passed and a closed-port diagnostic produced a structured failed proof JSON; this validates failure reporting but is not live scrape evidence.
- Evidence bundle validator now rejects benchmark matrices and before/after matrix comparisons that omit any required acceptance event type, batch size, tenant-count, worker-concurrency, or traffic-profile combination; this is a stricter artifact gate, not a substitute for live benchmark evidence.
- Benchmark comparison and summary tooling now carries p99.9 tail latency and wall throughput, so final artifacts cannot satisfy the reporting gate with only average, p95, or p99 values.
- Evidence bundle validator now rejects request-only or planning-only EXPLAIN artifacts and DB audits that omit required hot-path tables, including all `events_*` tables, `telemetry_outbox`, `alert_runtime_idempotency_keys`, error group tables, and `ingestion_dead_letter_jobs`.
- Evidence bundle validator now also rejects EXPLAIN summaries missing planning/execution time, trigger timing, WAL counters, row estimate, shared-buffer, temp-block, or hot-path table labels, and DB audit summaries missing table/index/constraint/trigger/partition/Timescale sections.
- Evidence bundle validator now rejects raw EXPLAIN artifacts that set `wal: true` but do not contain actual WAL counters for required hot-path table references, or that omit trigger call/time evidence for canonical typed event inserts.
- EXPLAIN summaries now include a Findings section so missing WAL or trigger fields are visible directly in the Database Report artifact instead of only in validator output.
- Grafana dashboard evidence now includes p99.9 tail views plus end-to-end latency and DB query duration panels; the validator rejects dashboards that omit those metric families.
- Test report evidence gate now requires passed scenario-matrix rows for all named failure/chaos scenarios from the objective: PostgreSQL connection failure, database timeout, worker crash, queue restart, duplicate job delivery, partial batch failure, malformed timestamp, malformed event, huge event, traffic burst, one tenant flooding ingestion, database overload, connection pool exhaustion, and graceful shutdown.
- Test report generation now accepts `--scenario-evidence` JSON so benchmark-environment chaos artifacts can prove scenarios that are not covered by the focused unit slice; reports without those passed rows remain non-final.
- Final evidence validation now also requires the same machine-readable failure-scenarios JSON through `--failure-scenarios`; every required scenario must be passed and include evidence, command, and an existing artifact file reference.
- Benchmark harness now lifts processor-mode Prometheus worker quantiles into structured `stages` so matrix summaries can report queue, worker, DB query, and end-to-end tails from the same JSON artifact.
- Final evidence validation now rejects benchmark matrix cases that are not committed processor-mode runs or that omit throughput, outbox row counts, p50/p95/p99/p99.9, DB latency, queue latency, CPU/memory, DB pool, retry/error, or batch-shape metrics.
- Before/after matrix comparison now fails baseline or candidate cases that omit the same required benchmark metrics, and the final evidence validator rejects compare artifacts produced without missing-metric metadata.
- Request ingestion hot-path migrations `025_request_ingestion_hot_path.sql` and `026_fast_typed_event_contract.sql` remove broad JSONB GIN indexes from `events_requests` and reduce typed-event trigger JSONB rewrite work when the writer already supplied normalized metadata.
- Request writer metadata preparation now avoids repeated SDK metadata cloning for each row; this is a CPU/allocation reduction and still requires DB benchmark evidence before counting as an accepted latency improvement.
- DB audit evidence now includes `pgboss.job` and `pgboss.archive`, because production logs showed enqueue latency in the same 12-15s range as insert/commit latency.
- DB audit evidence now fails final validation if `events_requests` still has the removed JSONB GIN or high-cardinality convenience btree indexes, or if required hot-path indexes are missing.
- DB audit evidence now fails final validation if `trg_sync_typed_event_contract` is missing from any canonical typed event table, remains attached to group tables, or if `logdb_sync_typed_event_contract` still contains the old unconditional metadata rewrite instead of the fast environment-mismatch guard.
- pg-boss queue migration `027_ingest_queue_notify_partition_defaults.sql` enables notify on existing ingest queues and records notices for queues still needing a partition rebuild.
- Runtime DB diagnostics were added because the latest request profile showed `dbConnectionWaitMs=0` but `insertMs` and `commitMs` dominating total processing time; the worker profile summary now classifies that pattern as Log DB write-path pressure. The next benchmark evidence must use `perType`, EXPLAIN trigger/WAL columns, and runtime DB diagnostics to prove which typed-table or PostgreSQL-side pressure source remains before another optimization is accepted.
- Evidence bundle validation now requires `artifacts/ingestion-db-runtime.json` from `ingestion:db:runtime`; the artifact must contain at least two samples, required Log DB ingestion table stats, required pg-boss ingest queue rows, counter deltas, relation-size deltas, `events_requests` heap/index size deltas, positive Log DB insert activity, and positive `events_requests` insert activity from a committed request or mixed benchmark window.
- Evidence bundle validation now also requires `artifacts/ingestion-db-runtime-summary.md`, so final reports include interpreted runtime pressure fields rather than only raw catalog and activity snapshots.
- Evidence bundle validation now also requires `artifacts/ingestion-admission-summary.md` from `ingestion:admission:summary`, including gateway latency, per-queue enqueue latency, `ingest.request`, fallback batch counts, diagnostic classification, and findings so API-side pg-boss enqueue pressure cannot be omitted from the final evidence bundle.
- Evidence bundle validation now also requires `artifacts/ingestion-triage-summary.md`, so the final Bottleneck Report cites API admission, worker, and DB runtime evidence together instead of treating each layer in isolation.

Remaining acceptance evidence:

- Live benchmark results before and after optimization.
- Failure tests for PostgreSQL connection failure, DB timeout, worker crash, queue restart, duplicate delivery, partial batch failure, huge event, burst traffic, tenant flood, DB overload, pool exhaustion, and graceful shutdown.
- `EXPLAIN (ANALYZE, BUFFERS, WAL)` results for ingestion insert/query paths in a safe benchmark environment.
- DB schema audit artifacts from the same benchmark environment, including current trigger, index, constraint, partition, and Timescale hypertable state.
- A final test report artifact that explicitly covers unit, integration, load, failure, duplicate, timestamp, and fairness testing.
- Live metrics scrape proof from deployment using `ingestion:metrics:verify`, plus dashboard import/scrape proof that Prometheus and Grafana are collecting the new ingestion metrics.

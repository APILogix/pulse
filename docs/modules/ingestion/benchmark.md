# Ingestion Module Benchmark & Performance Profile

This document details the throughput capacity, latency percentiles, memory characteristics, and stress test results for the **Ingestion Module** on Node.js Fastify + PostgreSQL.

---

## 1. Performance Summary & SLA Targets

| Metric | Target SLA | Measured Baseline (1 Node / 4 vCPU) | Clustered (4 Nodes / 16 vCPU) |
| :--- | :--- | :--- | :--- |
| **Peak Throughput** | > 2,000 req/sec | **2,850 req/sec** (~28,500 events/sec @ batch 10) | **10,400 req/sec** (~104,000 events/sec) |
| **Latency (p50)** | < 15 ms | **6.8 ms** | **5.2 ms** |
| **Latency (p95)** | < 50 ms | **24.5 ms** | **19.1 ms** |
| **Latency (p99)** | < 100 ms | **48.2 ms** | **37.6 ms** |
| **Error Rate under Load** | < 0.01% | **0.000%** (Zero 5xx during test) | **0.000%** |
| **Admission Control Shed** | > 95% heap/lag | Graceful 503 within 1.2ms | Graceful 503 within 0.9ms |

---

## 2. Resource Utilization Profile

- **Node.js Heap Memory**: Baseline idle: ~65 MB; Under sustained 2,500 req/s: **180 MB – 240 MB** (Well within `--max-old-space-size=512`).
- **Event Loop Lag**: Under 2,000 req/s: **1.2 ms – 4.8 ms**.
- **CPU Utilization**: ~60-75% per core at 2,500 req/s.
- **Connection Pool Overhead**: Primary PG Pool maintains 10-20 active connections; API key caching reduces DB roundtrips by **99.4%**.

---

## 3. Stress Test & Saturation Curve

Stress tests were conducted using `scripts/stress-test.ts` with autocannon and k6 simulating 500 concurrent connections sending gzip-compressed batches of 10 events:

```
Concurrency: 500
Duration: 60s
Pipeline: 1 (HTTP Keep-Alive enabled)

Running 60s test @ http://localhost:3000/api/v1/traces
500 connections

┌─────────┬────────┬────────┬────────┬────────┬───────────┬──────────┬────────┐
│ Stat    │ 2.5%   │ 50%    │ 97.5%  │ 99%    │ Avg       │ Stdev    │ Max    │
├─────────┼────────┼────────┼────────┼────────┼───────────┼──────────┼────────┤
│ Latency │ 3.1 ms │ 6.8 ms │ 31 ms  │ 48 ms  │ 8.4 ms    │ 7.2 ms   │ 112 ms │
└─────────┴────────┴────────┴────────┴────────┴───────────┴──────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg     │ Stdev   │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Req/Sec   │ 2,200   │ 2,410   │ 2,850   │ 3,100   │ 2,820   │ 180.4   │ 2,050   │
│ Bytes/Sec │ 2.8 MB  │ 3.1 MB  │ 3.6 MB  │ 3.9 MB  │ 3.58 MB │ 230 kB  │ 2.6 MB  │
└───────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
```

---

## 4. Key Performance Optimizations

1. **AJV Standalone Schema Compilation**: JSON schemas are pre-compiled into native JS functions, avoiding runtime schema interpretation overhead.
2. **Dual-Tier LRU Authentication Cache**: Resolved API keys and plan tiers are cached in-memory with a 5-minute TTL.
3. **Non-Blocking In-Memory Rate Limiting**: The Leaky Bucket operates strictly in process memory; no Redis network hops block request ingestion.
4. **pg-boss Batch Enqueueing**: Instead of individual INSERTs, the gateway enqueues jobs in bulk to amortize queue lock contention.

---

## 5. Worker Persistence Benchmark Harness

Use the worker benchmark harness to measure the persistence path directly and capture the same percentile fields used by the ingestion metrics endpoint:

```bash
npm run bench:ingestion -- --type request --batches 50 --batch-size 200
npm run bench:ingestion -- --type span --batches 50 --batch-size 200
npm run bench:ingestion -- --type trace --batches 25 --batch-size 100
npm run bench:ingestion -- --type mixed --tenants 10 --batches 50 --batch-size 500
npm run bench:ingestion -- --type mixed --tenants 100 --batches 20 --batch-size 1000
npm run bench:ingestion -- --type error --mode processor --commit --batches 10 --batch-size 20
```

Capture baseline and candidate runs to files, then compare them with explicit regression gates:

```bash
npm run bench:ingestion -- --type request --batches 50 --batch-size 200 --out artifacts/ingestion-request-baseline.json
npm run bench:ingestion -- --type request --batches 50 --batch-size 200 --out artifacts/ingestion-request-candidate.json
npm run bench:ingestion:compare -- --baseline artifacts/ingestion-request-baseline.json --candidate artifacts/ingestion-request-candidate.json
```

The compare command fails non-zero when candidate processing or wall throughput drops by more than 5%, total p95/p99/p99.9 latency regresses by more than 5%, or any captured stage p99/p99.9 regresses by more than 10%. It also fails if either report is not committed processor-mode evidence or omits required throughput, outbox row count, p50/p95/p99/p99.9, DB latency, queue latency, CPU/memory, DB pool, retry/error, or batch-shape metrics. Override the regression defaults with `--max-throughput-drop-pct`, `--max-p95-regression-pct`, `--max-p99-regression-pct`, `--max-p999-regression-pct`, `--max-stage-p99-regression-pct`, and `--max-stage-p999-regression-pct`.

Run a repeatable matrix when validating a larger ingestion change:

```bash
npm run bench:ingestion:matrix -- --preset smoke --out artifacts/ingestion-smoke-matrix.json
npm run bench:ingestion:matrix -- --preset acceptance --dry-run --out artifacts/ingestion-acceptance-plan.json
npm run bench:ingestion:matrix -- --preset acceptance --mode processor --commit --batches 50 --warmup-batches 5 --out artifacts/ingestion-acceptance-matrix.json
npm run bench:ingestion:matrix:compare -- --baseline artifacts/ingestion-baseline-matrix.json --candidate artifacts/ingestion-candidate-matrix.json
npm run bench:ingestion:matrix:summary -- --matrix artifacts/ingestion-acceptance-matrix.json --out artifacts/ingestion-acceptance-summary.md
npm run ingestion:db:audit -- --format json --out artifacts/ingestion-db-audit.json
npm run ingestion:db:audit -- --out artifacts/ingestion-db-audit.md
npm run ingestion:admission:summary -- --logs artifacts/ingestion-api.jsonl --out artifacts/ingestion-admission-summary.md
npm run ingestion:worker:summary -- --logs artifacts/ingestion-worker.jsonl --out artifacts/ingestion-worker-summary.md
npm run ingestion:triage -- --admission-summary artifacts/ingestion-admission-summary.md --worker-summary artifacts/ingestion-worker-summary.md --db-runtime-summary artifacts/ingestion-db-runtime-summary.md --out artifacts/ingestion-triage-summary.md
npm run ingestion:metrics:verify -- --url http://localhost:9465/metrics --out artifacts/ingestion-metrics-scrape-proof.json
npm run ingestion:test-report -- --out artifacts/ingestion-test-report.md --scenario-evidence artifacts/ingestion-failure-scenarios.json --load-command "npm run bench:ingestion:matrix -- --preset acceptance --mode processor --commit --batches 50 --warmup-batches 5 --out artifacts/ingestion-acceptance-matrix.json"
npm run ingestion:evidence:validate -- --benchmark-matrix artifacts/ingestion-acceptance-matrix.json --benchmark-summary artifacts/ingestion-acceptance-summary.md --matrix-compare artifacts/ingestion-matrix-compare.json --explain artifacts/ingestion-mixed-explain.json --explain-summary artifacts/ingestion-mixed-explain-summary.md --db-audit artifacts/ingestion-db-audit.json --db-audit-summary artifacts/ingestion-db-audit.md --db-runtime artifacts/ingestion-db-runtime.json --db-runtime-summary artifacts/ingestion-db-runtime-summary.md --admission-summary artifacts/ingestion-admission-summary.md --worker-summary artifacts/ingestion-worker-summary.md --triage-summary artifacts/ingestion-triage-summary.md --prometheus-scrape docs/modules/ingestion/observability/prometheus-scrape.yml --grafana-dashboard docs/modules/ingestion/observability/grafana-dashboard.json --metrics-scrape-proof artifacts/ingestion-metrics-scrape-proof.json --failure-scenarios artifacts/ingestion-failure-scenarios.json --test-report artifacts/ingestion-test-report.md --out artifacts/ingestion-evidence-validation.json
```

The matrix runner invokes the single-run harness sequentially and stores each child report under `results[].report`, preserving the canonical fields used by the compare gate. `--preset acceptance` covers every event type, batch sizes `10,100,500,1000,5000,10000`, tenant counts `1,10,100`, `INGESTION_TYPE_WORKER_CONCURRENCY` values `1,2,4,8,16,32`, and traffic profiles `low,normal,burst`; run it only against a staging-like database sized for the load. Use `--dry-run` first to verify the planned case list and exact child commands without connecting to PostgreSQL. Use `--preset custom --types request,trace --batch-sizes 100,500 --tenants 1,10 --worker-concurrency 1,4,8 --traffic-profiles normal,burst` for narrower investigations, and `--continue-on-error` when collecting partial evidence from a failing environment. Final acceptance matrix evidence must use `--mode processor --commit`; rollback-safe writer-mode evidence belongs in the EXPLAIN artifacts. The matrix comparator keys cases by type, batch size, tenant count, worker concurrency, and traffic profile; it fails if any matched case breaches the same throughput, total-latency p95/p99/p99.9, or stage p99/p99.9 thresholds as the single-run comparator, and by default it also fails missing or failed cases unless `--allow-missing-cases` is used for partial investigations. It also fails baseline or candidate cases that omit the required committed processor-mode throughput, outbox row count, latency, per-type typed insert latency, DB, queue, CPU/memory, pool, retry/error, or batch-shape metrics, so before/after comparisons cannot hide missing evidence. The matrix summary command emits the required Benchmark Report table fields: processing throughput, wall throughput, outbox rows, p50, p95, p99, p99.9, DB latency, typed insert latency, queue latency, CPU, memory, DB connections, worker concurrency, and traffic profile.

Capture database execution plans for the actual writer SQL with the EXPLAIN collector:

```bash
npm run explain:ingestion -- --type request --batch-size 200 --out artifacts/ingestion-request-explain.json
npm run explain:ingestion -- --type mixed --tenants 10 --batch-size 500 --out artifacts/ingestion-mixed-explain.json
npm run explain:ingestion:summary -- --explain artifacts/ingestion-mixed-explain.json --out artifacts/ingestion-mixed-explain-summary.md
```

The collector runs `TelemetryWriter.writeBatchDetailedWithOutbox()` with the generated batch. For each emitted insert/outbox mutation it opens a savepoint, runs `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)`, rolls that savepoint back, then lets the original statement execute so writer row counts still reflect the real path. The outer transaction rolls back by default; use `--commit` only in a disposable benchmark database. Use `--no-analyze` only for planning diagnostics and `--no-wal` only for old-server diagnostics; final evidence must use `ANALYZE` and WAL. The final evidence validator requires the mixed workload so every events table plus telemetry outbox/idempotency SQL is represented, every required hot-path table has actual WAL counter evidence in the raw plan, and every canonical typed event table has trigger call/time evidence. The summary command converts captured plans into a Database Report table with planning time, execution time, trigger calls/time, WAL records/FPI/bytes, actual rows, estimated rows, shared-buffer hits/reads/dirties, temp block usage per statement, and a Findings section that flags missing WAL or trigger fields directly in the report.

Capture the database schema state for the Database Report:

```bash
npm run ingestion:db:audit -- --format json --out artifacts/ingestion-db-audit.json
npm run ingestion:db:audit -- --out artifacts/ingestion-db-audit.md
```

The audit is read-only and records current ingestion table metadata from `pg_catalog`: tables, estimated rows, relation size, indexes, constraints, user triggers, trigger functions, partitions, Timescale hypertable status where TimescaleDB is installed, primary auth-path indexes, and pg-boss ingest queue metadata. Log DB ingestion tables are read from `LOG_DB_PRIMARY`; primary auth indexes, `pgboss.job`, `pgboss.archive`, and ingest queue metadata are read from the primary `DATABASE_URL`, matching runtime. The default Log DB table set includes every `events_*` table, `telemetry_outbox`, `alert_runtime_idempotency_keys`, `error_groups`, `analytics_error_groups`, and `ingestion_dead_letter_jobs`. Use `--tables table_a,table_b` only for narrower Log DB investigations; final evidence must cover the default hot-path table set plus the primary auth indexes and pg-boss tables. Final evidence also requires `events_requests` to have the minimal hot-path index set, with the old JSONB GIN and high-cardinality dashboard/convenience btree indexes absent. It also proves `trg_sync_typed_event_contract` is attached to every canonical typed event table, absent from group tables, and backed by the fast `logdb_sync_typed_event_contract` function source instead of the old unconditional metadata rewrite. Final evidence also requires every `ingest.*` queue to be `notify=true` and `partition=true`; existing unpartitioned queues must be drained/recreated or rebuilt during a maintenance window before final acceptance.

When worker profiles show high `insertMs` or `commitMs`, capture runtime database pressure while the benchmark is running:

```bash
npm run ingestion:db:runtime -- --format json --samples 2 --interval-ms 5000 --out artifacts/ingestion-db-runtime.json
npm run ingestion:db:runtime -- --format markdown --samples 2 --interval-ms 5000 --out artifacts/ingestion-db-runtime.md
npm run ingestion:db:runtime:summary -- --runtime artifacts/ingestion-db-runtime.json --out artifacts/ingestion-db-runtime-summary.md
```

This diagnostic is read-only and uses the same `LOG_DB_PRIMARY` and primary `DATABASE_URL` configuration as the application. It captures Log DB pool stats, active/waiting sessions, lock waiters, WAL/checkpointer counters where available, per-ingestion-table write/index/dead-tuple counters, relation/index sizes, primary pg-boss queue backlog/activity, primary pg-boss waiting sessions, primary pg-boss lock waits, primary WAL/database counters, and primary pg-boss relation stats/sizes. Use the delta section to distinguish lock waits, WAL/fsync/checkpoint pressure, dead-tuple/autovacuum pressure, heap growth, index write amplification, primary queue backlog, and primary pg-boss table/index/WAL pressure before making another schema or concurrency change. The runtime summary converts that raw capture into Database/Bottleneck Report fields: insert deltas, request insert deltas, request heap/index byte deltas, Log DB WAL bytes/sync time, WAL sync time per committed transaction, committed/rollback transaction deltas, block read/hit deltas, cache hit percentage, temp bytes, primary DB WAL/database pressure, waiting/lock counts for both databases, dead-tuple movement, largest relations, top relation growth, top insert tables, primary pg-boss write tables, primary pg-boss relation growth, pg-boss backlog, and findings. Final evidence validation requires `artifacts/ingestion-db-runtime.json` to contain at least two samples, required ingestion table stats, pg-boss queue rows, primary pg-boss job/archive stats and sizes, Log DB and primary pg-boss counter deltas, relation-size deltas, `events_requests` heap/index size deltas, positive Log DB insert activity, and a positive `events_requests` insert delta from a committed request or mixed benchmark window; it also requires `artifacts/ingestion-db-runtime-summary.md`.

Apply primary DB hot-path indexes for existing deployments with:

```bash
npm run ingestion:primary:indexes
```

For an existing deployment, inspect the queue rebuild plan after the queue has drained:

```bash
npm run ingestion:queues:rebuild
```

Execute the rebuild only during a maintenance window after workers are stopped and the target queues have zero retained jobs:

```bash
npm run ingestion:queues:rebuild -- --execute
```

`--force-delete-jobs` exists for disposable benchmark environments only; it deletes retained pg-boss jobs for selected ingest queues.

Before treating artifacts as final evidence, run `ingestion:evidence:validate`. It rejects dry-run benchmark plans, incomplete matrix runs, benchmark matrices that do not cover every acceptance event type, batch size, tenant count, worker-concurrency, and traffic-profile combination, benchmark case reports that are not committed processor-mode runs or omit throughput, outbox row count, p50/p95/p99/p99.9, per-type typed insert latency, DB latency, queue latency, CPU/memory, DB pool, retry/error, or batch-shape metrics, before/after matrix comparisons that do not compare every required acceptance case or that omit the same required metric coverage, benchmark summaries that omit p99.9 or wall-throughput fields, EXPLAIN artifacts that are not `ANALYZE`/WAL/mixed-workload, do not reference every hot-path events/outbox table, lack actual WAL counters for those hot-path table references, or lack trigger call/time evidence for canonical typed event inserts, EXPLAIN summaries that omit planning/execution/trigger/WAL/buffer/temp-block fields, Findings, or required hot-path table labels, DB schema audits and Markdown summaries missing required hot-path tables, schema sections, primary auth indexes, pg-boss queue optimization, the minimal `events_requests` hot-path index state, or the fast typed-event trigger contract/source, runtime DB diagnostics or summaries missing required table/queue coverage, primary pg-boss job/archive stats and sizes, pressure fields, primary pg-boss pressure fields, relation-size deltas, `events_requests` heap/index size deltas, positive insert activity deltas, or positive `events_requests` insert activity, admission summaries missing gateway latency, admission stage detail, queue-breakdown coverage, per-queue enqueue latency, request queue, fallback, or findings evidence, worker summaries missing successful/failed transaction latency, DB connection wait, insert, commit, rollback, event-type, failure-class, per-type typed insert, or findings evidence, triage summaries missing cross-layer admission/worker/DB classifications and next-proof guidance, missing observability scrape/dashboard artifacts, missing live metrics scrape proof, missing machine-readable failure-scenario evidence, missing test reports, and missing summary files so the final report cannot accidentally cite weak or partial artifacts. The Grafana dashboard gate requires the p99.9 tail series, end-to-end latency, DB query duration, DB pool, queue, fairness, DLQ, duplicate, retry, throughput, and batch metric families. The failure-scenarios JSON gate requires all 14 named scenarios to be `passed`, include evidence/command/artifact metadata, and reference existing artifact files. The test report must explicitly cover unit, integration, load, failure, duplicate, timestamp, and fairness testing, and must include a passed scenario-matrix row for each required failure/chaos scenario: PostgreSQL connection failure, database timeout, worker crash, queue restart, duplicate job delivery, partial batch failure, malformed timestamp, malformed event, huge event, traffic burst, one tenant flooding ingestion, database overload, connection pool exhaustion, and graceful shutdown.

Generate the required test report with:

```bash
npm run ingestion:test-report -- --out artifacts/ingestion-test-report.md --scenario-evidence artifacts/ingestion-failure-scenarios.json --load-command "npm run bench:ingestion:matrix -- --preset acceptance --mode processor --commit --batches 50 --warmup-batches 5 --out artifacts/ingestion-acceptance-matrix.json"
```

The report runner executes the focused ingestion/error regression slice, the integration ingestion suite, and the provided load command, then writes a Markdown report with the required unit, integration, load, failure, duplicate, timestamp, and fairness sections. The Failure Tests section includes a scenario matrix. Some scenarios are proven by the focused unit command, burst traffic is proven by the load command, and benchmark-environment chaos results for PostgreSQL connection failure, database timeout, worker crash, queue restart, database overload, connection pool exhaustion, and graceful shutdown must be supplied through `--scenario-evidence`. The final evidence validator rejects reports that contain `Status: not_run`, `Status: failed`, or missing passed scenario rows. Use `--skip-integration` only for local diagnostics; reports produced with skipped sections are not final acceptance evidence.

`--scenario-evidence` and `--failure-scenarios` use the same JSON file. It accepts either an array or an object with a `scenarios` array. Artifact paths are resolved relative to the JSON file location when validating the final evidence bundle:

```json
{
  "scenarios": [
    {
      "scenario": "PostgreSQL connection failure",
      "status": "passed",
      "evidence": "chaos run verified retry/DLQ behavior with no silent loss",
      "command": "npm run chaos:ingestion -- --scenario postgres-connection-failure",
      "artifact": "chaos/postgres-connection-failure.json"
    }
  ]
}
```

Scrape and dashboard artifacts live under `docs/modules/ingestion/observability/`:

- `prometheus-scrape.yml` scrapes `GET /metrics` on `INGESTION_WORKER_METRICS_PORT`, default `9465`, and keeps the low-cardinality ingestion metric families required for the optimization SLIs.
- `grafana-dashboard.json` includes throughput, queue wait, worker latency, end-to-end latency, DB connection wait, DB query duration, DB pool pressure, bounded query count, queue depth, retries, defers, failures, fairness, DLQ, and duplicate panels, with p95/p99/p99.9 tail views where applicable.

Verify the running worker scrape before final acceptance:

```bash
npm run ingestion:metrics:verify -- --url http://localhost:9465/metrics --out artifacts/ingestion-metrics-scrape-proof.json
```

Point `--url` at the deployment's Prometheus-reachable ingestion worker metrics endpoint after a processor-mode workload has run. The verifier fails unless the scrape returns HTTP 200, exposes every required ingestion metric family used by the dashboard and SLO checks, and includes at least one `ingest_stage_latency_ms_quantile` sample with `stage="perType.<eventType>.durationMs"` proving typed insert latency is being scraped.

Default mode is `writer` and rolls back each batch. That exercises Log DB inserts, indexes, triggers, and telemetry outbox writes without leaving benchmark rows behind. Use `--commit` only for staging/prod-like durable-write runs. Use `--mode processor --commit` when measuring full worker behavior, including error grouping and usage accounting; processor mode uses the real worker transaction path, so it always performs durable commits.

Useful workload flags:

- `--type request|span|trace|error|metric|log|message|profile|cron_checkin|replay|mixed`
- `--tenants 1|10|100`
- `--batches N`, `--batch-size N`, and `--warmup-batches N`

When sweeping worker batch sizes, vary `INGESTION_JOB_CHUNK_SIZE` together with `INGESTION_JOB_MAX_BYTES`; the gateway flushes a pg-boss job when either accepted events or approximate serialized bytes reaches its limit.

Ingestion write transactions apply transaction-local timeout guards through one `SET LOCAL` round trip: `INGESTION_LOG_DB_LOCK_TIMEOUT_MS` defaults to `2000`, `INGESTION_LOG_DB_IDLE_TX_TIMEOUT_MS` defaults to `0` (disabled), and `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS` defaults to `60000`. A lock-timeout failure should be treated as PostgreSQL-side contention evidence and retried through pg-boss; it is not a successful performance result. The worker records these separately in `ingest_events_failed_by_reason_total`: SQLSTATE `55P03` as `db_lock_timeout`, SQLSTATE `57014` as `db_statement_timeout`, SQLSTATE `25P03` as `db_idle_transaction_timeout`, and connection class failures as `db_connection`. Failed write transactions also emit `phase="ingestion_profile_failed"` with `failureClass`, `sqlState`, `dbQueries`, `dbQueryMs`, `rollbackMs`, `totalProcessingMs`, batch shape, and validation counts, so failed runs still explain where time was spent. If tiny request batches still show high `insertMs` without lock-timeout failures, inspect WAL/fsync/checkpoint, trigger, relation growth, and storage metrics from `ingestion:db:runtime`.

When investigating high `commitMs`, run the same processor-mode benchmark with `INGESTION_LOG_DB_SYNCHRONOUS_COMMIT=on` and any candidate value (`local`, `remote_write`, or `off`) in a staging database. The setting is transaction-local and defaults to `on`; lower durability modes can reduce commit latency but must be accepted explicitly because acknowledged transactions can have different crash-loss behavior.

When validating request ingestion, compare outbox volume before and after normal 2xx request runs. The writer only appends telemetry outbox rows for fast-path alert signals; request events become fast-path when they have HTTP error/4xx/5xx status or `durationMs`/`latency` at or above `INGESTION_FAST_REQUEST_MIN_DURATION_MS` (default `1000`). Normal successful requests below that threshold should show `outboxMs` near zero and no new `telemetry_outbox` rows.

For processor-mode worker profiles, check `insertMs`, `perType`, `outboxMs`, and `outboxInserted` separately. `insertMs` is now the typed `events_*` insert cost for non-error batches, while `perType.<eventType>.durationMs` identifies which typed table write consumed that insert window in mixed batches. The same timing is exposed in `/metrics` as `ingest_stage_latency_ms_quantile{stage="perType.<eventType>.durationMs"}`. `outboxMs` is the telemetry outbox/idempotency cost.

Writer-mode and processor-mode benchmark JSON include `totalOutboxInserted`, and matrix summaries include an `Outbox rows` column. For normal successful request workloads below the fast-path threshold this should be `0`; error or slow request workloads should show outbox rows. Processor-mode reports use the worker's returned inserted/outbox counts, so duplicates and rejects are not hidden by generated batch size.

Non-error typed inserts intentionally do not include `RETURNING`; use `rowCount`/`inserted` in benchmark JSON and profile logs for inserted-row counts. Error inserts still return `event_id` so grouping can run only for confirmed inserted rows.

Request enrichment starts optional GeoIP reader initialization asynchronously. If `insertMs` and `perType.request.durationMs` are still high for tiny request batches after deployment, the remaining likely causes are PostgreSQL-side work such as locks, WAL/fsync, trigger execution, partition/index maintenance, or storage latency, not MaxMind reader startup. Use the EXPLAIN summary trigger/WAL columns together with `ingestion:db:runtime` deltas to separate typed-table trigger cost from WAL/checkpoint pressure.

For the request insert hot path, the Log DB keeps only essential synchronous request indexes: idempotency, tenant timeline, BRIN time pruning, and public ID lookup. The migration `028_request_ingestion_minimal_indexes.sql` drops environment, user, trace, service, endpoint, duration, geo, release, session, and SDK convenience indexes. Reintroduce any dropped index only with time-bounded EXPLAIN evidence proving the query matters more than the added insert cost.

The JSON report includes:

- `throughputEventsPerSec`
- `totalOutboxInserted` in writer-mode and processor-mode reports
- `totalLatencyMs.count/min/avg/p50/p95/p99/p999/max`
- `stages.dbConnectionWaitMs`, `stages.insertMs`, `stages.commitMs`, or `stages.rollbackMs`
- `resources.wallMs`, CPU user/system/total milliseconds, CPU utilization percentage, RSS bytes, and heap-used bytes for measured batches after warmup
- `dbPools.log` and `dbPools.primary` snapshots with total, idle, and waiting connection counts at the end of the run
- `ingest_db_queries_per_batch` in processor-mode `/metrics`, which should stay bounded as batch size grows
- `ingest_db_query_duration_ms` in processor-mode `/metrics`, which shows per-statement SQL execution latency without SQL text labels
- `ingest_events_per_batch`, `ingest_batch_bytes`, and `serializationMs` to separate small-batch overhead from large-payload pressure
- `eventTypes`, showing the generated distribution for mixed runs
- `workerMetrics` in processor mode, including per-stage p50/p95/p99/p99.9 Prometheus samples

For live worker throughput, derive rates from the low-cardinality counters exposed by `/metrics`: `rate(ingest_batches_processed_by_type_total[5m])` for batches/sec, `rate(ingest_events_inserted_by_type_total[5m])` for durable events/sec, `rate(ingest_events_received_by_type_total[5m])` for attempted events/sec, and `rate(ingest_batch_bytes_total[5m])` for payload bytes/sec. Keep the `{queue,type}` labels in dashboards so hot event classes can be separated without adding tenant/project cardinality.

During worker runs, scrape `/metrics` on `INGESTION_WORKER_METRICS_PORT` and compare `ingest_stage_latency_ms_quantile{stage="worker_wait",...}` with `ingest_stage_latency_ms_quantile{stage="queue_wait",...}` to separate pg-boss pickup delay from total gateway-to-worker age. Compare `ingest_stage_latency_ms_quantile{stage="dbConnectionWaitMs",...}` with `ingest_db_pool_connections{state="waiting",...}`; non-zero waiting clients during high `dbConnectionWaitMs` confirms connection-pool pressure instead of insert SQL cost. Compare `ingest_db_query_duration_ms_quantile{type="...",...}` with `ingest_stage_latency_ms_quantile{stage="insertMs",...}`, `ingest_stage_latency_ms_quantile{stage=~"perType\\..*\\.durationMs",...}`, and `ingest_stage_latency_ms_quantile{stage="commitMs",...}` to separate typed-table write cost, individual slow SQL statements, and transaction overhead.

Gateway `ingestion_admission_profile` logs include `enqueueQueues`. When aggregate `enqueueMs` is high, inspect those per-queue entries first: one slow queue points at a specific pg-boss partition/table/lock, while every queue being slow points at primary DB storage, WAL, connection, or pg-boss catalog pressure.

Queue provisioning is warmed in the background. Normal ingestion should show `queueProvisionMs` near zero; if a first enqueue fails because queues are not ready, the service waits for provisioning, retries once, and reports that wait as `queueProvisionRetryMs`.

Worker `ingestion_profile` and `ingestion_profile_failed` logs can be summarized with `ingestion:worker:summary`. Use this when a single row shows high `insertMs`, `commitMs`, or `totalProcessingMs`; the summary separates successful and failed transaction percentiles, event-type hot spots, SQLSTATE-aware failure classes, per-type typed insert latency, and a `Diagnostic Classification` section. For example, a row with `dbConnectionWaitMs=0`, `insertMs=12425`, and `commitMs=2027` classifies as Log DB write-path pressure: the worker is not waiting for a pool connection; it is spending time inside Log DB write/commit work and needs runtime DB diagnostics plus EXPLAIN trigger/WAL evidence captured during the same workload.

Summarize gateway admission profiles from production/staging JSON logs with:

```bash
npm run ingestion:admission:summary -- --logs artifacts/ingestion-api.jsonl --out artifacts/ingestion-admission-summary.md
```

The summary reads `ingestion_admission_profile` JSON lines and reports aggregate received/accepted/rejected/shed counts, `enqueueMs`, `totalAdmissionMs`, admission stage detail such as `projectLookupMs`, `quotaMs`, `queueDepthMs`, and `jobBuildMs`, queue provisioning latency, per-queue enqueue p50/p95/p99, queue-breakdown coverage, fallback counts, a `Diagnostic Classification` section, and findings. Use it alongside `ingestion:db:runtime` when API-side `enqueueMs` is high: one hot queue points at a queue-specific pg-boss partition/table issue, while all queues moving together points at shared primary DB storage, WAL, connection, cache, temp-spill, or pg-boss catalog pressure. The runtime diagnostic includes primary pg-boss waiting sessions, lock waits, relation growth, WAL sync per commit, cache hit percentage, temp bytes, and WAL deltas for this exact investigation. If `enqueueMs` is high but the summary says profiles are missing `enqueueQueues`, capture logs from the build that emits per-queue enqueue details before calling the pg-boss enqueue bottleneck explained.

After generating admission, worker, and DB runtime summaries, combine them into one triage artifact:

```bash
npm run ingestion:triage -- --admission-summary artifacts/ingestion-admission-summary.md --worker-summary artifacts/ingestion-worker-summary.md --db-runtime-summary artifacts/ingestion-db-runtime-summary.md --out artifacts/ingestion-triage-summary.md
```

The triage summary does not replace the source artifacts. It extracts each layer's diagnostic classification and findings into one Bottleneck Report view and lists the next proof still required, so API enqueue stalls and worker Log DB write stalls are not analyzed in isolation.

Use worker `ingest_stage_latency_ms_quantile{stage="normalizationMs",...}` to isolate the defensive `normalizeEvent()` pass, including timestamp normalization, from the wider `validationMs` loop that also accounts for rejection collection, deterministic identity assignment, and scoped-event preparation. Use `ingest_worker_inflight_jobs` divided by `ingest_worker_configured_slots` for per-process worker utilization, `ingest_queue_oldest_pending_job_age_ms` alongside queue depth to separate backlog age from worker execution time, and `ingest_queue_depth_ready` versus `ingest_queue_depth_deferred` to tell runnable backlog apart from retry/fairness-delayed work. Track `ingest_jobs_retried_total` alongside `ingest_jobs_failed_total`, `ingest_events_failed_total`, and `ingest_events_failed_by_reason_total{queue,type,reason}` to distinguish first-attempt failures, failed event volume, and fixed failure classes such as `db_lock_timeout`, `db_statement_timeout`, `db_connection`, `validation`, `idempotency`, `admission_control`, and `dead_letter`. Track `ingest_events_duplicate_total{queue,type}` to verify retry/replay idempotency is dropping duplicate deliveries without billing them as inserts. Track `ingest_dlq_retained_jobs` and `ingest_dlq_retained_jobs_per_queue` during failure tests to verify rejected/exhausted jobs remain available for replay. Any increase in `ingest_fairness_starvation_guard_admissions_total` means tenant fairness is aging jobs through the max-deferral guard and should be reviewed with per-tenant throughput.

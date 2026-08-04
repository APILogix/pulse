# Analytics Engine — Architecture Overview (Phase 9 + 12)

The analytics engine is a self-contained subsystem that turns canonical telemetry
into dashboard-ready facts. It owns its own worker process, its own tables, and
its own API surface. Nothing else writes its tables; it writes nothing else.

---

## 1. Data flow

```
SDKs / agents
      │  HTTP ingest
      ▼
Ingestion API                     (src/modules/ingestion)
      │  pg-boss per-signal queues (control-plane DB)
      ▼
Ingestion Worker process           (src/shared/workers/ingestion-worker-main.ts)
      │  TelemetryWriter
      ▼
┌──────────────────────────────────────────────┐
│ LOG DB — canonical telemetry                 │
│   events_requests  events_errors             │
│   events_logs      events_metrics            │
│   events_spans     events_traces             │
│   events_messages  events_profiles           │
│   events_replays   events_cron_checkins      │
└──────────────────────────────────────────────┘
      │  READ ONLY, watermark-bounded, ingested_at ordered
      ▼
Analytics Worker process           (src/shared/workers/analytics-worker-main.ts)
      │  17 domain workers + compaction + retention + partition maintenance
      ▼
┌──────────────────────────────────────────────┐
│ LOG DB — analytics rollups                   │
│   *_metrics_1m / _5m / _1h / _1d             │
│   analytics_watermarks                       │
│   analytics_worker_runs                      │
│   anomaly_detections                         │
└──────────────────────────────────────────────┘
      │  rollup-only reads (never events_*)
      ▼
Dashboard API  /analytics/v2/*     (src/modules/analytics-engine/api)
      │  fully formatted cards / series / tables / aiContext
      ▼
Frontend (presentation only)
```

## 2. Non-negotiable rules

| Rule | Enforcement |
| --- | --- |
| Analytics workers read only the Log DB | workers are constructed with `logDB.getPrimaryPool()`; a startup assertion verifies the pool's `current_database()` owns `events_requests` (mirrors the existing `AlertRuntimeRepository.assertRuntimePool` pattern) |
| Analytics workers never read telemetry from the control-plane DB | no control-plane pool is passed into the analytics module; the only control-plane touch is pg-boss job transport |
| Analytics workers never run inside the ingestion process | separate entrypoint, separate PM2 app, separate `PROCESS_ROLE=analytics` |
| Analytics never blocks ingestion | no shared queue, no shared pool, no locks on `events_*`; all reads are `SELECT` with `statement_timeout` |
| Dashboards never aggregate raw telemetry | `AnalyticsEngineReadRepository` only references `*_metrics_*` tables; a unit test asserts no `FROM events_` appears in its SQL |
| Each worker writes only its own rollups | ownership table in `07-rollup-tables.md`; a unit test asserts each worker's SQL only writes its declared tables |
| One giant worker is forbidden | 17 registered domain workers, each with its own queue name, concurrency, and watermark |

## 3. Isolation guarantees (Phase 12)

What the analytics engine does **not** touch:

| Component | Status |
| --- | --- |
| `src/modules/ingestion/**` | unmodified |
| `src/shared/workers/ingestion-worker-main.ts` | unmodified |
| telemetry validation / normalisation | unmodified |
| ingestion pg-boss queues (`ingestion.*`) | not subscribed |
| `TelemetryWriter` | not called |
| `events_*` schema | additive index-only migration; no column or trigger changes |

Failure isolation: if every analytics worker dies, ingestion continues, the API
continues, and dashboards return `meta.freshness.stale = true` with the last
materialised watermark instead of failing.

Back-pressure isolation: analytics reads are bounded per batch
(`ANALYTICS_BATCH_MAX_ROWS`, default 50 000) and per duration
(`statement_timeout = ANALYTICS_STATEMENT_TIMEOUT_MS`, default 30 000). A slow
Log DB slows analytics only.

## 4. Processing model

Every domain worker is an idempotent, watermark-driven, bucket-aligned batch job:

1. Read its watermark row (`analytics_watermarks`) for
   `(worker, organization_id)`.
2. Select the next window `[watermark, min(now - lateness_grace, watermark + max_span))`
   using `ingested_at` (not `occurred_at`) so late-arriving events are never
   skipped.
3. Aggregate in one SQL statement per rollup table, grouped by
   `date_trunc(window, timestamp)` (event time) so the buckets are correct even
   though progress is tracked by ingest time.
4. `INSERT … ON CONFLICT (pk) DO UPDATE` with additive merge semantics so
   re-running the same window converges to the same value (`SET total_count =
   EXCLUDED.total_count` for full-bucket recompute; the design always recomputes
   whole buckets, never increments, which is what makes retries safe).
5. Advance the watermark in the same transaction as the rollup write.
6. Record the run in `analytics_worker_runs` (rows scanned, rows written,
   duration, outcome).

Because step 4 recomputes a whole event-time bucket from raw rows, a bucket may
be rewritten several times as late data lands. The recompute range is
`max(bucket_start) - LATE_EVENT_GRACE` (default 15 min), configurable per worker.

## 5. Window hierarchy

| Window | Produced by | Source | Retention | Serves |
| --- | --- | --- | --- | --- |
| `1m` | domain workers from raw events | `events_*` | 6 h | live / realtime surfaces |
| `5m` | compaction worker | `1m` | 48 h | near-live dashboards |
| `1h` | compaction worker | `5m` | 45 d | historical dashboards |
| `1d` | compaction worker | `1h` | 400 d | trends, usage, billing views |

Compaction merges counters by summation, latency by histogram merge, and distinct
counts by HLL union — so no accuracy is lost beyond the documented histogram
bucket width and HLL error (≈0.8 % at 2^14 registers).

## 6. Component map

| Path | Responsibility |
| --- | --- |
| `src/modules/analytics-engine/types.ts` | window enums, worker ids, rollup row types, API DTOs |
| `src/modules/analytics-engine/windows.ts` | bucket math, window selection from `from`/`to`, grace handling |
| `src/modules/analytics-engine/hll.ts` | dependency-free HyperLogLog (encode/merge/estimate) |
| `src/modules/analytics-engine/histogram.ts` | log-scale latency histogram encode/merge/percentile |
| `src/modules/analytics-engine/watermark.repository.ts` | watermark read/advance, worker-run recording |
| `src/modules/analytics-engine/rollup-writer.ts` | generic idempotent UPSERT executor |
| `src/modules/analytics-engine/workers/*.worker.ts` | one file per domain worker |
| `src/modules/analytics-engine/registry.ts` | declarative worker registry (queue name, cron, concurrency, tables owned) |
| `src/modules/analytics-engine/queue.ts` | pg-boss registration + fan-out scheduling |
| `src/modules/analytics-engine/read/*.repository.ts` | rollup-only read repositories |
| `src/modules/analytics-engine/api/*.routes.ts` | `/analytics/v2/*` Fastify routes |
| `src/modules/analytics-engine/analytics-engine.module.ts` | Fastify plugin wiring |
| `src/shared/workers/analytics-worker-main.ts` | dedicated process entrypoint + health/metrics server |

## 7. Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `ANALYTICS_ENGINE_ENABLED` | `true` | master switch for workers |
| `ANALYTICS_WORKER_CONCURRENCY` | `4` | per-queue local concurrency |
| `ANALYTICS_BATCH_MAX_ROWS` | `50000` | per-batch row ceiling |
| `ANALYTICS_MAX_WINDOW_SPAN_MINUTES` | `60` | max catch-up span per run |
| `ANALYTICS_LATE_EVENT_GRACE_SECONDS` | `900` | recompute lookback |
| `ANALYTICS_STATEMENT_TIMEOUT_MS` | `30000` | per-statement guard |
| `ANALYTICS_HEALTH_PORT` | `9301` | health/metrics HTTP port |
| `ANALYTICS_FRESHNESS_STALE_SECONDS` | `300` | API staleness threshold |
| `ANALYTICS_RETENTION_ENABLED` | `true` | analytics-owned pruning |
| `ANALYTICS_POOL_ASSERT` | `true` | startup Log-DB ownership assertion |

## 8. Why pg-boss and not Redis/BullMQ

`README.md` mandates a Redis-free control plane for this stage, and `src/lib/pgboss.ts`
already provides a producer/consumer split by `PROCESS_ROLE`. The analytics engine
therefore uses pg-boss queues on the control-plane DB purely as job transport;
all analytics *data* stays in the Log DB. Job payloads are `{ orgId, windowStart,
windowEnd }` — small, idempotent, and safe to duplicate.

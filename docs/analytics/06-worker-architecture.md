# Phase 7 + 8 + 13 — Analytics Worker Architecture

23 domain workers + 3 platform workers. Domain-based, never one giant worker.
All registered in a dedicated process; none registered in the ingestion process.

---

## 1. Process design (Phase 13)

Entrypoint: `src/shared/workers/analytics-worker-main.ts`, `PROCESS_ROLE=analytics`.

```
analytics-worker-main.ts
├─ open Log DB pool                (logDB.connect())
├─ assert Log DB ownership         (events_requests exists in this database)
├─ ensure analytics partitions     (analytics_engine_ensure_partitions(7))
├─ startPgBoss()                   (supervise + schedule enabled for workers)
├─ register 26 workers from registry.ts
├─ start health/metrics HTTP server on ANALYTICS_HEALTH_PORT
├─ process.send('ready')           (PM2 wait_ready gate)
└─ SIGTERM/SIGINT → drain: stop schedules → stop workers → stopPgBoss → close pool
```

PM2 app added to `ecosystem.config.cjs`:
```
name: 'pulse-analytics-workers'
script: 'dist/shared/workers/analytics-worker-main.js'
instances: ANALYTICS_WORKER_INSTANCES (default 1, horizontally scalable)
wait_ready: true, kill_timeout: 20000, max_memory_restart: '640M'
env: { PROCESS_ROLE: 'analytics' }
```

Scaling is safe with N instances because pg-boss uses `SKIP LOCKED` and each job
is scoped to `(worker, orgId, window)`; a duplicated job recomputes the same
bucket to the same value.

### Health endpoint — `GET :9301/health`
```jsonc
{
  "status": "healthy",            // healthy | degraded | unhealthy
  "uptimeSeconds": 3612,
  "logDb": "connected",
  "queue": "connected",
  "workers": [
    { "id": "analytics.requests", "lagSeconds": 38, "consecutiveFailures": 0,
      "lastRunAt": "…", "rowsProcessedLastRun": 12045, "status": "healthy" }
  ],
  "worstLagSeconds": 74
}
```
Returns 200 when every worker's lag < `ANALYTICS_FRESHNESS_STALE_SECONDS × 2`
and no worker has ≥ 3 consecutive failures; 503 otherwise.

### Metrics endpoint — `GET :9301/metrics` (Prometheus text)
```
analytics_worker_runs_total{worker,outcome}
analytics_worker_run_duration_ms{worker,quantile}
analytics_worker_rows_read_total{worker}
analytics_worker_rows_written_total{worker}
analytics_worker_watermark_lag_seconds{worker}
analytics_worker_consecutive_failures{worker}
analytics_rollup_rows{table}
analytics_compaction_lag_seconds{window}
```

---

## 2. Worker registry contract

```ts
interface AnalyticsWorkerSpec {
  id: AnalyticsWorkerId;            // 'analytics.requests'
  queue: string;                    // same as id
  windowSize: WindowSize;           // primary output granularity
  sourceTables: string[];           // read-only inputs
  outputTables: string[];           // exclusive write set
  schedule: string;                 // cron for fan-out enqueue
  concurrency: number;
  lateGraceSeconds: number;
  maxSpanMinutes: number;
  retryLimit: number;
  retryBackoffSeconds: number;
  run(ctx: WorkerContext, job: AnalyticsJobData): Promise<WorkerRunResult>;
}
```

Common guarantees for every worker:
- **Idempotency**: whole-bucket recompute + `ON CONFLICT DO UPDATE`. Replaying any
  job any number of times converges.
- **Retry**: pg-boss `retryLimit` with exponential backoff; on failure the
  watermark is *not* advanced, so the next run retries the same window.
- **Failure recovery**: `consecutive_failures` on the watermark row; at ≥ 5 the
  worker halves `maxSpanMinutes` for that org (poison-window narrowing) and logs
  at `error`. Manual reset: `UPDATE analytics_watermarks SET watermark_at = …`.
- **Health**: watermark lag exported per worker; stale watermark surfaces in the
  API response as `meta.freshness.stale`.
- **Isolation**: one Log DB client per run, `SET LOCAL statement_timeout`,
  transaction per rollup table write + watermark advance.

---

## 3. Worker specifications

### 3.1 `analytics.requests`
| Field | Value |
| --- | --- |
| Purpose | tenant/time request summary: volume, status mix, latency, apdex, uniques, bytes |
| Input events | request |
| Source tables | `events_requests` |
| Output tables | `request_metrics_1m` |
| Schedule | every 30 s (fan-out per org) |
| Windows | 1m (5m/1h/1d via compaction) |
| Aggregation | `date_trunc('minute', timestamp)`; `percentile_cont` + histogram; HLL for uniques |
| Indexes needed | `events_requests(organization_id, project_id, environment, ingested_at)` |
| Consumers | `/`, `/dashboards/{overview,executive,realtime,performance,business}`, `/observability/requests`, project overview |
| Widgets | request KPIs, traffic series, status donut, apdex, throughput |
| Alert deps | `requests.error_rate`, `requests.latency_p95`, traffic-drop |
| AI deps | traffic trend summary, "explain this change" |
| Scaling | highest volume worker; partition fan-out by org; concurrency 6 |
| Retry | 5 attempts, 30 s backoff |
| Late grace | 900 s |

### 3.2 `analytics.endpoints`
Purpose: per-route/method breakdown. Source `events_requests`. Output
`endpoint_metrics_1m`. Top-K 1 000 + `__other__`. Consumers: top-endpoint lists,
`/dashboards/performance` by-route tab, `/dashboards/business` adoption,
`/ingestion/endpoints`. Alerts: per-endpoint error rate / latency. Concurrency 4.

### 3.3 `analytics.services`
Purpose: per-service health, availability, apdex. Source `events_requests` (+
`events_spans` for span counts). Output `service_metrics_1m`. Consumers: service
fleet tiles, `/services`, `/observability/service-health`. Concurrency 4.

### 3.4 `analytics.errors`
Purpose: error volume, severity mix, group rollups, regression scoring, group
state upsert. Source `events_errors`. Output `error_metrics_1m`,
`error_group_metrics_1m`, `error_dimension_metrics_1h`, `analytics_error_groups`.
Regression score = `(bucket_count − baseline_mean) / max(baseline_stddev, 1)` over
the trailing 7 days of `error_group_metrics_1h`. Consumers: `/observability/errors`,
`/dashboards/errors`, `/dashboards/releases`, executive top-errors. Alerts:
`errors.regression_score`, new-group. Concurrency 4.

### 3.5 `analytics.logs`
Purpose: log volume by level, logger ranking. Source `events_logs`. Output
`log_metrics_1m`, `logger_metrics_1h`. Consumers: `/observability/logs`.
Concurrency 4.

### 3.6 `analytics.metrics`
Purpose: custom metric series summary + cardinality. Source `events_metrics`
excluding `runtime.*`. Output `metric_series_1m`. Consumers:
`/observability/metrics`. Concurrency 3.

### 3.7 `analytics.runtime`
Purpose: heap/RSS/handles/event-loop/GC. Source `events_metrics` where
`metric_name LIKE 'runtime.%'`. Output `runtime_metrics_1m`, `gc_metrics_1m`.
Consumers: `/observability/runtime` (3 tabs). Alerts:
`runtime.eventloop.lag_p95`, `runtime.gc.long_pause_count`. Concurrency 2.

### 3.8 `analytics.spans`
Purpose: operation latency + self time, DB statement analytics, external
dependency analytics. Source `events_spans`. Output `span_metrics_1m`,
`db_metrics_1h`, `dependency_metrics_1h`. Statement normalisation is done in SQL:
`regexp_replace(db_statement, '\d+', '?', 'g')` truncated to 200 chars.
Consumers: `/dashboards/tracing` DB table + external latency,
`/dashboards/performance` dependency panel. Concurrency 4.

### 3.9 `analytics.traces`
Purpose: trace counts, duration percentiles, partial rate, service edges.
Source `events_traces` (+ `events_spans` for edges via `parent_span_id` self-join
within a trace). Output `trace_metrics_1m`, `trace_edge_metrics_1h`. Consumers:
`/observability/traces`, `/dashboards/tracing` service map. Concurrency 3.

### 3.10 `analytics.crons`
Purpose: check-in outcomes, duration, missed-run detection, monitor state.
Source `events_cron_checkins`. Output `cron_metrics_1m`, `cron_monitor_state`.
Missed run = `now() - last_checkin_at > expected_interval × 1.5` where the
interval is inferred from the median gap of the last 20 check-ins. Consumers:
`/observability/crons`. Alerts: `crons.missed_runs`. Concurrency 2.

### 3.11 `analytics.profiles`
Purpose: profile inventory + hot-function ranking. Source `events_profiles`
(JSONB `profile_data.nodes`). Output `profile_metrics_1h`,
`profile_function_metrics_1h`. Top 200 functions per bucket. Consumers:
`/observability/profiling`. Concurrency 1 (JSONB heavy).

### 3.12 `analytics.replays`
Purpose: replay coverage. Source `events_replays`. Output `replay_metrics_1h`.
Consumers: `/observability/replay`. Concurrency 1.

### 3.13 `analytics.sessions`
Purpose: session reconstruction + crash-free rate + DAU/MAU. Source
`events_requests` (session_id, user_id), `events_errors` (fatal → crashed).
Output `analytics_user_sessions`, `session_metrics_1h`, `user_metrics_1d`.
Sessions close after 30 min of inactivity. Consumers: `/dashboards/geo` DAU/MAU,
`/dashboards/errors` crash-free, `/dashboards/releases`. Concurrency 2.

### 3.14 `analytics.geo`
Purpose: country/region + browser/OS/device breakdowns. Source `events_requests`
(`geo_country_code`, `geo_region`, `browser_family`, `os_name`, `device_type`),
enriched with `geo_countries` for display names. Output `geo_metrics_1h`,
`device_metrics_1h`. Consumers: `/dashboards/geo`. Concurrency 2.

### 3.15 `analytics.sdk`
Purpose: SDK name/version adoption. Source all 10 `events_*` (`sdk_name`,
`sdk_version`). Output `sdk_metrics_1h`. Consumers: `/dashboards/geo` SDK
adoption, `/admin/sdk-config`, `/dashboards/business` migration progress.
Concurrency 1.

### 3.16 `analytics.releases`
Purpose: per-release traffic/errors/latency, adoption share, verdict vs baseline.
Source `events_requests`, `events_errors`, `release_lookup`. Output
`release_metrics_1h`, `release_comparison`. Consumers: `/dashboards/releases`,
`/insights/releases`, `/dashboards/performance` by-release tab. Concurrency 2.

### 3.17 `analytics.slo`
Purpose: availability/latency SLO attainment, error budget, multi-window burn
rate. Source `service_metrics_1m` (rollup-on-rollup) + SLO definitions from the
control plane, cached in `slo_definition_cache`. Output `slo_metrics_5m`.
Consumers: `/services/slos`, `/dashboards/executive` burn-down. Alerts: fast/slow
burn. Concurrency 2.

### 3.18 `analytics.security`
Purpose: auth failures, 429s, sensitive path access, per-IP/per-key risk.
Source `events_requests`, `events_errors`. Output `security_metrics_1h`.
Client IPs are keyed by `client_ip_hash` (never raw IP) in rollups. Consumers:
`/dashboards/security`. Concurrency 2.

### 3.19 `analytics.usage`
Purpose: billable volume per signal, bytes, cost estimate, ingest health.
Source all 10 `events_*` + `ingestion_failures`. Output `usage_metrics_1d`,
`cost_metrics_1d`, `ingest_health_metrics_5m`. Consumers: `/billing/usage`,
project usage, `/ingestion/health`, `/dashboards/infrastructure` cost.
Concurrency 2.

### 3.20 `analytics.alerts`
Purpose: alert volume, delivery success, MTTA/MTTR. Source Log DB
`alert_events`, `alert_delivery_attempts`, `alert_acknowledgments` (read-only).
Output `alert_metrics_1h`. Consumers: `/alerts/metrics`. Concurrency 1.

### 3.21 `analytics.ai`
Purpose: AI usage, tokens, credits, cost, cache hit rate. Source Log DB
`ai_requests`, `ai_responses`, `ai_usage_receipts` (read-only). Output
`ai_metrics_1h`. Consumers: `/ai/usage`, `/ai` overview. Concurrency 1.

### 3.22 `analytics.anomalies`
Purpose: statistical anomaly detection over existing rollups. Source
`request_metrics_1h`, `error_metrics_1h`, `latency` columns, `log_metrics_1h`.
Method: rolling 7-day, same-hour-of-week baseline; flag when
`|value − mean| > 3σ` and absolute change exceeds a per-metric floor. Output
`anomaly_detections`. Consumers: `/insights/anomalies`, AI root-cause.
Concurrency 1.

### 3.23 `analytics.health`
Purpose: denormalised project health card. Source `request_metrics_5m`,
`error_metrics_5m`, `service_metrics_5m`, alert counts. Output
`project_health_5m`. Health score =
`0.40 × availability + 0.35 × (100 − error_rate) + 0.25 × latency_score`
where `latency_score = max(0, 100 − p95_ms/10)` (the formula lifted from
`DashboardsOverview` and made authoritative server-side). Consumers: project
lists, `/dashboards/overview`. Concurrency 2.

### 3.24 `analytics.compaction` (platform)
Purpose: roll `1m → 5m → 1h → 1d` for every window-tiered table.
Merge rules: counters `SUM`, max `MAX`, sums `SUM` (averages derived at read
time), `latency_hist` element-wise `SUM` then percentiles recomputed from the
merged histogram, HLL `hll_union`, `last_*` by `MAX(bucket)` tiebreak.
Schedule: `5m` every minute, `1h` every 5 minutes, `1d` every 15 minutes.
Concurrency 2.

### 3.25 `analytics.retention` (platform)
Purpose: prune analytics-owned tables per the window retention policy; record
into `retention_statistics`. Drops whole partitions when possible, falls back to
ranged `DELETE` for the default partition. Schedule: hourly. Never touches
`events_*` or any non-analytics table (asserted by a table allowlist).

### 3.26 `analytics.partitions` (platform)
Purpose: `analytics_engine_ensure_partitions(7)` daily plus at boot.
Schedule: `0 1 * * *`.

---

## 4. Fan-out strategy

A single scheduled `analytics.dispatch` job (every 30 s) enumerates active
organizations from `analytics_watermarks` ∪ "orgs with events ingested in the
last 15 minutes" (one indexed query against `project_lookup` + a bounded probe on
`events_requests.ingested_at`) and enqueues per-worker jobs with
`singletonKey = worker:org:windowStart` so duplicate dispatches collapse.

Dispatch cadence per worker tier:
| Tier | Workers | Cadence |
| --- | --- | --- |
| live | requests, errors, endpoints, services, logs, traces, spans, health | 30 s |
| standard | metrics, runtime, crons, sessions, geo, slo, security | 2 min |
| slow | profiles, replays, sdk, releases, usage, alerts, ai, anomalies | 10 min |

## 5. Ordering / dependency graph between workers

```
events_* ──► requests ──┬─► health
                        ├─► slo
         ──► errors ────┼─► anomalies
         ──► services ──┘
         ──► endpoints
         ──► logs ───────► anomalies
         ──► spans ──────► (db, dependency)
         ──► traces
         ──► sessions ───► releases
         ──► geo / sdk / security / usage / crons / profiles / replays
alert_* ──► alerts
ai_*    ──► ai
1m rollups ──► compaction ──► 5m ──► 1h ──► 1d
```
`slo`, `health`, and `anomalies` are rollup-on-rollup workers; they read their
inputs' watermarks and refuse to advance past `min(input watermarks)` so they
never publish a partially-materialised window.

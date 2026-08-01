# Phase 10 — Rollup Table Design

Naming follows the master prompt: `<domain>_metrics_<window>`. This namespace does
not collide with the existing (never-written) `analytics_*` tables from
`04_analytics/001`, so the legacy tables can be frozen and later dropped without
touching the engine.

All tables live in the **Log DB** and are created by
`database/migrations/logdb/04_analytics/003_analytics_engine_rollups.up.sql`.

---

## 1. Shared column templates

### Shape A — tenant/time summary (no entity dimension)
```sql
organization_id UUID        NOT NULL
project_id      UUID        NOT NULL
environment     TEXT        NOT NULL
bucket          TIMESTAMPTZ NOT NULL          -- date_trunc(window, event time)
...domain columns...
sample_count    BIGINT      NOT NULL DEFAULT 0 -- raw rows folded into this bucket
updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
PRIMARY KEY (organization_id, project_id, environment, bucket)
PARTITION BY RANGE (bucket)
```

### Shape B — tenant/time/entity breakdown
```sql
organization_id UUID        NOT NULL
project_id      UUID        NOT NULL
environment     TEXT        NOT NULL
bucket          TIMESTAMPTZ NOT NULL
entity_key      TEXT        NOT NULL          -- route|service|country|fingerprint…
entity_label    TEXT                          -- display value when key is hashed
...domain columns...
sample_count    BIGINT      NOT NULL DEFAULT 0
updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
PRIMARY KEY (organization_id, project_id, environment, bucket, entity_key)
PARTITION BY RANGE (bucket)
```

`project_id` is `NOT NULL` in rollups (unlike `events_*` where it is nullable):
org-level aggregates are stored with the sentinel
`00000000-0000-0000-0000-000000000000`, and environment-agnostic aggregates use
the sentinel environment `__all__`. This keeps the primary key total and makes
`ON CONFLICT` deterministic.

### Standard index set (every rollup table)
```sql
CREATE INDEX … ON <t> (organization_id, project_id, environment, bucket DESC);
CREATE INDEX … ON <t> USING BRIN (bucket);
-- Shape B additionally:
CREATE INDEX … ON <t> (organization_id, project_id, environment, entity_key, bucket DESC);
```

### Latency representation
Two complementary columns wherever latency exists:
```sql
latency_sum_ms   NUMERIC(20,3)  -- for exact averages after merge
latency_max_ms   NUMERIC(14,3)
latency_p50_ms   NUMERIC(14,3)  -- exact within the 1m bucket
latency_p75_ms   NUMERIC(14,3)
latency_p90_ms   NUMERIC(14,3)
latency_p95_ms   NUMERIC(14,3)
latency_p99_ms   NUMERIC(14,3)
latency_hist     BIGINT[]       -- 24 log-scale buckets, mergeable
```
`latency_hist` bucket edges (ms):
`1,2,5,10,20,35,50,75,100,150,200,300,500,750,1000,1500,2000,3000,5000,7500,10000,20000,60000,∞`.
Coarse windows recompute `p*` from the merged histogram; the `1m` values remain
exact for live views.

### Distinct-count representation
```sql
unique_users_exact    BIGINT   -- exact within the 1m bucket
unique_users_hll      BYTEA    -- 2^14 registers, mergeable
```
Same pattern for sessions and tenants where the UI needs them.

---

## 2. Table catalogue

### 2.1 Requests — `request_metrics_{1m,5m,1h,1d}` (Shape A)
| Column | Type |
| --- | --- |
| `total_count` | BIGINT |
| `error_count` (5xx) | BIGINT |
| `client_error_count` (4xx) | BIGINT |
| `redirect_count` (3xx) | BIGINT |
| `success_count` (2xx) | BIGINT |
| `auth_failure_count` (401/403) | BIGINT |
| `rate_limited_count` (429) | BIGINT |
| `slow_count` (`is_slow`) | BIGINT |
| `bot_count` | BIGINT |
| `apdex_satisfied_count`, `apdex_tolerating_count` | BIGINT |
| `bytes_in`, `bytes_out` | BIGINT |
| latency block | as §1 |
| `unique_users_exact`, `unique_users_hll` | BIGINT / BYTEA |
| `unique_sessions_exact`, `unique_sessions_hll` | BIGINT / BYTEA |
| `unique_tenants_exact` | BIGINT |
| `service_count`, `route_count` | INTEGER |

### 2.2 Endpoints — `endpoint_metrics_{1m,5m,1h,1d}` (Shape B)
`entity_key = md5(method||' '||coalesce(route,url))`, `entity_label = "GET /api/v1/users"`.
Columns: `method`, `route`, `total_count`, `error_count`, `client_error_count`,
latency block, `bytes_out`, `unique_users_exact`, `unique_users_hll`,
`lifecycle` (`stable|beta|deprecated`, computed at `1d`).

### 2.3 Services — `service_metrics_{1m,5m,1h,1d}` (Shape B)
`entity_key = service`. Columns: `total_count`, `error_count`, latency block,
`availability_pct`, `apdex`, `span_count`, `error_group_count`,
`unique_users_exact`, `unique_users_hll`, `release_current`.

### 2.4 Errors — `error_metrics_{1m,5m,1h,1d}` (Shape A)
`total_count`, `fatal_count`, `error_count`, `warning_count`, `info_count`,
`debug_count`, `unique_fingerprints`, `unique_users_exact`, `unique_users_hll`,
`handled_count`, `unhandled_count`, `new_group_count`.

### 2.5 Error groups — `error_group_metrics_{1m,1h,1d}` (Shape B)
`entity_key = fingerprint`. Columns: `error_name`, `message_template`,
`occurrence_count`, `unique_users_exact`, `unique_users_hll`, `severity_max`,
`mechanism`, `service_count`, `release_first_seen`, `regression_score`,
`baseline_count`, `is_new_in_window`.
Group *state* (resolution, priority, assignee) stays in the existing
`analytics_error_groups` table — rollups never own user-mutable state.

### 2.6 Error mechanisms / severity mix — `error_dimension_metrics_1h` (Shape B)
`entity_key = dimension||':'||value` where dimension ∈
`{mechanism, severity, service, release, error_name}`. Column: `occurrence_count`,
`unique_users_exact`.

### 2.7 Logs — `log_metrics_{1m,5m,1h,1d}` (Shape A)
`total_count`, `error_count`, `warn_count`, `info_count`, `debug_count`,
`unique_loggers`, `bytes_estimate`.

### 2.8 Loggers — `logger_metrics_1h` (Shape B)
`entity_key = logger`, columns `total_count`, `error_count`, `warn_count`.

### 2.9 Custom metrics — `metric_series_{1m,1h,1d}` (Shape B)
`entity_key = metric_name`, `metric_type`, `unit`, `point_count`, `value_sum`,
`value_min`, `value_max`, `value_last`, `value_p50/p95/p99`, `tag_cardinality`.

### 2.10 Runtime (heap / event loop) — `runtime_metrics_{1m,1h}` (Shape B)
`entity_key = service`. Columns: `heap_used_mb_avg/max`, `heap_total_mb_avg`,
`external_mb_avg`, `rss_mb_avg/max`, `active_handles_avg/max`,
`eventloop_lag_p50/p95/p99_ms`, `eventloop_utilization_pct_avg`, `sample_count`.
Source: `events_metrics` rows whose `metric_name` starts with `runtime.`.

### 2.11 GC — `gc_metrics_{1m,1h}` (Shape B)
`entity_key = service||':'||gc_type`. Columns: `pause_count`,
`pause_ms_sum/avg/max`, `long_pause_count` (>100 ms),
`heap_before_mb_avg`, `heap_after_mb_avg`, `reclaimed_mb_sum`.

### 2.12 Spans — `span_metrics_{1m,1h}` (Shape B)
`entity_key = md5(service||':'||name)`, `entity_label = name`. Columns:
`kind`, `total_count`, `error_count`, latency block, `self_time_sum_ms`,
`self_time_p95_ms`.

### 2.13 Database calls — `db_metrics_1h` (Shape B)
`entity_key = md5(db_system||':'||statement_pattern)`. Columns: `db_system`,
`db_name`, `db_operation`, `db_collection`, `statement_pattern`, `call_count`,
`error_count`, latency block.

### 2.14 External dependencies — `dependency_metrics_1h` (Shape B)
`entity_key = http_host` (or `messaging_destination`). Columns: `dependency_kind`
(`http|messaging|db`), `call_count`, `error_count`, `status_5xx_count`,
latency block.

### 2.15 Traces — `trace_metrics_{1m,1h}` (Shape A)
`trace_count`, `partial_count`, `error_trace_count`, `span_count_sum`,
`span_count_max`, duration block (reuses latency columns on
`total_duration_ms`), `critical_path_p95_ms`.

### 2.16 Trace edges — `trace_edge_metrics_1h` (Shape B)
`entity_key = source_service||'>'||target_service`. Columns: `source_service`,
`target_service`, `call_count`, `error_count`, latency block.

### 2.17 Crons — `cron_metrics_{1m,1h}` (Shape B)
`entity_key = monitor_slug`. Columns: `checkin_count`, `ok_count`, `error_count`,
`in_progress_count`, duration block, `last_status`, `last_checkin_at`,
`missed_count`.

### 2.18 Cron monitor state — `cron_monitor_state` (unpartitioned, Shape B without bucket)
Current state per monitor: `last_status`, `last_checkin_at`, `last_duration_ms`,
`expected_interval_seconds`, `consecutive_failures`, `is_missing`.

### 2.19 Profiles — `profile_metrics_1h` (Shape B)
`entity_key = service||':'||profile_type`. Columns: `profile_count`,
duration block, `sample_count_sum`, `node_count_sum`.

### 2.20 Hot functions — `profile_function_metrics_1h` (Shape B)
`entity_key = md5(service||':'||function_name||':'||script_url)`. Columns:
`function_name`, `script_url`, `line_number`, `hit_count_sum`, `profile_count`,
`self_share_pct`.

### 2.21 Replays — `replay_metrics_1h` (Shape A)
`segment_count`, `session_count`, `dom_event_count`, `avg_events_per_segment`,
`crashed_session_count`.

### 2.22 Sessions — `session_metrics_1h` (Shape A)
`session_count`, `crashed_session_count`, `crash_free_rate`,
`duration_ms_sum/avg/p95`, `unique_users_exact`, `unique_users_hll`,
`new_user_count`, `returning_user_count`.
Session *facts* continue to live in `analytics_user_sessions` (re-owned by
`analytics.sessions`).

### 2.23 Users — `user_metrics_1d` (Shape A)
`dau`, `mau_hll` (rolling union computed at read time from 30 daily sketches),
`new_users`, `returning_users`, `sessions_per_user_avg`.

### 2.24 Geo — `geo_metrics_1h` (Shape B)
`entity_key = country_code||':'||coalesce(region,'')`. Columns: `country_code`,
`region`, `request_count`, `error_count`, latency block,
`unique_users_exact`, `unique_users_hll`, `asn_count`.

### 2.25 Devices — `device_metrics_1h` (Shape B)
`entity_key = dimension||':'||value`, dimension ∈ `{browser, os, device_type}`.
Columns: `request_count`, `error_count`, latency block, `unique_users_exact`.

### 2.26 SDK — `sdk_metrics_1h` (Shape B)
`entity_key = sdk_name||':'||sdk_version`. Columns: `event_count`,
`request_count`, `error_count`, `project_count`, `first_seen_at`, `last_seen_at`.

### 2.27 Releases — `release_metrics_1h` (Shape B)
`entity_key = release`. Columns: `request_count`, `error_count`, latency block,
`error_group_count`, `new_error_group_count`, `unique_users_exact`,
`unique_users_hll`, `crash_free_rate`, `adoption_share_pct`.

### 2.28 Release comparison — `release_comparison` (unpartitioned)
One row per `(org, project, environment, release)` holding the current-vs-baseline
verdict: `baseline_release`, `error_rate_delta_pct`, `p95_delta_ms`,
`throughput_delta_pct`, `new_error_groups`, `verdict`
(`improved|stable|degraded`), `computed_at`.

### 2.29 SLO — `slo_metrics_{5m,1h}` (Shape B)
`entity_key = slo_id`. Columns: `slo_target_pct`, `good_count`, `total_count`,
`availability_pct`, `error_budget_consumed_pct`, `burn_rate_1h`,
`burn_rate_6h`, `burn_rate_24h`.

### 2.30 Security — `security_metrics_1h` (Shape B)
`entity_key = dimension||':'||value`, dimension ∈
`{client_ip_hash, sensitive_path, api_key_id, country_code}`. Columns:
`auth_failure_count`, `forbidden_count`, `rate_limited_count`,
`sensitive_access_count`, `distinct_country_count`, `risk_score`.

### 2.31 Usage — `usage_metrics_1d` (Shape B)
`entity_key = signal` (`requests|errors|logs|metrics|spans|traces|messages|profiles|replays|cron_checkins`).
Columns: `event_count`, `bytes_estimate`, `billable_count`, `rejected_count`.
Written from `events_*` counts; **not** a billing ledger — the control plane
remains authoritative for invoicing.

### 2.32 Cost — `cost_metrics_1d` (Shape A)
`billable_events`, `unit_cost_micros`, `estimated_cost_micros`,
`cost_per_million_micros`. `unit_cost_micros` is supplied by the billing module's
service (documented cross-module read), never by SQL against the control plane.

### 2.33 Ingestion health — `ingest_health_metrics_5m` (Shape B)
`entity_key = signal`. Columns: `accepted_count`, `rejected_count`,
`dropped_count`, `dlq_count`, `rejection_reasons` JSONB,
`ingest_lag_ms_p95` (`ingested_at - occurred_at`).
Sources: `events_*` (accepted, lag) + `ingestion_failures` (rejected/reasons).

### 2.34 Alerts — `alert_metrics_1h` (Shape B)
`entity_key = rule_id`. Columns: `triggered_count`, `resolved_count`,
`notification_count`, `delivery_success_count`, `delivery_failure_count`,
`mtta_seconds_avg`, `mttr_seconds_avg`.
Source: Log DB alert runtime tables (`alert_events`, `alert_delivery_attempts`,
`alert_acknowledgments`) — read-only.

### 2.35 AI — `ai_metrics_1h` (Shape B)
`entity_key = model`. Columns: `request_count`, `success_count`, `failure_count`,
`prompt_tokens`, `completion_tokens`, `credits_consumed`, `cost_micros`,
`latency_p95_ms`, `cache_hit_count`.
Source: Log DB `ai_requests`, `ai_responses`, `ai_usage_receipts` — read-only.

### 2.36 Anomalies — `anomaly_detections` (partitioned by `detected_at`)
`id`, `organization_id`, `project_id`, `environment`, `metric_key`,
`entity_key`, `bucket`, `observed_value`, `baseline_value`, `deviation_sigma`,
`direction`, `severity`, `detected_at`, `context` JSONB.

### 2.37 Project health — `project_health_5m` (Shape A)
Denormalised card for project lists: `request_count`, `error_rate_pct`,
`latency_p95_ms`, `availability_pct`, `open_alert_count`, `health_score`,
`status` (`healthy|degraded|critical|no_data`).

---

## 3. Engine control tables

### `analytics_watermarks`
```sql
worker_id        TEXT        NOT NULL
organization_id  UUID        NOT NULL
window_size      TEXT        NOT NULL      -- 1m|5m|1h|1d
watermark_at     TIMESTAMPTZ NOT NULL      -- highest ingested_at consumed
last_bucket_at   TIMESTAMPTZ
last_run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
rows_processed   BIGINT      NOT NULL DEFAULT 0
consecutive_failures INTEGER NOT NULL DEFAULT 0
last_error       TEXT
PRIMARY KEY (worker_id, organization_id, window_size)
```

### `analytics_worker_runs` (partitioned by `started_at`)
`id`, `worker_id`, `organization_id`, `window_size`, `window_start`,
`window_end`, `rows_read`, `rows_written`, `duration_ms`, `outcome`
(`success|partial|failed`), `error_message`, `started_at`, `finished_at`.
Retention 14 days. Feeds the worker health endpoint and `/analytics/v2/system/health`.

### `analytics_engine_partitions` helper
```sql
analytics_engine_ensure_partitions(days_ahead INTEGER DEFAULT 7) RETURNS INTEGER
```
Creates daily partitions for every `*_metrics_1m/5m` table and monthly partitions
for `*_1h/1d` tables, idempotently. Replaces the missing
`create_event_partitions()` dependency.

---

## 4. Table-to-worker ownership

| Worker | Writes |
| --- | --- |
| `analytics.requests` | `request_metrics_1m` |
| `analytics.endpoints` | `endpoint_metrics_1m` |
| `analytics.services` | `service_metrics_1m` |
| `analytics.errors` | `error_metrics_1m`, `error_group_metrics_1m`, `error_dimension_metrics_1h`, `analytics_error_groups` |
| `analytics.logs` | `log_metrics_1m`, `logger_metrics_1h` |
| `analytics.metrics` | `metric_series_1m` |
| `analytics.runtime` | `runtime_metrics_1m`, `gc_metrics_1m` |
| `analytics.spans` | `span_metrics_1m`, `db_metrics_1h`, `dependency_metrics_1h` |
| `analytics.traces` | `trace_metrics_1m`, `trace_edge_metrics_1h` |
| `analytics.crons` | `cron_metrics_1m`, `cron_monitor_state` |
| `analytics.profiles` | `profile_metrics_1h`, `profile_function_metrics_1h` |
| `analytics.replays` | `replay_metrics_1h` |
| `analytics.sessions` | `session_metrics_1h`, `user_metrics_1d`, `analytics_user_sessions` |
| `analytics.geo` | `geo_metrics_1h`, `device_metrics_1h` |
| `analytics.sdk` | `sdk_metrics_1h` |
| `analytics.releases` | `release_metrics_1h`, `release_comparison` |
| `analytics.slo` | `slo_metrics_5m` |
| `analytics.security` | `security_metrics_1h` |
| `analytics.usage` | `usage_metrics_1d`, `cost_metrics_1d`, `ingest_health_metrics_5m` |
| `analytics.alerts` | `alert_metrics_1h` |
| `analytics.ai` | `ai_metrics_1h` |
| `analytics.anomalies` | `anomaly_detections` |
| `analytics.health` | `project_health_5m` |
| `analytics.compaction` | every `*_5m`, `*_1h`, `*_1d` table (from the finer window) |
| `analytics.retention` | DELETE/DROP PARTITION on analytics-owned tables only |
| `analytics.partitions` | partition DDL on analytics-owned tables only |

No table has two writers.

## 5. Storage estimate (per 1 M requests/day, single project)

| Tier | Rows/day | Bytes/row | Size/day | Retained | Total |
| --- | --- | --- | --- | --- | --- |
| `request_metrics_1m` | 1 440 | ~700 | 1.0 MB | 6 h | 0.25 MB |
| `endpoint_metrics_1m` (200 routes) | 288 000 | ~600 | 173 MB | 6 h | 43 MB |
| `endpoint_metrics_5m` | 57 600 | ~600 | 35 MB | 48 h | 69 MB |
| `endpoint_metrics_1h` | 4 800 | ~600 | 2.9 MB | 45 d | 130 MB |
| `endpoint_metrics_1d` | 200 | ~600 | 0.1 MB | 400 d | 48 MB |
| all other domains combined | — | — | ~60 MB | mixed | ~400 MB |
Total steady state ≈ **0.7 GB per busy project**, versus repeatedly scanning
~1 GB/day of raw `events_requests` per dashboard load today.

High-cardinality guard: Shape B writers apply a per-bucket top-K cutoff
(`ANALYTICS_ENTITY_TOPK`, default 1 000) plus an `__other__` bucket row, so a
pathological route or metric-name explosion cannot blow up the rollups.

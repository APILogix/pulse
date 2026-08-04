# Phase 17 — Analytics Catalog

One definition per metric. No duplicates. Every metric has a name, formula,
owner, rollup, retention, and consumer set. `key` is the only identifier used by
APIs, alert rules, AI context, and custom dashboards.

Column legend: **Agg** = how the metric merges across buckets
(`SUM`, `MAX`, `HIST` = histogram merge, `HLL` = sketch union, `DERIVED` =
computed at read time from other columns), **Dim** = available dimensions.

---

## 1. Requests domain — owner `analytics.requests`

| key | Description / business meaning | Formula | Agg | Dim | Unit | Rollup | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `requests.total` | Traffic volume; the denominator of most ratios | `COUNT(*)` on `events_requests` | SUM | env, service, route, release, country, tenant | count | `request_metrics_*` | 1m 6h / 5m 48h / 1h 45d / 1d 400d |
| `requests.rate` | Requests per second, for capacity and abuse detection | `requests.total / window_seconds` | DERIVED | as above | count/s | derived | — |
| `requests.error_count` | Server failures | `COUNT(*) WHERE is_error` (`status_code >= 500`) | SUM | as above | count | `request_metrics_*` | as above |
| `requests.error_rate` | Reliability headline | `error_count / total * 100` | DERIVED | as above | percent | derived | — |
| `requests.client_error_count` | Integration friction (4xx) | `COUNT(*) WHERE status_code BETWEEN 400 AND 499` | SUM | as above | count | `request_metrics_*` | as above |
| `requests.client_error_rate` | Developer-experience friction | `client_error_count / total * 100` | DERIVED | as above | percent | derived | — |
| `requests.availability` | Successful-request share; SLI for availability SLOs | `(total - error_count) / total * 100` | DERIVED | as above | percent | derived | — |
| `requests.auth_failure_count` | Authn/authz rejections | `COUNT(*) WHERE status_code IN (401,403)` | SUM | env, route, ip_hash, key | count | `request_metrics_*`, `security_metrics_1h` | as above |
| `requests.rate_limited_count` | Throttled traffic | `COUNT(*) WHERE status_code = 429` | SUM | env, key, ip_hash | count | `request_metrics_*` | as above |
| `requests.status_distribution` | 2xx/3xx/4xx/5xx mix | four `FILTER` counters | SUM | env, service, route | count | `request_metrics_*` | as above |
| `requests.latency_avg` | Typical response time | `latency_sum_ms / total` | DERIVED | as above | ms | derived | — |
| `requests.latency_p50` | Median experience | `percentile_cont(0.5)` in-bucket; `HIST` merge above 1m | HIST | as above | ms | `request_metrics_*` | as above |
| `requests.latency_p75` | — | `percentile_cont(0.75)` / HIST | HIST | as above | ms | `request_metrics_*` | as above |
| `requests.latency_p90` | — | `percentile_cont(0.90)` / HIST | HIST | as above | ms | `request_metrics_*` | as above |
| `requests.latency_p95` | Tail latency headline; primary latency SLI | `percentile_cont(0.95)` / HIST | HIST | as above | ms | `request_metrics_*` | as above |
| `requests.latency_p99` | Worst-case experience | `percentile_cont(0.99)` / HIST | HIST | as above | ms | `request_metrics_*` | as above |
| `requests.latency_max` | Outlier ceiling | `MAX(latency_ms)` | MAX | as above | ms | `request_metrics_*` | as above |
| `requests.latency_histogram` | Distribution shape, powers the heatmap | 24 log-scale bucket counters | HIST | as above | count | `request_metrics_*` | as above |
| `requests.slow_count` | Requests ≥ 1 s | `COUNT(*) WHERE is_slow` | SUM | as above | count | `request_metrics_*` | as above |
| `requests.apdex` | User-satisfaction index (T = 500 ms) | `(satisfied + tolerating/2) / total` | DERIVED | env, service, route | score | derived | — |
| `requests.throughput_bytes_in` | Inbound payload volume | `SUM(body_size)` | SUM | env, service, route | bytes | `request_metrics_*` | as above |
| `requests.throughput_bytes_out` | Outbound payload volume | `SUM(response_size)` | SUM | as above | bytes | `request_metrics_*` | as above |
| `requests.avg_request_size` | Payload efficiency | `bytes_in / total` | DERIVED | as above | bytes | derived | — |
| `requests.avg_response_size` | Payload efficiency | `bytes_out / total` | DERIVED | as above | bytes | derived | — |
| `requests.bot_share` | Non-human traffic share | `bot_count / total * 100` | DERIVED | env, country | percent | derived | — |
| `requests.unique_users` | Reach | `COUNT(DISTINCT user_id)` exact ≤ 1m, HLL above | HLL | env, service, country, release | count | `request_metrics_*` | as above |
| `requests.unique_sessions` | Session volume | `COUNT(DISTINCT session_id)` / HLL | HLL | as above | count | `request_metrics_*` | as above |
| `requests.unique_tenants` | Multi-tenant spread | `COUNT(DISTINCT tenant_id)` | HLL | env | count | `request_metrics_*` | as above |

Consumers: `/`, `/dashboards/{overview,executive,performance,realtime,business,security}`,
`/observability/{requests,latency}`, project overview/analytics.
Alerts: high error rate, high latency, traffic drop/spike, rate-limit spike, apdex breach.
AI: traffic trend, latency regression, change explanation.

## 2. Endpoints — owner `analytics.endpoints`

| key | Meaning | Formula | Agg | Dim | Unit | Rollup |
| --- | --- | --- | --- | --- | --- | --- |
| `endpoints.request_count` | Per-route volume | `COUNT(*) GROUP BY method, route` | SUM | method, route, env, service | count | `endpoint_metrics_*` |
| `endpoints.error_rate` | Per-route reliability | `error_count / request_count * 100` | DERIVED | as above | percent | derived |
| `endpoints.latency_p50…p99` | Per-route latency | percentiles / HIST | HIST | as above | ms | `endpoint_metrics_*` |
| `endpoints.unique_users` | Per-route reach | `COUNT(DISTINCT user_id)` / HLL | HLL | as above | count | `endpoint_metrics_*` |
| `endpoints.lifecycle` | Product lifecycle label | `stable` if `count > threshold AND error_rate < 1`; `deprecated` if `count < floor`; else `beta` | LAST | route | enum | `endpoint_metrics_1d` |
| `endpoints.top_slowest` | Ranked slow paths | `ORDER BY latency_p95 DESC` | DERIVED | — | list | derived |

## 3. Services — owner `analytics.services`

| key | Meaning | Formula | Agg | Unit |
| --- | --- | --- | --- | --- |
| `services.request_count` | Per-service volume | `COUNT(*) GROUP BY service` | SUM | count |
| `services.error_rate` | Per-service reliability | `error_count / request_count * 100` | DERIVED | percent |
| `services.availability` | Per-service SLI | `(total - errors)/total * 100` | DERIVED | percent |
| `services.latency_p95` | Per-service tail | percentile / HIST | HIST | ms |
| `services.apdex` | Per-service satisfaction | as `requests.apdex` | DERIVED | score |
| `services.span_count` | Instrumentation depth | `COUNT(*)` on `events_spans` | SUM | count |
| `services.error_group_count` | Distinct failure modes | `COUNT(DISTINCT fingerprint)` | HLL | count |
| `services.health_score` | Composite tile colour | `0.40×availability + 0.35×(100−error_rate) + 0.25×latency_score` | DERIVED | score |

## 4. Errors — owner `analytics.errors`

| key | Meaning | Formula | Agg | Dim | Unit | Rollup |
| --- | --- | --- | --- | --- | --- | --- |
| `errors.total` | Error event volume | `COUNT(*)` on `events_errors` | SUM | env, service, severity, mechanism, release | count | `error_metrics_*` |
| `errors.unique_groups` | Distinct failure modes | `COUNT(DISTINCT fingerprint)` | HLL | as above | count | `error_metrics_*` |
| `errors.affected_users` | Blast radius | `COUNT(DISTINCT user_id)` / HLL | HLL | as above | count | `error_metrics_*` |
| `errors.severity_mix` | fatal/error/warning/info/debug counters | `FILTER` per `logdb_severity` | SUM | as above | count | `error_metrics_*` |
| `errors.by_mechanism` | Origin of failures | `COUNT(*) GROUP BY mechanism` | SUM | mechanism | count | `error_dimension_metrics_1h` |
| `errors.group_occurrence_count` | Per-fingerprint volume | `COUNT(*) GROUP BY fingerprint` | SUM | fingerprint | count | `error_group_metrics_*` |
| `errors.group_affected_users` | Per-fingerprint blast radius | `COUNT(DISTINCT user_id)` / HLL | HLL | fingerprint | count | `error_group_metrics_*` |
| `errors.regression_score` | Spike vs 7-day same-hour baseline | `(count − baseline_mean) / max(baseline_stddev, 1)` | LAST | fingerprint | sigma | `error_group_metrics_1h` |
| `errors.new_in_release` | Groups first seen in a release | `MIN(timestamp) per fingerprint` within release window | LAST | fingerprint, release | bool | `release_metrics_1h` |
| `errors.unresolved_groups` | Triage backlog | `COUNT(*) FROM analytics_error_groups WHERE status <> 'resolved'` | LAST | env | count | `analytics_error_groups` |
| `errors.resolved_today` | Triage throughput | `COUNT(*) WHERE resolved_at >= date_trunc('day', now())` | LAST | env | count | `analytics_error_groups` |

Deprecated alias: `analytics_error_groups.occurrence_count` — superseded by
`total_count`; readers must use `total_count`.

## 5. Logs — owner `analytics.logs`

| key | Meaning | Formula | Agg | Unit |
| --- | --- | --- | --- | --- |
| `logs.total` | Log volume | `COUNT(*)` on `events_logs` | SUM | count |
| `logs.volume_by_level` | error/warn/info/debug counters | `FILTER` per `level` | SUM | count |
| `logs.error_ratio` | Log health | `error_count / total * 100` | DERIVED | percent |
| `logs.unique_loggers` | Logger cardinality | `COUNT(DISTINCT logger)` | HLL | count |
| `logs.top_loggers` | Noise ranking | `COUNT(*) GROUP BY logger ORDER BY DESC` | SUM | list |
| `logs.per_request_ratio` | Verbosity | `logs.total / requests.total` | DERIVED | ratio |

## 6. Custom metrics — owner `analytics.metrics`

| key | Meaning | Formula | Agg | Unit |
| --- | --- | --- | --- | --- |
| `metrics.point_count` | Ingested points per series | `COUNT(*) GROUP BY metric_name` | SUM | count |
| `metrics.value_last` | Latest gauge value | `value ORDER BY timestamp DESC LIMIT 1` | LAST | native |
| `metrics.value_sum` / `_min` / `_max` | Counter/gauge aggregates | `SUM/MIN/MAX(value)` | SUM/MIN/MAX | native |
| `metrics.value_p50/p95/p99` | Histogram percentiles | SDK-supplied `p*` or computed | HIST | native |
| `metrics.series_cardinality` | Cost/health guard | `COUNT(DISTINCT metric_name)` and distinct tag combos | HLL | count |

## 7. Runtime — owner `analytics.runtime`

| key | Meaning | Source metric name | Agg | Unit |
| --- | --- | --- | --- | --- |
| `runtime.heap_used_mb` | Heap pressure | `runtime.heap.used` | AVG/MAX | MB |
| `runtime.heap_total_mb` | Heap capacity | `runtime.heap.total` | AVG | MB |
| `runtime.external_mb` | Off-heap buffers | `runtime.memory.external` | AVG | MB |
| `runtime.rss_mb` | Process footprint | `runtime.memory.rss` | AVG/MAX | MB |
| `runtime.active_handles` | Descriptor leak signal | `runtime.handles.active` | AVG/MAX | count |
| `runtime.eventloop.lag_p50/p95/p99` | Scheduling delay | `runtime.eventloop.lag` | HIST | ms |
| `runtime.eventloop.utilization` | Loop saturation | `runtime.eventloop.utilization` | AVG | percent |
| `runtime.gc.pause_count` | GC frequency | `runtime.gc.pause` | SUM | count |
| `runtime.gc.pause_ms_avg/max` | GC impact | `runtime.gc.pause` | AVG/MAX | ms |
| `runtime.gc.long_pause_count` | Stop-the-world risk | `COUNT(*) WHERE value > 100` | SUM | count |
| `runtime.gc.reclaimed_mb` | Collection effectiveness | `heap_before − heap_after` | SUM | MB |

## 8. Spans / dependencies — owner `analytics.spans`

| key | Meaning | Formula | Agg | Unit |
| --- | --- | --- | --- | --- |
| `spans.total` | Span volume | `COUNT(*)` | SUM | count |
| `spans.error_rate` | Span failures | `COUNT(*) WHERE status='error' / total * 100` | DERIVED | percent |
| `spans.latency_p95` | Operation tail latency | percentile / HIST on `duration_ms` | HIST | ms |
| `spans.self_time_p95` | Bottleneck attribution | percentile / HIST on `exclusive_duration_ms` | HIST | ms |
| `db.call_count` | Query volume | `COUNT(*) WHERE db_system IS NOT NULL` | SUM | count |
| `db.latency_p95` | Query tail latency | percentile / HIST | HIST | ms |
| `db.statement_pattern` | Normalised query identity | `regexp_replace(db_statement,'\d+','?','g')[:200]` | key | text |
| `db.error_rate` | Query failure rate | error/total | DERIVED | percent |
| `dependency.call_count` | External call volume | `COUNT(*) GROUP BY http_host` | SUM | count |
| `dependency.latency_p95` | External tail latency | percentile / HIST | HIST | ms |
| `dependency.error_rate` | External failure rate | `status_5xx / total * 100` | DERIVED | percent |

## 9. Traces — owner `analytics.traces`

| key | Meaning | Formula | Agg | Unit |
| --- | --- | --- | --- | --- |
| `traces.total` | Trace volume | `COUNT(*)` | SUM | count |
| `traces.partial_rate` | Instrumentation gaps | `partial_count / total * 100` | DERIVED | percent |
| `traces.error_trace_rate` | Failing user journeys | `error_trace_count / total * 100` | DERIVED | percent |
| `traces.span_count_avg` | Trace complexity | `span_count_sum / total` | DERIVED | count |
| `traces.duration_p95` | End-to-end tail latency | percentile / HIST on `total_duration_ms` | HIST | ms |
| `traces.critical_path_p95` | Longest dependent chain | span-tree longest path | HIST | ms |
| `traces.edge_call_count` | Service-to-service volume | `COUNT(*) GROUP BY (parent.service, child.service)` | SUM | count |
| `traces.edge_p95` | Edge latency | percentile / HIST | HIST | ms |
| `traces.edge_error_rate` | Edge reliability | error/total | DERIVED | percent |

## 10. Crons — owner `analytics.crons`

| key | Meaning | Formula | Agg | Unit |
| --- | --- | --- | --- | --- |
| `crons.checkin_count` | Check-in volume | `COUNT(*)` | SUM | count |
| `crons.success_count` / `failure_count` | Outcome counters | `FILTER` on `status` | SUM | count |
| `crons.success_rate` | Job reliability | `ok / (ok + error) * 100` | DERIVED | percent |
| `crons.duration_p95` | Job runtime tail | percentile / HIST | HIST | ms |
| `crons.missed_runs` | Silent failures | `now() − last_checkin_at > expected_interval × 1.5` | LAST | count |
| `crons.last_state` | Monitor board status | latest `status` per `monitor_slug` | LAST | enum |

## 11. Profiles / replays / sessions / users

| key | Owner | Meaning | Formula | Agg | Unit |
| --- | --- | --- | --- | --- | --- |
| `profiles.count` | `analytics.profiles` | Profiles captured | `COUNT(*)` | SUM | count |
| `profiles.duration_p95` | `analytics.profiles` | Capture length | percentile / HIST | HIST | ms |
| `profiles.sample_count` | `analytics.profiles` | Sampling depth | `SUM(jsonb_array_length(profile_data->'samples'))` | SUM | count |
| `profiles.hot_function_hits` | `analytics.profiles` | CPU concentration | `SUM(hitCount) GROUP BY function` | SUM | count |
| `replays.segment_count` | `analytics.replays` | Replay volume | `COUNT(*)` | SUM | count |
| `replays.session_count` | `analytics.replays` | Recorded sessions | `COUNT(DISTINCT session_id)` | HLL | count |
| `replays.dom_event_count` | `analytics.replays` | Capture density | `SUM(jsonb_array_length(events))` | SUM | count |
| `sessions.count` | `analytics.sessions` | Session volume | `COUNT(*)` on `analytics_user_sessions` | SUM | count |
| `sessions.crash_free_rate` | `analytics.sessions` | Stability headline | `(sessions − crashed) / sessions × 100` | DERIVED | percent |
| `sessions.duration_p95` | `analytics.sessions` | Engagement depth | percentile / HIST | HIST | ms |
| `users.dau` | `analytics.sessions` | Daily active users | `COUNT(DISTINCT user_id)` per day | HLL | count |
| `users.mau` | `analytics.sessions` | Monthly active users | HLL union of trailing 30 daily sketches | HLL | count |
| `users.dau_mau_ratio` | `analytics.sessions` | Engagement | `dau / mau × 100` | DERIVED | percent |
| `users.new` / `users.returning` | `analytics.sessions` | Acquisition vs retention | first-seen comparison | SUM | count |

## 12. Geo / devices / SDK / releases

| key | Owner | Meaning | Formula | Agg | Unit |
| --- | --- | --- | --- | --- | --- |
| `geo.request_count` | `analytics.geo` | Traffic by country/region | `COUNT(*) GROUP BY geo_country_code, geo_region` | SUM | count |
| `geo.share_pct` | `analytics.geo` | Traffic distribution | `country_count / total × 100` | DERIVED | percent |
| `geo.latency_p95` | `analytics.geo` | Regional experience | percentile / HIST | HIST | ms |
| `geo.error_rate` | `analytics.geo` | Regional reliability | error/total | DERIVED | percent |
| `geo.unique_users` | `analytics.geo` | Regional reach | HLL | HLL | count |
| `devices.request_count_by_browser` | `analytics.geo` | Client mix | `GROUP BY browser_family` | SUM | count |
| `devices.request_count_by_os` | `analytics.geo` | Platform mix | `GROUP BY os_name` | SUM | count |
| `devices.request_count_by_type` | `analytics.geo` | Form-factor mix | `GROUP BY device_type` | SUM | count |
| `devices.error_rate_by_browser` | `analytics.geo` | Client-specific failures | error/total per browser | DERIVED | percent |
| `sdk.event_count` | `analytics.sdk` | SDK traffic | `COUNT(*) GROUP BY sdk_name, sdk_version` | SUM | count |
| `sdk.version_share` | `analytics.sdk` | Upgrade progress | version count / total × 100 | DERIVED | percent |
| `sdk.project_count` | `analytics.sdk` | Rollout breadth | `COUNT(DISTINCT project_id)` | HLL | count |
| `releases.request_count` | `analytics.releases` | Release traffic | `GROUP BY release` | SUM | count |
| `releases.error_rate` | `analytics.releases` | Release reliability | error/total | DERIVED | percent |
| `releases.latency_p95` | `analytics.releases` | Release latency | percentile / HIST | HIST | ms |
| `releases.adoption_share` | `analytics.releases` | Rollout progress | release count / total × 100 | DERIVED | percent |
| `releases.new_error_groups` | `analytics.releases` | Regression count | fingerprints first seen in release | SUM | count |
| `releases.verdict` | `analytics.releases` | Ship/rollback signal | `degraded` if error-rate delta > 50 % or p95 delta > 30 %; `improved` if both better; else `stable` | LAST | enum |

## 13. SLO / security / usage / cost / ingestion / alerts / AI / anomalies

| key | Owner | Meaning | Formula | Agg | Unit |
| --- | --- | --- | --- | --- | --- |
| `slo.availability_attainment` | `analytics.slo` | SLO compliance | `good / total × 100` | DERIVED | percent |
| `slo.error_budget_consumed` | `analytics.slo` | Budget burn | `(1 − attainment/target) × 100` | DERIVED | percent |
| `slo.burn_rate_1h` / `_6h` / `_24h` | `analytics.slo` | Multi-window burn | `observed_error_rate / (1 − target)` | DERIVED | ratio |
| `security.auth_failure_count` | `analytics.security` | Credential attacks | `COUNT(*) WHERE status_code IN (401,403)` | SUM | count |
| `security.rate_limited_count` | `analytics.security` | Abuse throttling | `status_code = 429` | SUM | count |
| `security.sensitive_access_count` | `analytics.security` | Privileged access audit | requests matching the sensitive-path allowlist | SUM | count |
| `security.distinct_country_count` | `analytics.security` | Key-sharing signal | `COUNT(DISTINCT geo_country_code)` per key | HLL | count |
| `security.risk_score` | `analytics.security` | Composite threat score | `min(100, distinct_countries × 12 + error_rate)` | DERIVED | score |
| `security.score` | `analytics.security` | Posture headline | `max(0, 100 − auth_failures_weighted − rate_limited_weighted)` | DERIVED | score |
| `usage.event_count` | `analytics.usage` | Ingested volume per signal | `COUNT(*)` per `events_*` | SUM | count |
| `usage.billable_events` | `analytics.usage` | Chargeable volume | `event_count` minus non-billable signals | SUM | count |
| `usage.bytes_estimate` | `analytics.usage` | Storage attribution | `SUM(pg_column_size(payload))` sampled | SUM | bytes |
| `usage.rate_limit_consumption` | `analytics.usage` | Per-key quota use | `requests per key / key limit × 100` | DERIVED | percent |
| `cost.estimated_cost` | `analytics.usage` | Spend attribution | `billable_events × unit_cost_micros` | SUM | micros |
| `cost.cost_per_million` | `analytics.usage` | Unit economics | `estimated_cost / (billable_events/1e6)` | DERIVED | micros |
| `ingestion.accepted` | `analytics.usage` | Successful ingest | `COUNT(*)` on `events_*` | SUM | count |
| `ingestion.rejected` | `analytics.usage` | Rejected payloads | `COUNT(*)` on `ingestion_failures` | SUM | count |
| `ingestion.rejected_by_reason` | `analytics.usage` | Failure taxonomy | `GROUP BY error_code` | SUM | count |
| `ingestion.lag_p95` | `analytics.usage` | Pipeline freshness | percentile of `ingested_at − occurred_at` | HIST | ms |
| `alerts.triggered_count` | `analytics.alerts` | Alert volume | `COUNT(*)` on `alert_events` | SUM | count |
| `alerts.delivery_success_rate` | `analytics.alerts` | Notification reliability | delivered / attempts × 100 | DERIVED | percent |
| `alerts.mtta_seconds` | `analytics.alerts` | Response speed | `AVG(acknowledged_at − triggered_at)` | DERIVED | s |
| `alerts.mttr_seconds` | `analytics.alerts` | Recovery speed | `AVG(resolved_at − triggered_at)` | DERIVED | s |
| `ai.request_count` | `analytics.ai` | AI usage volume | `COUNT(*)` on `ai_requests` | SUM | count |
| `ai.prompt_tokens` / `completion_tokens` | `analytics.ai` | Token consumption | `SUM(...)` on `ai_usage_receipts` | SUM | count |
| `ai.credits_consumed` | `analytics.ai` | Entitlement burn | `SUM(credits)` | SUM | count |
| `ai.cost` | `analytics.ai` | AI spend | `SUM(cost_micros)` | SUM | micros |
| `ai.cache_hit_rate` | `analytics.ai` | Efficiency | cache hits / requests × 100 | DERIVED | percent |
| `ai.latency_p95` | `analytics.ai` | AI responsiveness | percentile / HIST | HIST | ms |
| `anomalies.deviation_sigma` | `analytics.anomalies` | Anomaly magnitude | `(value − baseline_mean)/baseline_stddev` | LAST | sigma |
| `anomalies.count` | `analytics.anomalies` | Anomaly volume | `COUNT(*)` on `anomaly_detections` | SUM | count |
| `health.score` | `analytics.health` | Project health headline | `0.40×availability + 0.35×(100−error_rate) + 0.25×latency_score` | DERIVED | score |
| `health.status` | `analytics.health` | Traffic-light state | `healthy ≥ 90`, `degraded ≥ 70`, else `critical`; `no_data` when `sample_count = 0` | LAST | enum |

## 14. Catalog rules

1. A metric key may be defined once. Adding a second definition is a build
   failure (`test/unit/analytics-catalog.test.ts` asserts key uniqueness against
   the TypeScript catalog constant).
2. Derived metrics never get their own column; they are computed from stored
   columns at read time so stored data stays mergeable.
3. Any metric consumed by an alert rule must be `SUM`, `MAX`, `HIST`, or `LAST` —
   `DERIVED` metrics are allowed only if all inputs are in the same rollup row.
4. Unit and direction are part of the definition: the API never leaves formatting
   or "is up good?" to the client.
5. Deprecations are recorded in this file with a replacement key; no silent
   renames.

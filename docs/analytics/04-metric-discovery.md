# Phase 5 — Metric Discovery

Inventory of what the platform can already measure from the canonical `events_*`
tables, what the frontend displays but cannot yet measure, what is duplicated,
and what is expensive.

Column references are verified against
`database/migrations/logdb/03_observability/00{1,2,3}_*.up.sql`.

---

## 1. Metrics already derivable from existing telemetry

### 1.1 Requests (`events_requests`)
| Metric | Derivation |
| --- | --- |
| Request count / rate (rps, rpm) | `COUNT(*)` ÷ bucket width |
| Error count / error rate | `COUNT(*) FILTER (WHERE is_error)` (generated column, `status_code >= 500`) |
| Client-error rate (4xx) | `COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499)` |
| Status-class distribution 2xx/3xx/4xx/5xx | `FILTER` per class |
| Availability | `1 - error_count/total_count` |
| Latency avg | `SUM(latency_ms)/COUNT(*)` |
| Latency P50/P75/P90/P95/P99 | `percentile_cont` at rollup time; merged across buckets via t-digest-style histogram (see §5) |
| Latency histogram (7 buckets) | `FILTER` per bucket edge `10/50/100/500/1000/5000/∞` |
| Slow-request count | `COUNT(*) FILTER (WHERE is_slow)` (generated, `latency_ms >= 1000`) |
| Apdex | `(satisfied + tolerating/2) / total` with T = 500 ms |
| Throughput bytes in/out | `SUM(body_size)`, `SUM(response_size)` |
| Avg request/response size | those sums ÷ count |
| Top routes / endpoints | `GROUP BY route, method` |
| Top services | `GROUP BY service` |
| Unique users | `COUNT(DISTINCT user_id)` |
| Unique sessions | `COUNT(DISTINCT session_id)` |
| Unique tenants | `COUNT(DISTINCT tenant_id)` |
| Countries / regions / ASN | `GROUP BY geo_country_code`, `geo_region`, `geo_asn` |
| Browsers / OS / devices | `GROUP BY browser_family`, `os_name`, `device_type` |
| Bot traffic share | `COUNT(*) FILTER (WHERE is_bot)` |
| Auth failures | `status_code IN (401,403)` |
| Rate-limit hits | `status_code = 429` |
| Release traffic + error rate | `GROUP BY release` |
| SDK adoption | `GROUP BY sdk_name, sdk_version` |
| Framework distribution | `GROUP BY framework` |
| Per-API-key volume | `GROUP BY api_key_id` |

### 1.2 Errors (`events_errors`)
Occurrence count, unique fingerprints, affected users (`COUNT(DISTINCT user_id)`),
severity mix (`logdb_severity`), mechanism mix, first/last seen per fingerprint,
services/environments/releases touched, new-in-release detection
(`MIN(timestamp) per fingerprint` vs release window), regression detection
(bucket count vs trailing baseline), crash-free-session rate (join
`session_id` against sessions), stack-hash clustering, top error names.

### 1.3 Logs (`events_logs`)
Volume by `level`, error/warn ratio, volume by `logger`, volume by service,
log-to-request ratio, noisy-logger ranking, message-template cardinality.

### 1.4 Metrics (`events_metrics`)
Per `metric_name`/`metric_type` last value, min/max/avg/sum/count/rate,
pre-aggregated `p50…p99` when the SDK supplies them, tag-dimension breakdown,
active-series cardinality. Reserved `runtime.*` names carry heap, RSS, external
memory, active handles, event-loop lag/utilization, and GC pauses.

### 1.5 Spans (`events_spans`)
Span count by `kind`/`status`, self-time (`exclusive_duration_ms`) ranking,
operation latency percentiles, DB metrics by `db_system`/`db_operation`/
normalised `db_statement`, external dependency latency by `http_host`,
messaging throughput by `messaging_destination`, span error rate.

### 1.6 Traces (`events_traces`)
Trace count, `span_count` distribution, `total_duration_ms` percentiles,
partial-trace rate, root-span ranking, service-edge call counts (derived from
spans' `service` + `parent_span_id`), critical-path duration.

### 1.7 Crons (`events_cron_checkins`)
Check-ins per monitor, success/failure/in-progress counts, success rate,
duration percentiles, missed-execution detection (expected interval vs actual
gap), monitor inventory + last state.

### 1.8 Profiles (`events_profiles`)
Profiles captured, duration percentiles, sample counts, hottest function by
`hitCount` inside `profile_data`, services profiled.

### 1.9 Replays (`events_replays`)
Segments, unique sessions, captured DOM events, avg events/segment, replay
coverage (sessions with replay ÷ sessions).

### 1.10 Messages (`events_messages`)
Message volume by severity and service (feeds the events explorer only).

## 2. Metrics the frontend shows that telemetry cannot yet produce

| Metric | Frontend location | Blocker | Decision |
| --- | --- | --- | --- |
| CPU % / memory % per service | InfrastructureCost | no host metrics signal | serve from `runtime.*` metrics where the SDK reports them; otherwise the widget is removed (Phase 6) |
| DB pool utilization, acquire failures, avg wait | InfrastructureCost, RealtimeTraffic | platform self-telemetry, not tenant telemetry | move to an internal ops dashboard fed by `prom-client`; removed from tenant UI |
| Cache hit/miss ratio | InfrastructureCost | same | removed from tenant UI |
| Queue depth / processing lag | InfrastructureCost | `ingestion_queue_snapshot` + `backpressure_gauge` exist in Log DB | keep, backed by `analytics.ingestion` |
| Cost per 1M requests, infra spend, projected cost | InfrastructureCost | needs a rate card | `analytics.usage` emits billable volume; billing module supplies rate → `analytics_cost_1d` |
| MRR, revenue, churn | BusinessMetrics | control-plane billing | served by the billing module API, not the analytics engine |
| Deploy frequency, lead time, MTTR, change failure rate | ReleaseQuality | no deployment signal | requires a new `deployments` ingest contract → future expansion; widget hidden behind a capability flag until then |
| Cold start vs warm | PerformanceDeepDive | no cold-start attribute | add optional `attributes->>'faas.coldstart'`; widget hidden when absent |
| SLO burn rate / error budget | ServiceSlosPage | SLO definitions do not exist | new control-plane `service_slos` table + `analytics.slo` worker |
| Uptime 30d | ServiceHealthPage | derivable from availability rollups | `analytics_service_1d.availability_pct` |
| Sensitive-endpoint access, JWT anomalies | SecurityThreat | derivable from requests + errors | `analytics.security` reads `events_requests` (401/403/429, path allowlist) and `events_errors` (token patterns) |
| Est. users per country | GeoAnalytics | derivable | `COUNT(DISTINCT user_id)` per country |

## 3. Duplicate metric definitions found

| Duplication | Evidence | Resolution |
| --- | --- | --- |
| `percentile()` implemented twice on the client | `dashboards/lib.ts` and a private copy at the bottom of `observe/ExecutiveDashboard.tsx` | delete both; percentiles come from rollups |
| Error rate defined 3 ways | `errorRate()` (`>=500` over requests), `PerformanceDeepDive` `byRoute.errRate` (`>=500`), `BusinessMetrics`/`GeoAnalytics` (`>=400`) | one catalog definition: `error_rate` = 5xx ÷ total; `client_error_rate` = 4xx ÷ total |
| Request totals scaled by magic multipliers | `total * 1240`, `total * 240`, `total * 14`, `total / 12`, `total * 3` across 7 files | single `requests_total` metric; no client scaling |
| Health/security scores computed differently per page | `DashboardsOverview` weighted formula vs `SecurityThreat` `92 - authFails*2 - rateLimited` | catalog entries `health_score` and `security_score` with one server formula each |
| Backend request overview vs dashboard requests block | `AnalyticsRepository.getRequestOverview` and `getDashboard.requests` compute overlapping aggregates with different field names (`total_requests` vs `total`, `avg_latency_ms` in both, `error_rate_pct` in both) | v2 API exposes one `requests summary` shape |
| Error group counts | `analytics_error_groups.occurrence_count` (from `001`) and `total_count` (added by `002`) both exist | `total_count` is canonical; `occurrence_count` deprecated (documented in the catalog) |
| Generic EAV rollups vs typed rollups | `analytics_hourly_rollup(metric_name, metric_value)` overlaps every typed rollup | typed rollups are canonical; EAV tables frozen and excluded from reads |

## 4. Unused metrics / dead surface

- `analytics_daily_rollup`, `analytics_performance_summary`,
  `analytics_endpoint_*`, `analytics_service_*`, `analytics_trace_latency`,
  `analytics_error_occurrences`, `analytics_error_regressions`,
  `analytics_geo_hourly_rollup`, `analytics_user_sessions`,
  `analytics_trace_service_edges` — created by migrations, **never written** by any
  code path in `src/**` (only `refreshHourlyRollup` and `refreshErrorGroups`
  exist in `src/modules/event-analytics/repository.ts`).
- `dummyCompliance`, `dummyAuditLogs`, `dummyInvoices` are analytics-shaped
  fixtures for non-analytics domains — excluded from the engine.
- `analytics_alerts` table duplicates the alerting module's rule model and has no
  API; frozen.

## 5. Expensive metrics and how the design makes them cheap

| Metric | Why expensive today | Mitigation |
| --- | --- | --- |
| Latency percentiles | `PERCENTILE_CONT` over raw rows per request (`repository.ts` runs it on every dashboard call) | workers compute exact percentiles per 1-minute bucket **and** persist a fixed 24-bucket log-scale latency histogram; coarser windows merge histograms, so no raw scan and no percentile-of-percentiles error beyond bucket width |
| Unique users / sessions / tenants | `COUNT(DISTINCT)` over raw rows | store exact distinct per 1-minute bucket **plus** a 12 KB HLL sketch (`bytea`) per bucket; coarse windows merge sketches. Implemented as a pure-SQL/TS HLL to avoid a Postgres extension dependency |
| Cross-signal unified event list | 10-table `UNION ALL` (`UNIFIED_EVENTS_SQL`) on every list call | v2 list APIs query the single relevant typed table; the explorer queries per-type in parallel with a bounded fan-out and merges by `(timestamp,id)` |
| Top-N by group | `GROUP BY` over raw rows | pre-grouped entity rollups keyed by `entity_key` |
| Error grouping | full 24 h re-scan per org (`refreshErrorGroups(orgId, 24)`) | watermark-bounded incremental scan on `ingested_at` |
| Geo/browser/OS breakdown | client-side regex over `user_agent` | precomputed dimension rollups |
| DB statement analytics | client-side regex normalisation of `db_statement` | worker normalises once and stores `statement_pattern` |
| Trace service map | client-side grouping of spans | `analytics_trace_service_edges` written by the traces worker |
| Session reconstruction | not attempted | `analytics.sessions` maintains `analytics_user_sessions` incrementally with a 30-minute inactivity close-out |

## 6. Metric naming convention (enforced by the catalog)

`<domain>.<subject>[.<qualifier>]` in snake_case, e.g.
`requests.total`, `requests.error_rate`, `requests.latency_p95`,
`errors.groups_unresolved`, `logs.volume_by_level`, `traces.partial_rate`,
`crons.success_rate`, `runtime.eventloop.lag_p95`, `usage.billable_events`.
Every metric in `10-analytics-catalog.md` has exactly one name, one formula, one
owning worker, and one rollup table.

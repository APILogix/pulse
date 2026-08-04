# Phase 6 — Dashboard Optimization Report

Reviewed: 11 custom dashboards, 22 observability surfaces, 3 service pages,
6 ingestion pages, 6 unrouted insight pages, project monitor scope.

Optimization principles applied:
1. One question per widget. If a widget cannot be phrased as a question an
   on-call engineer asks, it is removed.
2. No duplicated information across dashboards in the same navigation group.
3. Every widget must map to exactly one metric in the catalog (Phase 16/17).
4. Platform self-telemetry does not belong in tenant dashboards.
5. Widgets whose data cannot exist yet are gated by a capability flag, not faked.

---

## 1. Removals

| Dashboard | Widget removed | Reason |
| --- | --- | --- |
| `/dashboards/infrastructure` | DB connection pool gauge, cache hit/miss donut, resource utilization by service | platform self-telemetry, not tenant data; belongs on an internal ops dashboard |
| `/dashboards/infrastructure` | Serverless cold starts | no cold-start attribute in telemetry; gated behind `capabilities.coldStart` |
| `/dashboards/realtime` | Active connections gauge (`CONN_LIMITS`) | fabricated; replaced by real per-signal ingestion rate-limit consumption |
| `/dashboards/business` | Estimated API revenue | revenue is billing's domain and its formula (`calls × $0.0004`) is fiction |
| `/observability/service-health` | Readiness checks table + dependency map placeholder | duplicates `/services/dependencies` and the tracing service map; the placeholder text ("Interactive topology graph renders here") is an unfinished stub |
| `/observability` (ExecutiveDashboard) | whole page | 95 % duplicate of `/dashboards/executive`; redirect `/observability` → `/observability/requests` |
| `/dashboards/overview` | 10 preview cards with 3 stats each | 30 numbers nobody acts on; replaced by 6 KPI cards + a navigation grid without per-card stats |
| `/dashboards/errors` + `/observability/errors` | one of the two | both are error triage over the same data. Keep `/observability/errors` as the list/triage surface; `/dashboards/errors` becomes the *analytical* view (mechanism mix, impact by service, regression detection) with no group list |
| `/insights/PoliciesPage`, `/insights/CostUsagePage`, `/insights/AiOverviewPage` | delete files | unrouted duplicates of `/admin/compliance`, `/billing/usage`, `/ai` |

## 2. Additions (enterprise gaps)

| Surface | Widget added | Metric |
| --- | --- | --- |
| `/dashboards/executive` | Error budget / SLO burn-down per service | `slo.burn_rate`, `slo.error_budget_remaining` |
| `/dashboards/executive` | Apdex trend | `requests.apdex` |
| `/dashboards/executive` | Top movers (biggest metric deltas vs previous period) | derived from any rollup with `compare=previous` |
| `/dashboards/performance` | Latency histogram distribution (real, 24 log-scale buckets) | `requests.latency_histogram` |
| `/dashboards/performance` | Slow-path attribution: request P95 vs span self-time contribution | `spans.self_time_p95` by operation |
| `/dashboards/performance` | Saturation vs latency correlation (throughput on x, P95 on y) | `requests.total` + `requests.latency_p95` |
| `/dashboards/errors` | Error regression detector (bucket vs trailing 7-day baseline, z-score) | `errors.regression_score` |
| `/dashboards/errors` | New-in-release error groups | `errors.new_in_release` |
| `/dashboards/errors` | Crash-free session rate | `sessions.crash_free_rate` |
| `/dashboards/tracing` | Real service dependency graph with edge latency + error rate | `traces.edge_call_count`, `traces.edge_p95`, `traces.edge_error_rate` |
| `/dashboards/tracing` | Critical-path breakdown for the slowest trace shape | `traces.critical_path_ms` |
| `/dashboards/geo` | Latency by region choropleth (not just volume) | `geo.latency_p95` |
| `/dashboards/geo` | Device/browser error-rate comparison | `geo.error_rate_by_browser` |
| `/dashboards/releases` | Release adoption curve (traffic share per release over time) | `releases.adoption_share` |
| `/dashboards/releases` | Automatic regression verdict per release | `releases.verdict` |
| `/observability/crons` | Monitor state board (expected vs actual schedule, missed runs) | `crons.missed_runs`, `crons.last_state` |
| `/observability/logs` | Log volume by level over time + noisy-logger ranking | `logs.volume_by_level`, `logs.top_loggers` |
| `/observability/metrics` | Per-series sparkline and cardinality warning | `metrics.series_cardinality` |
| `/services` | Service catalog with owner, SLO, dependencies, live health | `services.*` |
| `/ingestion/health` | Accepted vs rejected vs dropped volume, per-signal, with reject reasons | `ingestion.accepted`, `ingestion.rejected_by_reason` |
| `/ingestion/rate-limits` | Real per-key rate-limit consumption and 429 attribution | `usage.rate_limit_consumption` |
| new `/insights/anomalies` (promote existing page) | Anomaly feed across all rollups | `anomalies.*` |
| new `/insights/root-cause` (promote existing page) | Correlated signal timeline for an incident window | multi-metric correlation |
| new `/insights/releases` (promote `ReleaseImpactPage`) | Release impact analysis | `releases.*` |
| every KPI card | server-provided `delta` + `direction` | removes hardcoded `"+12.4%"` strings |

## 3. Simplifications

| Change | Effect |
| --- | --- |
| Collapse `/observability/{runtime-metrics,event-loop,gc-monitoring}` into one `/observability/runtime` page with three tabs | 3 near-empty pages → 1 coherent surface; all three read `analytics_runtime_*` |
| Collapse `/observability/{profiling,replay}` into `/observability/sessions-and-profiles`? **No** — keep separate (different personas), but both gain real KPIs | preserves task focus |
| Move `/observability/latency` percentile tables into `/dashboards/performance` tabs, keep `/observability/latency` as the quick-look P50–P99 + slowest list | removes the duplicated by-dimension table |
| Standardise every time filter on the shared `timeRangeStore` and pass `from`/`to` to the server | removes per-page bespoke `TIME_OPTIONS` (three variants exist today, including a 24h/7d/30d one in `InfrastructureCost`) |
| Standardise KPI card semantics via `direction` from the server | removes the current inconsistency where `trend="up"` sometimes means "good" and sometimes "increasing" |
| One shared `<ServerSeriesChart metricKey=… />` component | 11 dashboards currently import `seededSeries` and build chart series by hand |

## 4. AI integration points (per widget)

| Widget class | AI hook |
| --- | --- |
| Any KPI card with `delta` breaching a threshold | "Explain this change" → `aiContext` includes metric key, both windows, top contributing dimensions |
| Error group | "Investigate" → fingerprint, stack frames, affected releases, regression score |
| Slow endpoint / span | "Why is this slow" → latency percentiles, dependency self-time split |
| Release verdict | "Should we roll back" → before/after comparison payload |
| Anomaly feed item | "Root cause" → correlated metrics in the same window |
| Cron monitor failure | "Diagnose" → last N check-ins + duration trend |

Each API response therefore carries `aiContext: string` per widget block. The
frontend never assembles prompts from raw rows (today `AskAiButton` string-builds
prompts inside table cells on 12 pages).

## 5. Alert integration points

| Metric | Alert condition offered from the widget |
| --- | --- |
| `requests.error_rate` | > threshold for N minutes |
| `requests.latency_p95` | > threshold, or > baseline × factor |
| `requests.total` | drop > X % vs same time yesterday (traffic loss) |
| `errors.regression_score` | > z threshold |
| `crons.missed_runs` | ≥ 1 |
| `slo.burn_rate` | fast-burn (14.4×) and slow-burn (6×) windows |
| `usage.billable_events` | quota % thresholds |
| `ingestion.rejected_by_reason` | rejection spike |
| `runtime.eventloop.lag_p95` | > threshold |

Each widget's "Create alert" action posts a rule pre-filled with the catalog
metric key and the widget's current dimension filters.

## 6. Resulting dashboard set

| Group | Surfaces after optimization |
| --- | --- |
| Home | `/` global dashboard |
| Dashboards | overview, executive, performance, errors (analytical), geo, realtime, tracing, releases, security, business, infrastructure (tenant-relevant widgets only), reports |
| Observability | requests, events, errors (triage), latency, traces, logs, metrics, profiling, crons, replay, runtime (tabbed), + detail pages |
| Services | catalog, dependencies, SLOs |
| Insights | anomalies, root-cause, release impact |
| Project scope | overview, analytics, usage, activity |
| Cross-module | `/alerts/metrics`, `/ai/usage`, `/billing/usage`, `/ingestion/*` |

Net change: **−4 surfaces** (observability executive dashboard, 3 deleted insight
pages), **−3 pages merged** into `/observability/runtime`, **+3 promoted** insight
pages, **+24 new widgets**, **−11 fabricated widgets**.

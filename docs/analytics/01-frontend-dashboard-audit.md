# Phase 1 + 2 — Complete Frontend Audit & Frontend Data Contract

Frontend under audit: `../pulsiv_fe` (React 19, Vite, TanStack Query v5, Zustand,
Tailwind CSS variables theme). Route source of truth:
`pulsiv_fe/src/app/router/protected-routes.tsx`.

Every claim below was verified by reading the referenced file. Where a page
fabricates data client-side the exact helper is named.

---

## 1. Route inventory (authenticated shell)

| # | Route | Component | Analytics-bearing | Current data source |
| --- | --- | --- | --- | --- |
| 1 | `/`, `/dashboard` | `modules/dashboard/DashboardPage` | yes | dummy |
| 2 | `/dashboards` , `/dashboards/overview` | `dashboards/DashboardsOverview` | yes | dummy + `seededSeries` |
| 3 | `/dashboards/executive` | `dashboards/ExecutiveCommandCenter` | yes | dummy + `seededSeries` |
| 4 | `/dashboards/performance` | `dashboards/PerformanceDeepDive` | yes | dummy + `seededSeries` + `Math.random` |
| 5 | `/dashboards/errors` | `dashboards/ErrorTriage` | yes | dummy |
| 6 | `/dashboards/geo` | `dashboards/GeoAnalytics` | yes | dummy + `countryForIp` (fake geo) |
| 7 | `/dashboards/realtime` | `dashboards/RealtimeTraffic` | yes | dummy + `seededSeries` + hardcoded `CONN_LIMITS` |
| 8 | `/dashboards/tracing` | `dashboards/TracingDependencyMap` | yes | dummy |
| 9 | `/dashboards/infrastructure` | `dashboards/InfrastructureCost` | yes | hardcoded |
| 10 | `/dashboards/security` | `dashboards/SecurityThreat` | yes | dummy |
| 11 | `/dashboards/releases` | `dashboards/ReleaseQuality` | yes | dummy + hardcoded releases |
| 12 | `/dashboards/business` | `dashboards/BusinessMetrics` | yes | hardcoded |
| 13 | `/dashboards/reports` | `dashboards/ScheduledReportsPage` | partial | hardcoded |
| 14 | `/dashboards/reports/new` | `dashboards/CreateReportPage` | no | form only |
| 15 | `/observability` | `observe/ExecutiveDashboard` | yes | dummy + `Math.random` sparkline |
| 16 | `/observability/requests` | `observe/RequestsPage` | yes | dummy |
| 17 | `/observability/requests/:requestId` | `observe/RequestDetailPage` | yes | dummy |
| 18 | `/observability/events` | `observe/EventsExplorer` | yes | dummy |
| 19 | `/observability/events/:eventId` | `observe/EventDetailPage` | yes | dummy |
| 20 | `/observability/errors` | `observe/ErrorGroupsPage` | yes | dummy + hardcoded regression banner |
| 21 | `/observability/errors/:fingerprint` | `observe/ErrorDetailPage` | yes | dummy |
| 22 | `/observability/service-health` | `observe/ServiceHealthPage` | yes | hardcoded `SERVICES`/`DEPENDENCIES` + `Math.random` |
| 23 | `/observability/latency` | `observe/LatencyPage` | yes | dummy + client-side `percentile` |
| 24 | `/observability/traces` | `observe/TracesPage` | yes | dummy |
| 25 | `/observability/traces/:traceId` | `observe/TraceDetailPage` | yes | dummy |
| 26 | `/observability/logs` | `observe/LogsPage` | yes | dummy |
| 27 | `/observability/logs/:eventId` | `observe/LogDetailPage` | yes | dummy |
| 28 | `/observability/metrics` | `observe/MetricsPage` | yes | dummy |
| 29 | `/observability/profiling` | `observe/ProfilingPage` | yes | dummy |
| 30 | `/observability/crons` | `observe/CronsPage` | yes | dummy |
| 31 | `/observability/replay` | `observe/ReplayPage` | yes | dummy |
| 32 | `/observability/runtime-metrics` | `observe/RuntimeMetricsPage` | yes | dummy + `seededSeries` |
| 33 | `/observability/event-loop` | `observe/EventLoopPage` | yes | dummy |
| 34 | `/observability/gc-monitoring` | `observe/GcMonitoringPage` | yes | dummy |
| 35 | `/services` | `services/ServiceCatalogPage` | yes | dummy |
| 36 | `/services/dependencies` | `services/ServiceDependenciesPage` | yes | dummy |
| 37 | `/services/slos` | `services/ServiceSlosPage` | yes | hardcoded SLO targets |
| 38 | `/:orgSlug/projects` | `workspaces/ProjectsPage` | partial | real API (`projects.api`) |
| 39 | `/:orgSlug/p/:id/overview` | `workspaces/ProjectOverviewPage` | yes | mixed real + dummy |
| 40 | `/:orgSlug/p/:id/analytics` | `workspaces/ProjectAnalyticsPage` | yes | real `/analytics/:projectId/dashboard` |
| 41 | `/:orgSlug/p/:id/usage` | `workspaces/ProjectUsagePage` | yes | real usage API |
| 42 | `/:orgSlug/p/:id/activity` | `workspaces/ProjectActivityPage` | partial | real API |
| 43–56 | project telemetry/alerting/config routes | 14 components | no | real APIs |
| 57 | `/alerts` | `act/AlertEventsPage` | partial | real alerting API |
| 58 | `/alerts/metrics` | `act/AlertMetricsPage` | yes | real alerting metrics API |
| 59–67 | remaining `/alerts/*` | 9 components | no | real alerting API |
| 68–77 | `/automation/*` | 10 components | partial | real automation API |
| 78 | `/ingestion` | `connections/ConnectionsOverview` | yes | dummy |
| 79 | `/ingestion/endpoints` | `connections/ApiEndpointsPage` | yes | dummy |
| 80 | `/ingestion/health` | `connections/ConnectionHealthPage` | yes | dummy |
| 81 | `/ingestion/keys` | `connections/KeysTokensPage` | partial | dummy |
| 82 | `/ingestion/replay` | `connections/PipelinePage` | yes | dummy |
| 83 | `/ingestion/rate-limits` | `connections/RateLimitsPage` | yes | dummy |
| 84 | `/ai` | `ai/AiOverviewPage` | yes | real AI API |
| 85 | `/ai/usage` | `ai/AiUsagePage` | yes | real AI API |
| 86–90 | remaining `/ai/*` | 5 components | no | real AI API |
| 91–104 | `/admin/*` | 14 components | partial | real org/auth APIs |
| 105 | `/billing` | `billing/PlanPage` | no | real billing API |
| 106 | `/billing/usage` | `billing/BillingUsagePage` | yes | real billing usage API |
| 107–109 | invoices / payment methods | 3 components | no | real billing API |
| 110–116 | `/connectors/*` | 7 components | partial | real connector API |
| 117–118 | `/developer/*` | 2 components | no | real APIs |
| 119+ | `/settings/*`, `/account/*`, `/auth/*` | auth panels | no | real auth APIs |

### Unrouted pages found (dead code, Phase 19 input)

`src/pages/insights/` contains six components that are **not referenced by any
route**: `RootCausePage`, `AnomaliesPage`, `AiOverviewPage`, `CostUsagePage`,
`ReleaseImpactPage`, `PoliciesPage`. They consume `useAnomalies`, `useReleases`,
`useCompliance` from the dummy hook layer. Decision recorded in
`05-dashboard-optimization.md`: three are promoted to real routes backed by
analytics rollups, three are deleted.

---

## 2. Widget/KPI inventory per analytics-bearing surface

Notation: `KPI` = single number card, `TS` = time series, `TOP` = ranked list,
`DIST` = distribution, `TBL` = paginated/virtualized table, `HEAT` = heatmap,
`GEO` = map, `GRAPH` = node/edge graph.

### 2.1 `/` Global Dashboard (`DashboardPage`)
| Widget | Kind | Required backend field |
| --- | --- | --- |
| Requests (24h) | KPI + delta | `requests.total`, `requests.deltaPct` |
| Error rate | KPI + delta | `errors.ratePct`, `errors.deltaPct` |
| P95 latency | KPI + delta | `latency.p95Ms`, `latency.deltaMs` |
| Availability | KPI | `availability.pct` |
| Active incidents | KPI | `alerts.openCount` |
| Traffic timeline | TS (1h buckets, 24h) | `series.requests[]`, `series.errors[]` |
| Top error groups | TOP (6) | `topErrorGroups[]` |
| Slowest endpoints | TOP (6) | `topSlowEndpoints[]` |
| Service health tiles | KPI grid + sparkline | `services[]` |

### 2.2 `/dashboards/overview`
| Widget | Kind | Required backend field |
| --- | --- | --- |
| Health score | KPI | `health.score` (server-computed composite) |
| Requests 24h / Error rate / P95 / Security score / Traces | KPI ×5 | `summary.*` |
| 10 dashboard preview cards (3 stats + sparkline each) | TOP + TS | `previews[]` with `stats[]` + `spark[]` |

### 2.3 `/dashboards/executive`
| Widget | Kind | Required backend field |
| --- | --- | --- |
| Hero band: API calls, error rate, P95, availability, revenue at risk | KPI ×5 + sparkline | `hero[]` |
| Request volume & error correlation | TS dual-axis (24 buckets) | `series.requests[]`, `series.errors[]` |
| Latency distribution | TS multi-line P50/P75/P90/P95/P99 | `series.latencyPercentiles` |
| Service fleet tiles | KPI grid + sparkline + release | `services[]` |
| Top error groups (24h) | TOP (6) | `topErrorGroups[]` |
| Slowest endpoints | TOP bar list (7) | `topSlowEndpoints[]` |
| Footer band: unique groups, affected users, avg latency, services | KPI ×4 | `footer.*` |

### 2.4 `/dashboards/performance`
| Widget | Kind | Required backend field |
| --- | --- | --- |
| Regression banner | banner | `regression` (nullable) |
| Hero: P50/P75/P90/P95/P99 + 24h delta + sparkline | KPI ×5 | `hero[]` |
| Latency distribution heatmap (7 buckets × 16 time cols) | HEAT | `heatmap.rows[]` |
| By route (P50…P99, reqs, err%) | TBL sortable | `byRoute[]` |
| By service | TBL | `byService[]` |
| By release (P95 before/after, delta, verdict) | TBL | `byRelease[]` |
| By status family | TBL | `byStatusFamily[]` |
| Upstream dependency latency | TOP bar list | `dependencies[]` |
| Cold start vs warm | DIST stacked bars | `coldStart[]` |
| Slow request analysis (> P95) | TBL (50) | `slowRequests[]` |

### 2.5 `/dashboards/errors` (Error Triage) — verified
| Widget | Kind | Required backend field |
| --- | --- | --- |
| Regression banner (hardcoded copy today) | banner | `regression{fingerprint,title,spikePct,baselineDays}` |
| Hero: total errors 24h, unique groups, affected users, resolved today | KPI ×4 + sparkline | `hero[]` |
| Error mechanism breakdown (`uncaughtException`, `unhandledRejection`, `console.error`, `express`, `fastify`, `manual`) | DIST donut | `byMechanism[]` |
| Error impact by service (fatal/error/warning stack) | DIST stacked bars horizontal | `bySeverityPerService[]` |
| Triage queue cards: name, severity, mechanism, fingerprint, message, top 3 stack frames (`inApp` flag), count, users, first/last seen, service chips, 28-point sparkline, resolve/ignore/details actions | TOP + TBL hybrid | `groups[]` with `trend[]` |
| Sort control: lastSeen / count / users / firstSeen | server sort | `sort` param |
| Mechanism filter | server filter | `mechanism` param |

### 2.6 `/dashboards/geo` — verified
| Widget | Kind | Required backend field |
| --- | --- | --- |
| Hero: DAU, MAU, DAU/MAU ratio, countries, top region | KPI ×5 | `hero[]` |
| Request volume by country (`WorldChoropleth`) | GEO | `countries[]{code,name,flag,share,requests,p95Ms,errorRatePct}` |
| Top countries ranked bars (8) | TOP | same source, truncated |
| Country detail table (requests, % traffic, est. users, P95, error rate) | TBL | `countries[]` |
| Browser breakdown | DIST donut | `byBrowser[]` |
| Operating system breakdown | TOP bar list | `byOs[]` |
| Active users: new today / returning | KPI ×2 | `users.newToday`, `users.returning` |
| Tenant distribution (top 10: requests, users, P95, err%) | TBL | `byTenant[]` |
| API adoption funnel (SDK installed → first event → active 7d → highly active 24h) | funnel | `adoptionFunnel[]` |
| SDK version adoption line | text stat | `sdkVersionShare[]` |

Today the country list is a hardcoded `COUNTRY_WEIGHTS` array with
`hashJitter()` latency/error numbers and `countryForIp()` derives country from
the first IP octet. Real source: `events_requests.geo_country_code`,
`geo_region`, `browser_family`, `os_name`, `device_type`, `tenant_id`.

### 2.7 `/dashboards/realtime` — verified
Hero: requests/min, rate-limit (429)/min, live errors, avg latency (P50).
Widgets: live request-rate sparkline (40 points, 15 m), status-code donut
(2xx/3xx/4xx/5xx), active-connection gauge with per-signal limits (hardcoded
`CONN_LIMITS` — must come from ingestion rate-limit rollups), top routes now
(rpm, err%, P95, trend sparkline), live traffic tail (40 rows), error alert
stream (20 rows), 429-threshold banner.

### 2.8 `/dashboards/tracing` — verified
Hero: traces, spans, error traces (+%), partial traces.
Widgets: partial-trace banner, service dependency map (node per service with
span volume + error-rate colour), trace list table (trace id, root span,
duration, spans, status, started, service), external API call latency P95 by
host, trace error rate by service (ok/error/unset stacked), database query
performance table (normalised statement pattern, op, `db.system`, avg, P95,
calls, err%), footer stats (avg trace duration, avg spans/trace, DB query
patterns, external deps).

Today query normalisation (`db.statement.replace(/\d+/g,'?')`), host extraction,
and system guessing all happen in the browser over span payloads.

### 2.9 `/dashboards/infrastructure` — verified
Hero: cost per 1M requests, total requests, infra spend, metric series count.
Widgets: resource utilization by service (multi-line CPU%), DB connection-pool
gauge + avg wait + acquire failures, cache hit/miss donut, serverless cold
starts bar list, queue depth & processing lag table + depth area chart, storage
growth projection (events/logs/traces) + current usage / 30-day forecast /
projected cost.

`infraCost = 504` and every utilization series are hardcoded constants today.

### 2.10 `/dashboards/security` — verified
Hero: failed auth (401/403), rate-limited (429), suspicious IPs, JWT anomalies,
sensitive accesses. Widgets: brute-force banner, security-score gauge, failed
authentication over time (401 vs 403 multi-line), failed auth by IP table
(ip, count, country, endpoint), sensitive endpoint access table (path, count,
users, failed), API-key abuse table (key, calls, countries, err%, risk score),
JWT anomaly list from error events.

### 2.11 `/dashboards/releases` — verified
Hero: DORA deploy frequency, lead time, MTTR, change failure rate.
Widgets: rollback recommendation banner, release comparison table (error rate,
P50/P95/P99, throughput, unique error groups — prev vs curr vs delta vs verdict),
canary deployment health (canary vs stable error rate + decision gate), new error
types introduced table, release selector.

`RELEASES` and the whole `COMPARISON` table are hardcoded constants today.

### 2.12 `/dashboards/business` — verified
Hero: billable API calls, estimated API revenue, 4xx rate, 5xx rate.
Widgets: API endpoint adoption table (calls, unique users, error rate, lifecycle
label derived from volume+error rate), developer error rate 4xx vs 5xx stacked
bars (14 d), time-to-first-200 funnel (account created → first API key → first
request → …), tenant table.


### 2.13 `/observability/*` (22 surfaces)
| Surface | KPIs | Table columns | Filters |
| --- | --- | --- | --- |
| Executive | requests, error rate, avg+P95 latency, active errors, affected users | — | time range |
| Requests | total, 5xx, avg latency, throughput | method, url, status, latency, time, env | q, method, status class, time |
| Request detail | — | headers, body, timing, related trace/error | — |
| Events explorer | per-type counts | type, name, service, time, env | type, q, time |
| Event detail | — | payload, trace context | — |
| Error groups | groups, occurrences, affected users, unresolved | severity, name, message, services, users, releases, first/last seen, count | q, severity, status |
| Error detail | occurrences, users, releases | occurrence list, stack, breadcrumbs | env, release |
| Service health | healthy services, uptime 30d, open incidents, apdex | readiness checks, dependency latency | — |
| Latency | P50/P90/P95/P99 | dimension (route/service/method) → p95, avg, count; slowest 10 | method, time |
| Traces | traces, avg spans, avg duration, partial | trace id, root span, service, spans, duration, status, env | — |
| Trace detail | — | waterfall spans | — |
| Logs | — | level, time, service, message, env | level, q |
| Log detail | — | context, tags, args | — |
| Metrics | total, counters, gauges, histograms | metric, type, value, service, time, env | type, q |
| Profiling | profiles captured, avg duration, total samples, services profiled | service, type, hottest function, duration, captured, env | q |
| Crons | monitors, ok, failing, total check-ins | status, monitor, duration, check-in, env | status, q |
| Replay | recorded sessions, segments, captured events, avg events/segment | play, session, segment, DOM events, recorded, env | q |
| Runtime metrics | avg heap used/total, avg handles, samples | service, heap used/total, external, rss, handles, sampled, env | q |
| Event loop | p50/p95/p99 lag, avg utilization + lag trend chart | service, lag, p95 lag, utilization, sampled, env | q |
| GC monitoring | GC events, avg pause, long pauses (>100 ms), total pause time + events-by-type bars | gc type, service, pause, heap before, heap after, time, env | gc type, q |

### 2.14 Project scope (`/:orgSlug/p/:projectPublicId/*`)
`overview` (request/error/latency KPIs + 24h series + top endpoints + top errors),
`analytics` (already server-backed by `/analytics/:projectId/dashboard`),
`usage` (events by signal per day, quota progress bars), `activity` (audit feed).

### 2.15 Cross-module analytics consumers
`/alerts/metrics` (alert volume, delivery success, MTTA/MTTR),
`/ai/usage` (AI credits, cost, tokens, per-model split),
`/billing/usage` (billable events per signal per day),
`/ingestion/{health,rate-limits,endpoints,replay}` (accepted/rejected/dropped
volume, per-key rate-limit consumption, DLQ depth).

---

## 3. Frontend data contract (Phase 2 deliverable)

### 3.1 Global request contract
Every analytics endpoint accepts this query envelope:

```
scope        = org | project             (required)
orgId        = uuid                      (implicit from auth context)
projectId    = uuid                      (required when scope=project)
environment  = string | "all"            (default all; matches events_*.environment)
from         = ISO-8601                  (required)
to           = ISO-8601                  (required)
window       = 1m | 5m | 1h | 1d         (optional; server picks the coarsest
                                          window that satisfies from/to)
compare      = none | previous           (default previous → deltas)
service      = string?                   (optional dimension filter)
release      = string?                   (optional dimension filter)
limit        = 1..200                    (top-N lists)
cursor       = opaque base64             (keyset pagination)
```

### 3.2 Global response envelope
```jsonc
{
  "meta": {
    "scope": "project",
    "projectId": "…",
    "environment": "production",
    "window": "5m",
    "range": { "from": "…", "to": "…" },
    "compareRange": { "from": "…", "to": "…" },
    "generatedAt": "…",         // server clock
    "freshness": {
      "watermark": "…",         // newest rollup bucket materialised
      "lagSeconds": 42,         // now() - watermark
      "stale": false
    },
    "queryTimeMs": 7,
    "cache": { "hit": true, "layer": "lru" },
    "pagination": { "hasMore": false, "nextCursor": null }
  },
  "data": { /* per-endpoint payload, fully formatted */ }
}
```

Rules the contract enforces:
1. Every numeric card ships `value`, `unit`, `delta`, `deltaPct`, `trend`
   (`up` / `down` / `flat`) and `direction` (`higher_is_better` /
   `lower_is_better`) so the UI never decides colour semantics.
2. Every series ships `buckets[]` of `{ t, v }` with a fixed bucket width equal
   to `meta.window`; gaps are zero-filled by the server.
3. Every top-N list ships `items[]` already sorted, already truncated, with a
   `total` and per-item `href` target for navigation.
4. Every table ships `columns[]` metadata (key, label, align, format) plus
   `rows[]`; the client never derives column sets.
5. Every widget payload ships `aiContext` (a compact string the "Ask AI" button
   forwards) so no page builds AI prompts from raw rows.
6. Refresh cadence is advertised per endpoint via
   `meta.refresh.suggestedIntervalMs`, used to configure TanStack Query
   `refetchInterval`.

### 3.3 Per-surface refresh/live matrix
| Surface | Live? | Suggested refetch | Server window | Compare |
| --- | --- | --- | --- | --- |
| `/dashboards/realtime` | live | 5 s | 1m | none |
| `/` , `/observability` , `/dashboards/executive` | near-live | 30 s | 5m | previous |
| `/dashboards/performance`, `/observability/latency` | near-live | 30 s | 5m | previous |
| `/dashboards/errors`, `/observability/errors` | near-live | 30 s | 5m | previous |
| `/observability/{requests,logs,events,traces,metrics}` lists | tail | 15 s | raw keyset | none |
| `/dashboards/{geo,tracing,security}` | historical | 60 s | 1h | previous |
| `/dashboards/{infrastructure,releases,business}` | historical | 300 s | 1d | previous |
| `/services/*`, `/observability/service-health` | near-live | 60 s | 5m | previous |
| project `overview`/`analytics` | near-live | 30 s | 5m | previous |
| project `usage`, `/billing/usage`, `/ai/usage` | historical | 300 s | 1d | previous |
| `/alerts/metrics` | near-live | 60 s | 1h | previous |
| `/ingestion/*` | near-live | 30 s | 5m | previous |

### 3.4 Filter/sort/pagination contract
- Time filter values used by the UI (`stores/timeRangeStore.ts` `TIME_RANGES`)
  map to `from`/`to`; the server selects `window` from the span:
  `≤ 1h → 1m`, `≤ 6h → 5m`, `≤ 7d → 1h`, `> 7d → 1d`.
- Environment filter is a free-form string matching
  `^[A-Za-z0-9][A-Za-z0-9._-]*$` (already enforced in
  `src/modules/analytics/routes.ts`), plus the sentinel `all`.
- Project filter is derived from the route (`projectPublicId` → uuid) — never a
  client-side array filter.
- Search on list surfaces is a server-side predicate (`q`), never a client
  `Array.prototype.filter`.
- Sorting on rollup-backed tables is server-side, expressed as
  `sort=<column>:<asc|desc>` restricted to a per-endpoint allowlist.
- Pagination is keyset (`cursor`) for raw event lists and offset-free `limit`
  truncation for top-N rollup lists.

### 3.5 Actions contract
| Action | Endpoint | Notes |
| --- | --- | --- |
| Resolve / ignore error group | `PATCH /analytics/v2/errors/groups/:fingerprint` | already exists in v1; kept |
| Ask AI | `POST /ai/investigations` with `aiContext` | context comes from widget payload |
| Export CSV | `GET …?format=csv` | server renders CSV from the same rollup query |
| Create alert from widget | `POST /alerting/rules` | prefilled with metric key from the catalog |
| Pin widget to custom dashboard | `POST /analytics/v2/dashboards/:id/widgets` | stores metric key + dimensions, not SQL |

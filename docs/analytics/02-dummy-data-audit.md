# Phase 3 — Dummy / Mock / Hardcoded Data Audit

Two files own every fake analytics number in the product:

| File | Size | Role |
| --- | --- | --- |
| `pulsiv_fe/src/lib/dummy-data.ts` | 46 KB | 27 exported fixture datasets, generated at module load with `Math.random()` and `crypto.randomUUID()` |
| `pulsiv_fe/src/hooks/useDummyData.ts` | 9.7 KB | 40 `useSuspenseQuery` hooks that wrap the fixtures behind an artificial `delay()` |

Secondary fabrication sites (in-component, not fixture files):

| File | Mechanism | Effect |
| --- | --- | --- |
| `pulsiv_fe/src/pages/dashboards/lib.ts` | `seededSeries(seed,len,base,variance)` | fabricates **every** time-series line/area/sparkline in the product |
| `pulsiv_fe/src/pages/dashboards/lib.ts` | `countryForIp(ip)` = `COUNTRIES[firstOctet % 10]` | fabricates geography |
| `pulsiv_fe/src/pages/dashboards/lib.ts` | `percentile`, `avg`, `bucketCounts`, `errorRate`, `groupBy`, `uniqueBy` | client-side aggregation of raw rows |
| `pulsiv_fe/src/pages/dashboards/GeoAnalytics.tsx` | `COUNTRY_WEIGHTS` + `hashJitter()` | fabricates per-country requests, P95, error rate |
| `pulsiv_fe/src/pages/dashboards/InfrastructureCost.tsx` | `infraCost = 504`, `QUEUES`, `connActive/connMax`, `cacheHits/cacheMiss` | fabricates cost + utilization + queue depth |
| `pulsiv_fe/src/pages/dashboards/ReleaseQuality.tsx` | `RELEASES`, `COMPARISON`, `resolvedCount = 8` | fabricates the entire release comparison |
| `pulsiv_fe/src/pages/dashboards/RealtimeTraffic.tsx` | `CONN_LIMITS` | fabricates per-signal connection saturation |
| `pulsiv_fe/src/pages/dashboards/SecurityThreat.tsx` | `SENSITIVE`, `randomCounts`, `randomJWT` | fabricates sensitive-endpoint + JWT anomaly counts |
| `pulsiv_fe/src/pages/dashboards/PerformanceDeepDive.tsx` | `randomDurs`, hardcoded release rows, `v2.4.1 · 4h ago` | fabricates dependency latency + release deltas |
| `pulsiv_fe/src/pages/observe/ExecutiveDashboard.tsx` | `Math.random()` sparkline, hardcoded `services[]`, hardcoded deltas | fabricates service fleet health |
| `pulsiv_fe/src/pages/observe/ServiceHealthPage.tsx` | `SERVICES`, `DEPENDENCIES`, `Math.random()` sparkline, `"4 / 5"`, `"99.94%"`, `"3"`, `"0.96"` | fabricates every number on the page |
| `pulsiv_fe/src/pages/observe/ErrorGroupsPage.tsx` | regression banner copy, `Math.round(groups.length*0.7)` unresolved | fabricates regression + unresolved count |
| `pulsiv_fe/src/pages/observe/RequestsPage.tsx` | `total * 3` throughput | fabricates throughput |
| `pulsiv_fe/src/pages/dashboards/ErrorTriage.tsx` | regression banner, `resolvedCount = 7`, `+18% vs prev` | fabricates deltas |

---

## 1. Fixture-by-fixture removal plan

| # | Fixture export | Hook | Consumers | Expected real data | Telemetry source | Analytics worker | Rollup / read table | Backend API |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `dummyErrorEvents` (150) | `useErrorEvents`, `useErrorEvent` | ExecutiveDashboard, ExecutiveCommandCenter, RealtimeTraffic, SecurityThreat, ServiceHealthPage, ErrorDetailPage | error occurrence rows | `events_errors` | `analytics.errors` | raw keyset read + `analytics_error_occurrence_1m` | `GET /analytics/v2/errors/events` |
| 2 | `dummyErrorGroups` | `useErrorGroups`, `useErrorGroup` | ErrorGroupsPage, ErrorTriage, DashboardsOverview, ReleaseQuality | grouped error state | `events_errors` | `analytics.errors` | `analytics_error_groups` (exists) + `analytics_error_group_1h` | `GET /analytics/v2/errors/groups` |
| 3 | `dummyRequestEvents` | `useRequestEvents`, `useRequestEvent` | 12 surfaces | request rows | `events_requests` | `analytics.requests` | raw keyset read | `GET /analytics/v2/requests/events` |
| 4 | `dummySpanEvents` | `useSpanEvents` | PerformanceDeepDive, TracingDependencyMap | span rows + db/http attributes | `events_spans` | `analytics.spans` | `analytics_span_op_1m`, `analytics_db_statement_1h`, `analytics_dependency_1h` | `GET /analytics/v2/spans/*` |
| 5 | `dummyTraceEvents` | `useTraceEvents`, `useTraceEvent` | TracesPage, TraceDetailPage, TracingDependencyMap, DashboardsOverview | trace rows + waterfall | `events_traces` | `analytics.traces` | `analytics_trace_1m`, `analytics_trace_service_edges` (exists) | `GET /analytics/v2/traces` |
| 6 | `dummyLogEvents` | `useLogEvents`, `useLogEvent` | LogsPage, LogDetailPage | log rows | `events_logs` | `analytics.logs` | raw keyset read + `analytics_log_1m` | `GET /analytics/v2/logs/events` |
| 7 | `dummyMetricEvents` | `useMetricEvents` | MetricsPage, InfrastructureCost | custom metric rows | `events_metrics` | `analytics.metrics` | `analytics_metric_1m`, `analytics_metric_1h` | `GET /analytics/v2/metrics` |
| 8 | `dummyProfileEvents` | `useProfileEvents` | ProfilingPage | profile rows + hot function | `events_profiles` | `analytics.profiles` | `analytics_profile_1h`, `analytics_profile_function_1h` | `GET /analytics/v2/profiles` |
| 9 | `dummyCronEvents` | `useCronEvents` | CronsPage | cron check-ins | `events_cron_checkins` | `analytics.crons` | `analytics_cron_1m`, `analytics_cron_monitor_state` | `GET /analytics/v2/crons` |
| 10 | `dummyReplayEvents` | `useReplayEvents` | ReplayPage | replay segments | `events_replays` | `analytics.replays` | `analytics_replay_1h`, `analytics_replay_session` | `GET /analytics/v2/replays` |
| 11 | `dummyRuntimeMetricSamples` | `useRuntimeMetricSamples` | RuntimeMetricsPage | heap/rss/handles samples | `events_metrics` where `metric_name IN ('runtime.heap.used',…)` | `analytics.runtime` | `analytics_runtime_1m`, `analytics_runtime_1h` | `GET /analytics/v2/runtime/memory` |
| 12 | `dummyEventLoopSamples` | `useEventLoopSamples` | EventLoopPage | lag + utilization samples | `events_metrics` where `metric_name IN ('runtime.eventloop.lag',…)` | `analytics.runtime` | `analytics_runtime_1m` | `GET /analytics/v2/runtime/event-loop` |
| 13 | `dummyGcPauseEvents` | `useGcPauseEvents` | GcMonitoringPage | GC pause samples | `events_metrics` where `metric_name = 'runtime.gc.pause'` | `analytics.runtime` | `analytics_gc_1m`, `analytics_gc_1h` | `GET /analytics/v2/runtime/gc` |
| 14 | `dummyProjects` | `useProjects` | ProjectsPage variants | project list + health | control plane `projects` + `analytics_project_health_5m` | `analytics.services` | `analytics_project_health_5m` | existing `GET /projects` + `GET /analytics/v2/projects/health` |
| 15 | `dummyIncidents` | `useIncidents`, `useIncident` | IncidentsPage, IncidentDetailPage | alert events | `alert_events` (Log DB alert runtime) | none (alerting owns) | — | existing alerting API |
| 16 | `dummyAlertRules` | `useAlertRules`, `useAlertRule` | AlertRulesPage | alert rules | control plane | none | — | existing alerting API |
| 17 | `dummyEscalations` | `useEscalations`, `useEscalation` | EscalationsPage | escalation policies | control plane | none | — | existing alerting API |
| 18 | `dummyChannels` | `useChannels`, `useChannel` | ChannelsPage | channels | control plane | none | — | existing alerting API |
| 19 | `dummyApiKeys` | `useApiKeys` | KeysTokensPage | API keys + usage | control plane + `analytics_api_key_1h` | `analytics.usage` | `analytics_api_key_1h` | existing key API + `GET /analytics/v2/usage/api-keys` |
| 20 | `dummyInvoices` | `useInvoices` | InvoicesPage | invoices | control plane billing | none | — | existing billing API |
| 21 | `dummyAuditLogs` | `useAuditLogs` | AuditLogsPage | audit records | control plane audit | none | — | existing audit API |
| 22 | `dummyWebhooks` | `useWebhooks`, `useWebhook` | WebhooksPage | webhooks | control plane | none | — | existing webhook API |
| 23 | `dummyIntegrations` | `useIntegration` | IntegrationDetailPage | integrations | control plane | none | — | existing connector API |
| 24 | `dummyEndpoints` | `useEndpoints` | ApiEndpointsPage | endpoint catalog | `events_requests` | `analytics.endpoints` | `analytics_endpoint_5m/1h/1d` | `GET /analytics/v2/endpoints` |
| 25 | `dummyCompliance` | `useCompliance` | CompliancePage | compliance posture | control plane | none | — | existing compliance API |
| 26 | `dummyAnomalies` | `useAnomalies` | AnomaliesPage (unrouted) | anomaly detections | rollups + AI | `analytics.anomalies` | `analytics_anomaly_1h` | `GET /analytics/v2/anomalies` |
| 27 | `dummyReleases` | `useReleases` | ReleaseImpactPage (unrouted) | release health | `events_requests.release`, `events_errors.release` | `analytics.releases` | `analytics_release_1h`, `analytics_release_compare` | `GET /analytics/v2/releases` |

## 2. Client-side aggregation to delete

| Helper | Location | Replacement |
| --- | --- | --- |
| `percentile()` | `dashboards/lib.ts` + inline copy in `observe/ExecutiveDashboard.tsx` | server `latency_p50/p75/p90/p95/p99` columns in rollups |
| `avg()` | `dashboards/lib.ts` | server `SUM(duration)/COUNT(*)` in rollups |
| `errorRate()` | `dashboards/lib.ts` | server `error_count / total_count` |
| `bucketCounts()` | `dashboards/lib.ts` | server bucket columns (`bucket_start`) |
| `groupBy()` / `uniqueBy()` | `dashboards/lib.ts` | server `GROUP BY` + HLL/`COUNT(DISTINCT)` in rollups |
| `seededSeries()` | `dashboards/lib.ts` | server `series[]` payload |
| `countryForIp()` | `dashboards/lib.ts` | `events_requests.geo_country_code` |
| `bucketUserAgent()` | `dashboards/GeoAnalytics.tsx` | `events_requests.browser_family` / `os_name` |
| `normalizeQuery()`/`hostOf()`/`guessSystem()` | `dashboards/TracingDependencyMap.tsx` | `analytics.spans` worker writes normalised `db_statement_pattern`, `http_host`, `db_system` |
| `bucketIndex()` latency histogram | `dashboards/PerformanceDeepDive.tsx` | `analytics_latency_histogram_5m` bucket columns |
| `lifecycle()` endpoint classification | `dashboards/BusinessMetrics.tsx` | `analytics_endpoint_1d.lifecycle` computed by `analytics.endpoints` |
| `hashJitter()` | `dashboards/GeoAnalytics.tsx` | `analytics_geo_1h` real values |

`percentile` appears **twice** (shared helper + a private copy inside
`ExecutiveDashboard.tsx`) — a duplicate-metric-definition defect recorded in
`12-coverage-report.md`.

## 3. Deletion order (safe sequencing)

1. Ship rollups + workers + `/analytics/v2/*` endpoints (backend only, no
   frontend change). Dummy data still renders.
2. Add `pulsiv_fe/src/modules/analytics/api/*` client + typed hooks mirroring the
   v2 contract 1:1.
3. Migrate surfaces one module at a time in this order: `observe` lists →
   `observe` aggregates → `dashboards` → project scope → cross-module
   (`ingestion`, `ai`, `billing`, `alerts/metrics`).
4. After the last consumer of a fixture is migrated, delete that fixture export.
5. Delete `useDummyData.ts`, then `dummy-data.ts`, then the fabrication helpers
   from `dashboards/lib.ts` (keeping only pure formatting helpers, which live in
   `shared/observe/format.ts`).
6. Add an ESLint `no-restricted-imports` rule banning `@/lib/dummy-data` and a
   `no-restricted-syntax` rule banning `Math.random()` inside `src/pages/**` so
   the fixtures cannot come back.

## 4. Signals the frontend expects that the Log DB does not yet capture

| Frontend field | Current source | Gap | Resolution |
| --- | --- | --- | --- |
| `RuntimeMetricSample.heapUsedMb/heapTotalMb/externalMb/rssMb/activeHandles` | fixture | no canonical table | ingest as `events_metrics` rows with reserved `metric_name` prefix `runtime.*`; `analytics.runtime` reads them |
| `EventLoopSample.lagMs/p95LagMs/utilizationPercent` | fixture | no canonical table | same, prefix `runtime.eventloop.*` |
| `GcPauseEvent.gcType/pauseDurationMs/heapBeforeMb/heapAfterMb` | fixture | no canonical table | same, `metric_name='runtime.gc.pause'`, `tags.gc_type` |
| Infrastructure cost / infra spend | hardcoded | not telemetry | derive from `analytics_usage_1d` × plan rate card (billing owns rate card) |
| DB pool / cache hit / queue depth | hardcoded | platform self-telemetry | expose from the platform's own `prom-client` registry via `analytics.platform` (out of scope for v1; documented as future expansion) |
| DORA metrics (deploy freq, lead time, MTTR, CFR) | hardcoded | needs deployment events | requires a `deployments` signal; documented as future expansion with an explicit ingest contract |
| MRR / revenue / churn | hardcoded | control-plane billing | `analytics.billing` reads control-plane billing aggregates, not Log DB (documented exception) |

# Phase 16 — Analytics Dependency Matrix

Single source of truth. Every frontend widget maps to exactly one analytics
source. Read each row as:

`Dashboard → Widget → Backend API → Analytics Worker → Rollup Table → Source
Telemetry Table → Source Event Types → Refresh Frequency → Aggregation Window →
Alert Dependencies → AI Dependencies`

Abbreviations: `E_REQ`=`events_requests`, `E_ERR`=`events_errors`,
`E_LOG`=`events_logs`, `E_MET`=`events_metrics`, `E_SPN`=`events_spans`,
`E_TRC`=`events_traces`, `E_CRN`=`events_cron_checkins`,
`E_PRF`=`events_profiles`, `E_RPL`=`events_replays`, `E_MSG`=`events_messages`.
`—` means "none".

---

## 1. Home `/`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Requests (24h) card | `GET /analytics/v2/overview` | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | Traffic drop | Traffic trend |
| Error rate card | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | High error rate | Error trend |
| P95 latency card | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | High latency | Latency trend |
| Availability card | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | Availability SLO | — |
| Active incidents card | same | `analytics.alerts` | `alert_metrics_1h` | `alert_events` | alert | 30 s | 1h | — | Incident summary |
| Traffic timeline | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | — | Anomaly narrative |
| Top error groups | same | `analytics.errors` | `error_group_metrics_1h` | `E_ERR` | error | 30 s | 1h | New group | Group investigation |
| Slowest endpoints | same | `analytics.endpoints` | `endpoint_metrics_5m` | `E_REQ` | request | 30 s | 5m | Endpoint latency | Slow-path analysis |
| Service health tiles | same | `analytics.services` | `service_metrics_5m` | `E_REQ`,`E_SPN` | request, span | 30 s | 5m | Service error rate | Service health summary |

## 2. `/dashboards/overview`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Health score | `GET /analytics/v2/overview` | `analytics.health` | `project_health_5m` | `E_REQ`,`E_ERR` | request, error | 30 s | 5m | Health degradation | Health explanation |
| Requests 24h / Error rate / P95 | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | as §1 | as §1 |
| Security score | same | `analytics.security` | `security_metrics_1h` | `E_REQ`,`E_ERR` | request, error | 60 s | 1h | Auth failure spike | Threat summary |
| Traces card | same | `analytics.traces` | `trace_metrics_5m` | `E_TRC` | trace | 30 s | 5m | — | — |
| Navigation grid | static | — | — | — | — | — | — | — | — |

## 3. `/dashboards/executive`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hero: API calls | `GET /analytics/v2/executive` | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | Traffic drop | Traffic trend |
| Hero: error rate | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | High error rate | Error trend |
| Hero: P95 | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | High latency | Latency trend |
| Hero: availability | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | Availability SLO | — |
| Hero: revenue at risk | same | `analytics.endpoints` | `endpoint_metrics_5m` | `E_REQ` | request | 30 s | 5m | Payment path errors | Revenue impact |
| Volume & error correlation | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | — | Correlation narrative |
| Latency percentile lines | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | High latency | Latency regression |
| Service fleet tiles | same | `analytics.services` | `service_metrics_5m` | `E_REQ`,`E_SPN` | request, span | 30 s | 5m | Service error rate | Service summary |
| Top error groups | same | `analytics.errors` | `error_group_metrics_1h` | `E_ERR` | error | 30 s | 1h | New group | Group investigation |
| Slowest endpoints | same | `analytics.endpoints` | `endpoint_metrics_5m` | `E_REQ` | request | 30 s | 5m | Endpoint latency | Slow-path analysis |
| SLO burn-down (new) | same | `analytics.slo` | `slo_metrics_5m` | `service_metrics_1m` | derived | 60 s | 5m | Fast/slow burn | Budget forecast |
| Apdex trend (new) | same | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | Apdex breach | — |
| Top movers (new) | same | multiple (read-side diff) | any `*_5m` | various | various | 30 s | 5m | — | Change explanation |
| Footer: unique groups / affected users / avg latency / services | same | `analytics.errors`,`analytics.requests`,`analytics.services` | `error_metrics_5m`,`request_metrics_5m`,`service_metrics_5m` | `E_ERR`,`E_REQ` | error, request | 30 s | 5m | — | — |

## 4. `/dashboards/performance`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Regression banner | `GET /analytics/v2/performance/by-dimension?dimension=release` | `analytics.releases` | `release_comparison` | `E_REQ`,`E_ERR` | request, error | 60 s | 1h | Latency regression | Rollback advice |
| Hero P50–P99 | `GET /analytics/v2/requests/summary` | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | High latency | Latency trend |
| Latency heatmap | `GET /analytics/v2/requests/latency-histogram` | `analytics.requests` | `request_metrics_5m` (`latency_hist`) | `E_REQ` | request | 30 s | 5m | — | Distribution shift |
| By route tab | `GET /analytics/v2/endpoints` | `analytics.endpoints` | `endpoint_metrics_5m` | `E_REQ` | request | 30 s | 5m | Endpoint latency | Slow-path analysis |
| By service tab | `GET /analytics/v2/performance/by-dimension?dimension=service` | `analytics.services` | `service_metrics_5m` | `E_REQ` | request | 30 s | 5m | Service latency | — |
| By release tab | `…?dimension=release` | `analytics.releases` | `release_metrics_1h` | `E_REQ`,`E_ERR` | request, error | 60 s | 1h | Latency regression | Release verdict |
| By status tab | `…?dimension=status_class` | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | — | — |
| Dependency latency | `GET /analytics/v2/performance/dependencies` | `analytics.spans` | `dependency_metrics_1h`, `db_metrics_1h` | `E_SPN` | span | 60 s | 1h | Dependency latency | Dependency analysis |
| Self-time attribution (new) | `GET /analytics/v2/spans/operations` | `analytics.spans` | `span_metrics_1m` | `E_SPN` | span | 30 s | 1m | — | Bottleneck analysis |
| Saturation vs latency (new) | `GET /analytics/v2/requests/series` | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | — | Capacity advice |
| Slow request list | `GET /analytics/v2/performance/slow-requests` | — (raw keyset) | — | `E_REQ` | request | 15 s | raw | — | Per-request analysis |
| Cold start vs warm | gated by `capabilities.coldStart` | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | — | — |

## 5. `/dashboards/errors` (analytical) and `/observability/errors` (triage)

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hero: total errors / groups / users / resolved | `GET /analytics/v2/errors/summary` | `analytics.errors` | `error_metrics_5m` | `E_ERR` | error | 30 s | 5m | High error rate | Error trend |
| Mechanism donut | `GET /analytics/v2/errors/dimensions?dimension=mechanism` | `analytics.errors` | `error_dimension_metrics_1h` | `E_ERR` | error | 60 s | 1h | — | Mechanism insight |
| Impact by service | `…?dimension=service` | `analytics.errors` | `error_dimension_metrics_1h` | `E_ERR` | error | 60 s | 1h | Service error rate | Service impact |
| Regression detector (new) | `GET /analytics/v2/errors/regressions` | `analytics.errors` | `error_group_metrics_1h` | `E_ERR` | error | 60 s | 1h | Regression alert | Regression root cause |
| New-in-release groups (new) | `GET /analytics/v2/releases/:r/new-errors` | `analytics.releases` | `release_metrics_1h` | `E_ERR` | error | 60 s | 1h | New group in release | Release verdict |
| Crash-free session rate (new) | `GET /analytics/v2/sessions/summary` | `analytics.sessions` | `session_metrics_1h` | `E_REQ`,`E_ERR` | request, error | 60 s | 1h | Crash-free SLO | Stability summary |
| Triage queue / group list | `GET /analytics/v2/errors/groups` | `analytics.errors` | `error_group_metrics_1h` + `analytics_error_groups` | `E_ERR` | error | 30 s | 1h | New group | Group investigation |
| Group detail + occurrences | `GET /analytics/v2/errors/groups/:fp` | `analytics.errors` | `analytics_error_groups` + raw | `E_ERR` | error | 30 s | 1h/raw | — | Stack analysis |
| Resolve / ignore action | `PATCH /analytics/v2/errors/groups/:fp` | `analytics.errors` (state table) | `analytics_error_groups` | — | — | on demand | — | — | — |

## 6. `/dashboards/geo`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DAU / MAU / ratio | `GET /analytics/v2/sessions/summary` | `analytics.sessions` | `user_metrics_1d` | `E_REQ` | request | 300 s | 1d | — | Engagement summary |
| Countries choropleth + table | `GET /analytics/v2/geo/countries` | `analytics.geo` | `geo_metrics_1h` | `E_REQ` | request | 60 s | 1h | Geo anomaly | Geo distribution |
| Latency by region (new) | same | `analytics.geo` | `geo_metrics_1h` | `E_REQ` | request | 60 s | 1h | Regional latency | Regional analysis |
| Browser / OS / device | `GET /analytics/v2/geo/devices` | `analytics.geo` | `device_metrics_1h` | `E_REQ` | request | 60 s | 1h | — | Client insight |
| Device error-rate compare (new) | same | `analytics.geo` | `device_metrics_1h` | `E_REQ` | request | 60 s | 1h | Client error spike | Client failure analysis |
| Tenant distribution | `GET /analytics/v2/geo/countries?groupBy=tenant` | `analytics.requests` | `request_metrics_1h` | `E_REQ` | request | 60 s | 1h | — | Tenant insight |
| Adoption funnel | `GET /analytics/v2/sdk/adoption` | `analytics.sdk` | `sdk_metrics_1h` | all `events_*` | all | 300 s | 1h | — | Adoption advice |

## 7. `/dashboards/realtime`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Requests/min, live rate | `GET /analytics/v2/requests/series?window=1m` | `analytics.requests` | `request_metrics_1m` | `E_REQ` | request | 5 s | 1m | Traffic spike/drop | Live traffic narrative |
| 429/min | same | `analytics.requests` | `request_metrics_1m` | `E_REQ` | request | 5 s | 1m | Rate-limit spike | Abuse detection |
| Live errors | `GET /analytics/v2/errors/series?window=1m` | `analytics.errors` | `error_metrics_1m` | `E_ERR` | error | 5 s | 1m | Error spike | Live error narrative |
| Status donut | `GET /analytics/v2/requests/status-distribution?window=1m` | `analytics.requests` | `request_metrics_1m` | `E_REQ` | request | 5 s | 1m | — | — |
| Per-signal ingestion saturation (replaces fake gauge) | `GET /analytics/v2/ingestion/health` | `analytics.usage` | `ingest_health_metrics_5m` | `E_*`,`ingestion_failures` | all | 30 s | 5m | Ingestion rejection spike | Ingestion advice |
| Top routes now | `GET /analytics/v2/endpoints?window=1m` | `analytics.endpoints` | `endpoint_metrics_1m` | `E_REQ` | request | 5 s | 1m | Endpoint error rate | Hot-path analysis |
| Live traffic tail | `GET /analytics/v2/requests/events` | — (raw keyset) | — | `E_REQ` | request | 5 s | raw | — | Per-request analysis |
| Error stream | `GET /analytics/v2/errors/events` | — (raw keyset) | — | `E_ERR` | error | 5 s | raw | — | Per-error analysis |

## 8. `/dashboards/tracing`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Traces / spans / error traces / partial | `GET /analytics/v2/traces/summary` | `analytics.traces` | `trace_metrics_5m` | `E_TRC` | trace | 30 s | 5m | Partial-trace spike | Trace health |
| Service map (new real graph) | `GET /analytics/v2/traces/service-map` | `analytics.traces` | `trace_edge_metrics_1h` | `E_SPN`,`E_TRC` | span, trace | 60 s | 1h | Edge error rate | Topology analysis |
| Trace list | `GET /analytics/v2/traces` | — (raw keyset) | — | `E_TRC` | trace | 15 s | raw | — | Trace investigation |
| External dependency P95 | `GET /analytics/v2/performance/dependencies` | `analytics.spans` | `dependency_metrics_1h` | `E_SPN` | span | 60 s | 1h | Dependency latency | Dependency analysis |
| Trace error rate by service | `GET /analytics/v2/spans/operations?groupBy=service` | `analytics.spans` | `span_metrics_1m` | `E_SPN` | span | 30 s | 1m | Span error rate | — |
| DB query performance | `GET /analytics/v2/spans/databases` | `analytics.spans` | `db_metrics_1h` | `E_SPN` | span | 60 s | 1h | Slow query | Query optimisation |
| Critical path (new) | `GET /analytics/v2/traces/:id` | `analytics.traces` | `trace_metrics_1m` | `E_TRC`,`E_SPN` | trace, span | on demand | 1m | — | Critical-path analysis |

## 9. `/dashboards/infrastructure` (tenant-relevant only)

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cost / 1M requests, infra spend, projected cost | `GET /analytics/v2/cost/summary` | `analytics.usage` | `cost_metrics_1d` | all `events_*` | all | 300 s | 1d | Cost spike | Cost optimisation |
| Billable volume per signal | `GET /analytics/v2/usage/signals` | `analytics.usage` | `usage_metrics_1d` | all `events_*` | all | 300 s | 1d | Quota threshold | Usage forecast |
| Ingest lag + queue health | `GET /analytics/v2/ingestion/health` | `analytics.usage` | `ingest_health_metrics_5m` | `E_*`,`ingestion_failures` | all | 30 s | 5m | Ingest lag | Pipeline advice |
| Storage growth projection | `GET /analytics/v2/usage/signals?projection=true` | `analytics.usage` | `usage_metrics_1d` | all `events_*` | all | 300 s | 1d | Retention pressure | Retention advice |

## 10. `/dashboards/security`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hero (auth failures, 429s, suspicious IPs, JWT anomalies, sensitive accesses) | `GET /analytics/v2/security/summary` | `analytics.security` | `security_metrics_1h` | `E_REQ`,`E_ERR` | request, error | 60 s | 1h | Auth failure spike | Threat summary |
| Security score gauge | same | `analytics.security` | `security_metrics_1h` | `E_REQ`,`E_ERR` | request, error | 60 s | 1h | Score drop | Posture advice |
| 401 vs 403 over time | `GET /analytics/v2/requests/series?metrics=auth_failures` | `analytics.requests` | `request_metrics_5m` | `E_REQ` | request | 30 s | 5m | Auth failure spike | — |
| Top offenders by IP hash | `GET /analytics/v2/security/top-offenders` | `analytics.security` | `security_metrics_1h` | `E_REQ` | request | 60 s | 1h | Brute force | Block recommendation |
| Sensitive endpoint access | `GET /analytics/v2/security/sensitive-access` | `analytics.security` | `security_metrics_1h` | `E_REQ` | request | 60 s | 1h | Sensitive access spike | Access review |
| API-key abuse | `GET /analytics/v2/usage/api-keys` | `analytics.usage` | `usage_metrics_1d` | `E_REQ` | request | 300 s | 1d | Key anomaly | Key rotation advice |

## 11. `/dashboards/releases` and `/insights/releases`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Release comparison table | `GET /analytics/v2/releases/:r/comparison` | `analytics.releases` | `release_comparison`, `release_metrics_1h` | `E_REQ`,`E_ERR` | request, error | 60 s | 1h | Release regression | Rollback advice |
| Adoption curve (new) | `GET /analytics/v2/releases` | `analytics.releases` | `release_metrics_1h` | `E_REQ` | request | 60 s | 1h | — | Adoption insight |
| New error types | `GET /analytics/v2/releases/:r/new-errors` | `analytics.releases` | `release_metrics_1h` | `E_ERR` | error | 60 s | 1h | New group in release | Regression analysis |
| Crash-free sessions | `GET /analytics/v2/sessions/summary` | `analytics.sessions` | `session_metrics_1h` | `E_REQ`,`E_ERR` | request, error | 60 s | 1h | Crash-free SLO | Stability summary |
| Automatic verdict (new) | `GET /analytics/v2/releases/:r/comparison` | `analytics.releases` | `release_comparison` | `E_REQ`,`E_ERR` | request, error | 60 s | 1h | Release regression | Rollback advice |
| DORA metrics | gated by `capabilities.deployments` | future `analytics.deployments` | future `deployment_metrics_1d` | future `events_deployments` | deployment | 300 s | 1d | Deploy failure | Delivery insight |

## 12. `/dashboards/business`

| Widget | API | Worker | Rollup | Source | Event types | Refresh | Window | Alerts | AI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Billable API calls | `GET /analytics/v2/usage/signals` | `analytics.usage` | `usage_metrics_1d` | all `events_*` | all | 300 s | 1d | Quota threshold | Usage forecast |
| 4xx / 5xx rate | `GET /analytics/v2/requests/summary` | `analytics.requests` | `request_metrics_1d` | `E_REQ` | request | 300 s | 1d | High error rate | DX friction insight |
| Endpoint adoption + lifecycle | `GET /analytics/v2/endpoints` | `analytics.endpoints` | `endpoint_metrics_1d` | `E_REQ` | request | 300 s | 1d | — | Deprecation advice |
| 4xx vs 5xx 14-day stack | `GET /analytics/v2/requests/series?window=1d` | `analytics.requests` | `request_metrics_1d` | `E_REQ` | request | 300 s | 1d | — | — |
| Time-to-first-200 funnel | `GET /analytics/v2/sdk/adoption?funnel=true` | `analytics.sdk` | `sdk_metrics_1h` | all `events_*` | all | 300 s | 1h | — | Onboarding advice |

## 13. `/observability/*`

| Surface | Widget group | API | Worker | Rollup | Source | Refresh | Window |
| --- | --- | --- | --- | --- | --- | --- | --- |
| requests | KPI cards | `/v2/requests/summary` | `analytics.requests` | `request_metrics_5m` | `E_REQ` | 30 s | 5m |
| requests | table | `/v2/requests/events` | — | raw | `E_REQ` | 15 s | raw |
| requests/:id | detail | `/v2/requests/events/:id` | — | raw | `E_REQ`,`E_SPN`,`E_ERR`,`E_LOG` | on demand | raw |
| events | per-type counts | `/v2/overview?breakdown=signal` | `analytics.usage` | `usage_metrics_1d` | all | 60 s | 1d |
| events | table | `/v2/requests/events`, `/v2/errors/events`, `/v2/logs/events`, … (per-type, parallel) | — | raw | per-type | 15 s | raw |
| errors | see §5 | — | — | — | — | — | — |
| latency | P50–P99 cards | `/v2/requests/summary` | `analytics.requests` | `request_metrics_5m` | `E_REQ` | 30 s | 5m |
| latency | slowest list | `/v2/performance/slow-requests` | — | raw | `E_REQ` | 15 s | raw |
| traces | KPIs + list | `/v2/traces/summary`, `/v2/traces` | `analytics.traces` | `trace_metrics_5m` | `E_TRC` | 30 s | 5m/raw |
| traces/:id | waterfall | `/v2/traces/:id` | `analytics.traces` | — | `E_TRC`,`E_SPN` | on demand | raw |
| logs | levels + list | `/v2/logs/summary`, `/v2/logs/events` | `analytics.logs` | `log_metrics_5m` | `E_LOG` | 15 s | 5m/raw |
| logs | noisy loggers (new) | `/v2/logs/loggers` | `analytics.logs` | `logger_metrics_1h` | `E_LOG` | 60 s | 1h |
| metrics | catalogue | `/v2/metrics/series-catalogue` | `analytics.metrics` | `metric_series_1h` | `E_MET` | 60 s | 1h |
| metrics | series | `/v2/metrics/:name/series` | `analytics.metrics` | `metric_series_1m` | `E_MET` | 30 s | 1m |
| profiling | KPIs + list | `/v2/profiles/summary`, `/v2/profiles` | `analytics.profiles` | `profile_metrics_1h` | `E_PRF` | 300 s | 1h |
| profiling | hot functions (new) | `/v2/profiles/hot-functions` | `analytics.profiles` | `profile_function_metrics_1h` | `E_PRF` | 300 s | 1h |
| crons | KPIs | `/v2/crons/summary` | `analytics.crons` | `cron_metrics_1h` | `E_CRN` | 60 s | 1h |
| crons | monitor board (new) | `/v2/crons/monitors` | `analytics.crons` | `cron_monitor_state` | `E_CRN` | 60 s | state |
| crons | check-in list | `/v2/crons/checkins` | — | raw | `E_CRN` | 30 s | raw |
| replay | KPIs + list | `/v2/replays/summary`, `/v2/replays` | `analytics.replays` | `replay_metrics_1h` | `E_RPL` | 300 s | 1h |
| runtime (memory tab) | cards, series, table | `/v2/runtime/memory` | `analytics.runtime` | `runtime_metrics_1m/1h` | `E_MET` | 30 s | 1m/1h |
| runtime (event-loop tab) | cards, series, table | `/v2/runtime/event-loop` | `analytics.runtime` | `runtime_metrics_1m/1h` | `E_MET` | 30 s | 1m/1h |
| runtime (gc tab) | cards, by-type, table | `/v2/runtime/gc` | `analytics.runtime` | `gc_metrics_1m/1h` | `E_MET` | 30 s | 1m/1h |
| service-health | cards + service grid | `/v2/services` | `analytics.services` | `service_metrics_5m` | `E_REQ`,`E_SPN` | 60 s | 5m |

## 14. `/services/*`, project scope, cross-module

| Surface | Widget | API | Worker | Rollup | Source | Refresh | Window |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/services` | catalog | `/v2/services` | `analytics.services` | `service_metrics_5m/1h` | `E_REQ`,`E_SPN` | 60 s | 5m |
| `/services/dependencies` | graph | `/v2/services/dependencies` | `analytics.spans`,`analytics.traces` | `dependency_metrics_1h`,`trace_edge_metrics_1h` | `E_SPN`,`E_TRC` | 60 s | 1h |
| `/services/slos` | SLO table | `/v2/slos` | `analytics.slo` | `slo_metrics_5m` | `service_metrics_1m` | 60 s | 5m |
| project `overview` | cards + series + tops | `/v2/projects/:id/overview` | requests, errors, endpoints | `*_5m` | `E_REQ`,`E_ERR` | 30 s | 5m |
| project `analytics` | full analytics | `/v2/projects/:id/overview` + drill-downs | multiple | `*_5m/1h` | multiple | 30 s | 5m |
| project `usage` | per-signal daily | `/v2/usage/signals` | `analytics.usage` | `usage_metrics_1d` | all | 300 s | 1d |
| `/billing/usage` | billable volume | `/v2/usage/signals` | `analytics.usage` | `usage_metrics_1d` | all | 300 s | 1d |
| `/alerts/metrics` | alert KPIs + per-rule table | `/v2/alerts/metrics` | `analytics.alerts` | `alert_metrics_1h` | `alert_events`,`alert_delivery_attempts`,`alert_acknowledgments` | 60 s | 1h |
| `/ai/usage`, `/ai` | AI KPIs | `/v2/ai/usage` | `analytics.ai` | `ai_metrics_1h` | `ai_requests`,`ai_responses`,`ai_usage_receipts` | 300 s | 1h |
| `/ingestion/health` | accepted/rejected/dropped | `/v2/ingestion/health` | `analytics.usage` | `ingest_health_metrics_5m` | `E_*`,`ingestion_failures` | 30 s | 5m |
| `/ingestion/endpoints` | endpoint catalog | `/v2/endpoints` | `analytics.endpoints` | `endpoint_metrics_1h` | `E_REQ` | 60 s | 1h |
| `/ingestion/rate-limits` | per-key consumption | `/v2/usage/api-keys` | `analytics.usage` | `usage_metrics_1d` | `E_REQ` | 300 s | 1d |
| `/insights/anomalies` | anomaly feed | `/v2/anomalies` | `analytics.anomalies` | `anomaly_detections` | `*_1h` rollups | 300 s | 1h |
| `/insights/root-cause` | correlated timeline | `/v2/anomalies?correlate=true` | `analytics.anomalies` | `anomaly_detections` + rollups | multiple | on demand | 1h |

## 15. Matrix invariants (enforced by tests)

1. Every widget in `01-frontend-dashboard-audit.md` §2 appears in exactly one row
   here.
2. Every `Rollup Table` value exists in `07-rollup-tables.md` §2/§3.
3. Every `Analytics Worker` value exists in `06-worker-architecture.md` §3.
4. Every `API` value exists in `08-dashboard-api-contracts.md` §3.
5. Every `Metric` referenced by a widget exists in `10-analytics-catalog.md`.
6. Rows whose worker is `—` are raw-detail reads (single typed table, keyset
   paginated, no aggregation) — the only permitted non-rollup reads.

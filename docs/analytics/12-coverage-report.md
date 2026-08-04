# Phase 19 — Analytics Coverage Report

Every issue below was observed in code, not inferred. Priority: **P0** blocks the
analytics engine, **P1** ships in the first implementation wave, **P2** follows,
**P3** is backlog.

---

## 1. Frontend widgets without analytics backing

| # | Widget / surface | Current state | Recommended fix | Priority | Expected impact |
| --- | --- | --- | --- | --- | --- |
| 1 | Every time-series chart in the product (11 dashboards + 4 observe pages) | `seededSeries()` fabricates the data | serve `MetricSeries` from `*_metrics_*` | P0 | dashboards become truthful |
| 2 | All latency percentiles | computed client-side over ≤150 fixture rows | rollup percentile columns + histogram | P0 | correct tail latency at scale |
| 3 | Geo distribution | `COUNTRY_WEIGHTS` + `hashJitter()` + `countryForIp()` | `geo_metrics_1h` from `geo_country_code` | P0 | real geography |
| 4 | Browser / OS breakdown | regex over `user_agent` in the browser | `device_metrics_1h` | P1 | correct client mix |
| 5 | Service fleet health | `99.9 − i*0.6` per index | `service_metrics_5m` + `health_score` | P0 | real service health |
| 6 | Release comparison table | hardcoded `COMPARISON` array | `release_comparison` | P1 | real release verdicts |
| 7 | DORA metrics | hardcoded strings | needs a deployments signal | P3 | gated until the signal exists |
| 8 | Infra cost / spend / forecast | `infraCost = 504` | `cost_metrics_1d` | P2 | real unit economics |
| 9 | DB pool / cache / CPU | hardcoded | move to internal ops dashboard | P2 | removes misleading tenant data |
| 10 | Queue depth & lag | hardcoded `QUEUES` | `ingest_health_metrics_5m` + `ingestion_queue_snapshot` | P1 | real pipeline visibility |
| 11 | Active connections gauge | hardcoded `CONN_LIMITS` | per-signal ingestion saturation | P1 | real rate-limit headroom |
| 12 | Security score, JWT anomalies, sensitive access | `Math.random()` + hardcoded paths | `security_metrics_1h` | P1 | real threat posture |
| 13 | Regression banners (3 pages) | hardcoded copy | `errors.regression_score`, `release_comparison` | P1 | actionable regressions |
| 14 | "Unresolved" error count | `Math.round(groups.length * 0.7)` | `analytics_error_groups` count | P0 | correct triage backlog |
| 15 | Throughput card on `/observability/requests` | `total * 3` | `requests.rate` | P0 | correct throughput |
| 16 | Uptime 30d / open incidents / apdex on service-health | hardcoded `"99.94%"`, `"3"`, `"0.96"` | `service_metrics_1d`, `alert_metrics_1h`, `requests.apdex` | P1 | real SLO view |
| 17 | Readiness checks + dependency map placeholder | hardcoded `DEPENDENCIES` + "renders here" text | delete; use `/services/dependencies` | P1 | removes stub UI |
| 18 | Adoption funnel + time-to-first-200 | hardcoded stage values | `sdk_metrics_1h` funnel | P2 | real onboarding metrics |
| 19 | Tenant distribution | client `groupBy(tenantId)` over fixtures | `request_metrics_1h` grouped by tenant | P2 | real tenant analytics |
| 20 | Cold start vs warm | fabricated stacked bars | capability-gated | P3 | honest absence |

## 2. Analytics workers without consumers

| Worker | Status | Action |
| --- | --- | --- |
| `analytics.rollup-hourly` (existing) | writes `analytics_hourly_rollup`, which **no API reads** | freeze after the new engine ships; remove the job in the cleanup wave |
| `analytics.error-grouping` (existing) | writes `analytics_error_groups`, which the v1 API does read | superseded by `analytics.errors`; keep the table, retire the job |
| `analytics.partition-maintain` (existing) | calls `create_event_partitions(7)`, a function absent from the migration tree | replace with `analytics_engine_ensure_partitions` |

## 3. Unused rollup tables (created, never written)

`analytics_daily_rollup`, `analytics_performance_summary`,
`analytics_endpoint_minute/hourly/daily`, `analytics_service_minute/hourly/daily`,
`analytics_trace_latency`, `analytics_error_occurrences`,
`analytics_error_regressions`, `analytics_geo_hourly_rollup`,
`analytics_user_sessions`, `analytics_trace_service_edges`, `analytics_alerts`.

Action: freeze (no reads, no writes) and record in the roadmap as a
human-approved drop. `analytics_user_sessions` and `analytics_trace_service_edges`
are re-owned by the new engine instead of being dropped.

## 4. Duplicate metrics / definitions

| Duplicate | Fix | Priority |
| --- | --- | --- |
| `percentile()` defined twice on the client | delete both | P0 |
| Error rate defined with `>=500` in some places and `>=400` in others | catalog splits `error_rate` (5xx) and `client_error_rate` (4xx) | P0 |
| Volume multipliers `×1240`, `×240`, `×14`, `×3`, `÷12` across 7 files | single `requests.total` | P0 |
| Health score in `DashboardsOverview` vs security score in `SecurityThreat` | catalog `health.score`, `security.score` | P1 |
| `getRequestOverview` vs `getDashboard.requests` in the v1 backend | one v2 summary shape | P1 |
| `analytics_error_groups.occurrence_count` vs `total_count` | `total_count` canonical, other deprecated | P1 |
| Generic EAV rollups vs typed rollups | typed canonical | P1 |
| `analytics_alerts` vs alerting module rules | freeze `analytics_alerts` | P2 |

## 5. Duplicate workers

| Duplication | Fix |
| --- | --- |
| `event-analytics` module registers "analytics" workers in the **shared** worker process while the new engine has its own process | keep the new engine's process authoritative; remove the three legacy jobs from `src/shared/workers/main.ts` in the cleanup wave (documented, not silently) |
| Error grouping exists in both `EventAnalyticsRepository.refreshErrorGroups` and the new `analytics.errors` worker | new worker is authoritative |

## 6. Expensive calculations to eliminate

| Calculation | Where | Cost today | After |
| --- | --- | --- | --- |
| 10-table `UNION ALL` for the unified event list | `src/modules/analytics/repository.ts` `UNIFIED_EVENTS_SQL` | full scan of 10 partitioned tables per list request | per-type keyset query |
| `PERCENTILE_CONT` per dashboard call | same file, `getRequestOverview`, `getDashboard` | sorts every matching row | precomputed columns |
| 5 parallel aggregate queries per dashboard load | `getDashboard` | 5 concurrent scans | 1 indexed rollup read |
| `COUNT(*)` for error-group pagination totals | `listErrorGroups` | full count per page | rollup `total` |
| 24 h full re-scan per org for error grouping | `refreshErrorGroups(orgId, 24)` | repeated work every 5 min | watermark-bounded incremental |
| Client-side `groupBy` over every row | 9 dashboard pages | O(n) per render | server `GROUP BY` |
| `payload::text ILIKE '%q%'` search | `listEvents` | unindexable full scan | `log_search_index` / trigram-backed `q` |

## 7. Missing metrics

| Metric | Needed by | Blocker | Priority |
| --- | --- | --- | --- |
| `requests.apdex` | executive, service health | none — computable now | P1 |
| `sessions.crash_free_rate` | errors, releases | needs `analytics.sessions` | P1 |
| `slo.*` | `/services/slos`, executive | needs SLO definitions in the control plane | P1 |
| `traces.critical_path_p95` | tracing | span-tree walk | P2 |
| `spans.self_time_p95` | performance | `exclusive_duration_ms` already present | P1 |
| `usage.rate_limit_consumption` | `/ingestion/rate-limits` | needs per-key limits from the control plane | P2 |
| `ingestion.lag_p95` | ingestion health | none | P1 |
| `metrics.series_cardinality` | metrics page | none | P2 |
| `deployments.*` (DORA) | releases | needs a new ingest signal | P3 |
| platform self-metrics (pool, cache, CPU) | internal ops | needs a `prom-client` scrape store | P3 |

## 8. Missing rollups

Every table in `07-rollup-tables.md` §2 except `analytics_error_groups`,
`analytics_user_sessions`, and `analytics_trace_service_edges` does not exist yet.
That is 32 new tables × window tiers. Priority: P0 for requests / endpoints /
services / errors / logs / traces / spans; P1 for the rest.

## 9. Missing APIs

All 60+ routes in `08-dashboard-api-contracts.md` §3. Existing v1 coverage is 7
routes (`events`, `events/:id`, `requests/overview`, `dashboard`,
`error-groups`, `error-groups/:fp` PATCH + resolve, `health`) — roughly 10 % of
the required surface, and all of them aggregate raw telemetry.

## 10. Missing indexes

| Index | Table | Reason | Priority |
| --- | --- | --- | --- |
| `(organization_id, project_id, environment, ingested_at)` | all 10 `events_*` | watermark scans | P0 |
| `(organization_id, project_id, geo_country_code, timestamp DESC)` | `events_requests` | geo rollups | P1 |
| `(organization_id, project_id, release, timestamp DESC)` | `events_requests`, `events_errors` | release rollups | P1 |
| `(organization_id, project_id, db_system, timestamp DESC) WHERE db_system IS NOT NULL` | `events_spans` | DB analytics | P1 |
| `(organization_id, project_id, http_host, timestamp DESC) WHERE http_host IS NOT NULL` | `events_spans` | dependency analytics | P1 |
| `(organization_id, project_id, session_id, timestamp DESC) WHERE session_id IS NOT NULL` | `events_requests` | session reconstruction | P1 |
| `(organization_id, project_id, sdk_name, sdk_version, timestamp DESC)` | `events_requests` | SDK adoption | P2 |
| real range partitions (not just `_default`) | all partitioned tables | scan pruning + retention | P0 |

## 11. Missing charts

| Chart | Surface | Priority |
| --- | --- | --- |
| Real latency histogram / heatmap | performance | P1 |
| SLO burn-down | executive, SLOs | P1 |
| Service dependency graph with edge metrics | tracing, services | P1 |
| Release adoption curve | releases | P2 |
| Log volume by level over time | logs | P1 |
| Anomaly timeline | insights | P2 |
| Saturation vs latency scatter | performance | P2 |
| Ingest lag trend | ingestion health | P1 |

## 12. Missing AI integrations

| Integration | Gap | Fix | Priority |
| --- | --- | --- | --- |
| Widget-level `aiContext` | prompts are string-built inside table cells on 12 pages | server-provided `aiContext` per card/row | P1 |
| Anomaly → root cause | no anomaly store | `anomaly_detections` + correlate endpoint | P2 |
| Release verdict → rollback advice | no comparison data | `release_comparison` | P2 |
| Error group → investigation | exists via `/ai/investigations` but with client-built context | pass `aiContext` from the group payload | P1 |
| Budget forecast | no SLO data | `slo_metrics_5m` | P2 |

## 13. Missing alert integrations

| Alert | Gap | Priority |
| --- | --- | --- |
| Metric-key-driven rules | alerting rules are not expressed in catalog metric keys | P1 |
| "Create alert from widget" action | not implemented anywhere | P2 |
| SLO fast/slow burn | no SLO metrics | P1 |
| Missed cron run | no monitor state | P1 |
| Ingestion rejection spike | no ingest health rollup | P1 |
| Traffic drop (inverse threshold) | not supported by the rule model | P2 |

## 14. Coverage scorecard (before → after this plan)

| Dimension | Before | After |
| --- | --- | --- |
| Widgets backed by real data | ~8 % (project analytics + alerting + billing surfaces only) | 100 % of non-gated widgets |
| Widgets backed by precomputed rollups | 0 % | 100 % of aggregate widgets |
| Dashboards performing client aggregation | 15 surfaces | 0 |
| Analytics workers | 3 (one process, shared with everything else) | 26 (dedicated process) |
| Rollup tables written | 2 of 18 existing | 32 new + 3 re-owned |
| API routes | 7 | 60+ |
| Metrics with a single definition | 0 documented | 120+ catalogued |
| Fabricated data sites | 15 files | 0 |

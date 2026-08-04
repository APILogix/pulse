# Phase 11 — Dashboard API Contracts

Base path: `/analytics/v2`. All routes require `authenticate`; project-scoped
routes additionally require `requireProjectMembership` (the same middleware the
v1 analytics module uses). The v1 `/analytics/*` routes stay in place until the
frontend migration completes, then are removed.

Every response uses the envelope defined in
`01-frontend-dashboard-audit.md` §3.2. Every payload is render-ready: no client
joins, no client aggregation, no client sorting.

---

## 1. Shared query parameters

```
projectId?  uuid          (path for project routes)
environment string        default "all"
from        ISO-8601      required (or `range=15m|1h|6h|24h|7d|30d`)
to          ISO-8601      required when `from` is given
window?     1m|5m|1h|1d   default: auto from span
compare?    none|previous default previous
service?    string
release?    string
limit?      1..200        default 20
cursor?     string
sort?       <col>:<dir>   allowlisted per route
q?          string        server-side search
format?     json|csv      default json
```

## 2. Card / series / table primitives

```ts
interface MetricCard {
  key: string;               // catalog metric key
  label: string;
  value: number | null;
  formatted: string;         // "1.2M", "412 ms", "0.53 %"
  unit: 'count'|'ms'|'percent'|'bytes'|'micros'|'score';
  delta: number | null;
  deltaPct: number | null;
  trend: 'up' | 'down' | 'flat';
  direction: 'higher_is_better' | 'lower_is_better' | 'neutral';
  sparkline: number[] | null;
  aiContext: string;
}

interface MetricSeries {
  key: string;
  label: string;
  unit: MetricCard['unit'];
  window: WindowSize;
  points: Array<{ t: string; v: number | null }>;  // zero-filled, ascending
}

interface RankedList {
  key: string;
  label: string;
  total: number;
  items: Array<{
    key: string; label: string; value: number; formatted: string;
    secondary?: string; severity?: 'ok'|'warn'|'critical'; href?: string;
  }>;
}

interface DataTable {
  key: string;
  columns: Array<{ key: string; label: string; align: 'left'|'right'; format: string; sortable: boolean }>;
  rows: Array<Record<string, unknown>>;
  total: number;
  sort: { column: string; direction: 'asc'|'desc' };
}
```

## 3. Route catalogue

### 3.1 Overview / executive
| Route | Serves | Payload |
| --- | --- | --- |
| `GET /analytics/v2/overview` | `/` global dashboard, `/dashboards/overview` | `cards[9]`, `series{requests,errors}`, `topErrorGroups`, `topSlowEndpoints`, `services[]` |
| `GET /analytics/v2/executive` | `/dashboards/executive` | `hero[5]`, `series{volume,errors,latencyPercentiles[5]}`, `services[]`, `topErrorGroups`, `topSlowEndpoints`, `footer[4]`, `sloBurn[]`, `topMovers[]` |
| `GET /analytics/v2/projects/:projectId/overview` | project overview | project-scoped version of `overview` |
| `GET /analytics/v2/projects/health` | project lists | `items[]` from `project_health_5m` |

### 3.2 Requests / performance
| Route | Payload |
| --- | --- |
| `GET /analytics/v2/requests/summary` | `cards[]` (total, error rate, 4xx, latency p50/p95/p99, apdex, throughput, bytes) |
| `GET /analytics/v2/requests/series` | `series[]` for any subset via `metrics=total,errors,p95` |
| `GET /analytics/v2/requests/status-distribution` | `distribution[{class,count,pct}]` |
| `GET /analytics/v2/requests/latency-histogram` | `buckets[{fromMs,toMs,count,pct}]` + `heatmap{rows[],columns[]}` |
| `GET /analytics/v2/requests/events` | keyset list from `events_requests` (raw detail, not aggregation) |
| `GET /analytics/v2/requests/events/:requestId` | single request + correlated trace/error/log ids |
| `GET /analytics/v2/endpoints` | `DataTable` (route, method, count, err%, p50…p99, bytes, users, lifecycle) |
| `GET /analytics/v2/endpoints/slowest` | `RankedList` by p95 |
| `GET /analytics/v2/performance/by-dimension` | `dimension=route|service|method|release|status_class` → `DataTable` |
| `GET /analytics/v2/performance/dependencies` | `RankedList` from `dependency_metrics_1h` + `db_metrics_1h` |
| `GET /analytics/v2/performance/slow-requests` | keyset list of requests above the window p95 |

### 3.3 Errors
| Route | Payload |
| --- | --- |
| `GET /analytics/v2/errors/summary` | `cards[]` (total, groups, unresolved, affected users, resolved today, crash-free rate) |
| `GET /analytics/v2/errors/series` | volume by severity |
| `GET /analytics/v2/errors/groups` | `DataTable` + per-row `trend[]`, `regressionScore`, `isNewInRelease`; `sort=lastSeen|count|users|firstSeen`; `status`, `mechanism`, `severity` filters |
| `GET /analytics/v2/errors/groups/:fingerprint` | group detail + occurrence keyset + stack + breadcrumbs |
| `PATCH /analytics/v2/errors/groups/:fingerprint` | resolve / ignore / priority / assign (writes `analytics_error_groups`) |
| `GET /analytics/v2/errors/dimensions` | `dimension=mechanism|severity|service|release|error_name` → `RankedList` |
| `GET /analytics/v2/errors/regressions` | `RankedList` of groups with `regressionScore > threshold` |
| `GET /analytics/v2/errors/events` | keyset list from `events_errors` |

### 3.4 Logs / metrics / runtime
| Route | Payload |
| --- | --- |
| `GET /analytics/v2/logs/summary` | volume by level cards |
| `GET /analytics/v2/logs/series` | stacked series by level |
| `GET /analytics/v2/logs/loggers` | `RankedList` noisy loggers |
| `GET /analytics/v2/logs/events` | keyset list + `q` full-text (uses `log_search_index` when present, else `events_logs`) |
| `GET /analytics/v2/metrics/series-catalogue` | `DataTable` of metric names, types, cardinality, last value |
| `GET /analytics/v2/metrics/:metricName/series` | one series with p50/p95/p99 when available |
| `GET /analytics/v2/runtime/memory` | heap/rss/external/handles cards + series + per-service table |
| `GET /analytics/v2/runtime/event-loop` | lag p50/p95/p99 + utilization cards, series, per-service table |
| `GET /analytics/v2/runtime/gc` | pause cards, by-type distribution, per-service table |

### 3.5 Traces / spans
| Route | Payload |
| --- | --- |
| `GET /analytics/v2/traces/summary` | traces, spans, error traces, partial traces |
| `GET /analytics/v2/traces` | keyset list from `events_traces` |
| `GET /analytics/v2/traces/:traceId` | waterfall (`spans_tree` or reconstructed from `events_spans`) |
| `GET /analytics/v2/traces/service-map` | `nodes[]` + `edges[]` from `trace_edge_metrics_1h` + `service_metrics_*` |
| `GET /analytics/v2/spans/operations` | `DataTable` operation latency + self time |
| `GET /analytics/v2/spans/databases` | `DataTable` from `db_metrics_1h` |

### 3.6 Crons / profiles / replays / sessions
| Route | Payload |
| --- | --- |
| `GET /analytics/v2/crons/summary` | monitors, ok, failing, missed |
| `GET /analytics/v2/crons/monitors` | `DataTable` from `cron_monitor_state` + trend |
| `GET /analytics/v2/crons/checkins` | keyset list from `events_cron_checkins` |
| `GET /analytics/v2/profiles/summary` | profiles, avg duration, samples, services |
| `GET /analytics/v2/profiles` | keyset list + hottest function per profile |
| `GET /analytics/v2/profiles/hot-functions` | `RankedList` from `profile_function_metrics_1h` |
| `GET /analytics/v2/replays/summary` | sessions, segments, events, avg |
| `GET /analytics/v2/replays` | keyset list |
| `GET /analytics/v2/sessions/summary` | sessions, crash-free rate, DAU, MAU, new/returning |

### 3.7 Geo / devices / SDK / releases / security
| Route | Payload |
| --- | --- |
| `GET /analytics/v2/geo/countries` | choropleth `countries[]` + `DataTable` |
| `GET /analytics/v2/geo/devices` | browser / OS / device distributions |
| `GET /analytics/v2/sdk/adoption` | `DataTable` sdk name/version share |
| `GET /analytics/v2/releases` | `DataTable` per release |
| `GET /analytics/v2/releases/:release/comparison` | `release_comparison` row + metric rows + verdict |
| `GET /analytics/v2/releases/:release/new-errors` | `RankedList` |
| `GET /analytics/v2/security/summary` | auth failures, 429s, suspicious IPs, sensitive accesses, score |
| `GET /analytics/v2/security/top-offenders` | `DataTable` by `client_ip_hash` |
| `GET /analytics/v2/security/sensitive-access` | `DataTable` by path |

### 3.8 Services / SLO
| Route | Payload |
| --- | --- |
| `GET /analytics/v2/services` | catalog `DataTable` (health, p95, err%, availability, apdex, owner, release) |
| `GET /analytics/v2/services/:service/summary` | per-service cards + series |
| `GET /analytics/v2/services/dependencies` | dependency graph |
| `GET /analytics/v2/slos` | SLO list with attainment, budget, burn rates |

### 3.9 Usage / cost / ingestion / alerts / AI / anomalies
| Route | Payload |
| --- | --- |
| `GET /analytics/v2/usage/signals` | per-signal daily volume + quota progress |
| `GET /analytics/v2/usage/api-keys` | per-key volume + rate-limit consumption |
| `GET /analytics/v2/cost/summary` | billable events, unit cost, estimated cost, cost per 1M |
| `GET /analytics/v2/ingestion/health` | accepted/rejected/dropped/DLQ + reasons + ingest lag |
| `GET /analytics/v2/alerts/metrics` | triggered, delivered, failed, MTTA, MTTR per rule |
| `GET /analytics/v2/ai/usage` | requests, tokens, credits, cost, cache hit rate per model |
| `GET /analytics/v2/anomalies` | anomaly feed with `context` |
| `GET /analytics/v2/system/health` | worker lag / freshness per domain (authenticated, org-scoped view) |

## 4. Caching

Two layers, both keyed by
`v2:<route>:<orgId>:<projectId>:<environment>:<window>:<bucketedFrom>:<bucketedTo>:<filters>`:
1. Per-process LRU (`src/config/lrucashe.ts`) — TTL = the window's natural
   refresh interval (1m → 15 s, 5m → 60 s, 1h → 300 s, 1d → 900 s).
2. No Redis (stage constraint). Cross-process consistency is unnecessary because
   rollups are immutable once compacted, and `bucketedFrom/To` are floored to the
   window, so all replicas compute the same key.

`from`/`to` are floored to the selected window before key construction — this is
the fix for the v1 problem where an implicit `to = new Date()` made every request
a cache miss (v1 partially mitigates it with a 2-minute floor).

## 5. Error contract

```jsonc
{ "error": { "code": "ANALYTICS_WINDOW_TOO_LARGE", "message": "…",
             "requestId": "…", "timestamp": "…", "details": { "maxDays": 400 } } }
```
| Code | HTTP | Cause |
| --- | --- | --- |
| `INVALID_ENVIRONMENT` | 400 | fails `^[A-Za-z0-9][A-Za-z0-9._-]*$` |
| `INVALID_TIME_RANGE` | 400 | `to <= from`, unparsable, or future `from` |
| `ANALYTICS_WINDOW_TOO_LARGE` | 400 | span exceeds the retention of every window |
| `INVALID_SORT_COLUMN` | 400 | not in the route allowlist |
| `INVALID_CURSOR` | 400 | undecodable keyset cursor |
| `PROJECT_NOT_FOUND` | 404 | membership check passed but project missing |
| `ANALYTICS_NOT_MATERIALISED` | 200 + `meta.freshness.stale` | watermark older than threshold — never an error |
| `ANALYTICS_UNAVAILABLE` | 503 | Log DB unreachable |

## 6. CSV export

`format=csv` streams the same `DataTable` with `Content-Disposition:
attachment; filename="<route>-<from>-<to>.csv"`, generated from the identical
rollup query — no second code path.

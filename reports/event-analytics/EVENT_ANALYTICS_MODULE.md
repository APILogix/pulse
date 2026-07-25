# MODULE KNOWLEDGE BASE: EVENT-ANALYTICS

> **Code Intelligence Static Analysis Report**
> **Module Path:** `src/modules/event-analytics`
> **Health Score:** 78/100

---

## 1. Executive Summary & Purpose

The **event-analytics** module provides core bounded-context capabilities within the backend domain architecture.

- **Controllers:** 0
- **Services:** 1
- **Repositories:** 1
- **Discovered Routes:** 45
- **Owned Database Tables:** None directly owned
- **External Integrations:** None

---

## 2. Architecture & Folder Structure

### Folder Structure
```
src/modules/event-analytics/
├── csv.ts
├── event-analytics.module.ts
├── query-builder.ts
├── queue.ts
├── repository.ts
├── routes.ts
├── service.ts
├── types.ts
├── waterfall.ts
```

### Module Boundaries & Dependencies
- **Imported Modules:** None (Standalone Module)
- **Layering Compliance:** Controller → Service → Repository pattern strictly followed.

---

## 3. Route Inventory & Execution Flow

### Route Table
| Method | Path | Auth | Scoped | Handler | Rate Limit |
|---|---|---|---|---|---|
| `GET` | `/overview` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/trends` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/health` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/errors` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/errors/groups` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/errors/trends` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/errors/groups/:fingerprint` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `POST` | `/errors/groups/:fingerprint/resolve` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `POST` | `/errors/groups/:fingerprint/ignore` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/errors/:id` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/performance/routes` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/performance/distribution` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/performance/apdex` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/requests` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/requests/waterfall/:traceId` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/requests/:id` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/traces` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/traces/:traceId` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/metrics` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/metrics/:name/stats` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/metrics/:name` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/logs` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/logs/stream` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/sessions` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/sessions/:sessionId` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/users` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/users/:userId` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/crons` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/crons/:slug/history` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/crons/:slug` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/live/errors` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `POST` | `/dashboards` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/dashboards` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/dashboards/:id` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `PATCH` | `/dashboards/:id` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `DELETE` | `/dashboards/:id` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `POST` | `/dashboards/:id/duplicate` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `POST` | `/queries` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/queries` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `DELETE` | `/queries/:id` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `POST` | `/queries/:id/execute` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `POST` | `/alerts` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `GET` | `/alerts` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `DELETE` | `/alerts/:id` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |
| `POST` | `/export` | ❌ No | Global | `src/modules/event-analytics/routes.ts` | Standard (60/min) |

### Detailed Execution Trace Sample
```
HTTP Request (GET /overview)
  ↓
[Middleware] Fastify Plugin / Body Parser
  ↓
[Auth Guard] Public Route
  ↓
[Validation] Zod Schema Validation
  ↓
[Controller] event-analyticsController
  ↓
[Service] EventAnalyticsService
  ↓
[Repository] EventAnalyticsRepository
  ↓
[Database SQL] PostgreSQL / ClickHouse Query
  ↓
HTTP Response (200 OK / JSON)
```

---

## 4. Services & Business Logic


### EventAnalyticsService
- **Source File:** `src/modules/event-analytics/service.ts`
- **Methods:** `getOverview()`, `getTrends()`, `getHealth()`, `listErrors()`, `getError()`, `listErrorGroups()`, `getErrorGroup()`, `setErrorGroupStatus()`, `getErrorTrends()`, `getRoutePerformance()`, `getLatencyDistribution()`, `getApdex()`, `listRequests()`, `getRequest()`, `getTraceWaterfall()`, `listTraces()`, `getTrace()`, `listMetricNames()`, `getMetricSeries()`, `getMetricStats()`, `listLogs()`, `pollLogsSince()`, `pollErrorsSince()`, `listSessions()`, `getSession()`, `listUsers()`, `getUserJourney()`, `listCrons()`, `getCronHistory()`, `createDashboard()`, `listDashboards()`, `getDashboard()`, `updateDashboard()`, `deleteDashboard()`, `duplicateDashboard()`, `createSavedQuery()`, `listSavedQueries()`, `deleteSavedQuery()`, `executeSavedQuery()`, `createAlert()`, `listAlerts()`, `deleteAlert()`, `exportData()`, `audit()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/event-analytics/repository").EventAnalyticsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger
- **External Calls:** None


---

## 5. Repositories & Database Operations


### EventAnalyticsRepository
- **Source File:** `src/modules/event-analytics/repository.ts`
- **Methods:** `withTransaction()`, `getErrorStats()`, `getRequestStats()`, `getUniqueUserCount()`, `getEventTrend()`, `listErrors()`, `getErrorById()`, `listErrorGroups()`, `getErrorGroup()`, `updateErrorGroupStatus()`, `getRoutePerformance()`, `getLatencyDistribution()`, `getApdexCounts()`, `listRequests()`, `getRequestById()`, `getSpansByTrace()`, `getTraceById()`, `listTraces()`, `listMetricNames()`, `getMetricSeries()`, `getMetricStats()`, `listLogs()`, `listLogsSince()`, `listErrorsSince()`, `listSessions()`, `getSession()`, `listUsers()`, `getUserJourney()`, `listCrons()`, `getCronHistory()`, `createDashboard()`, `listDashboards()`, `getDashboard()`, `updateDashboard()`, `deleteDashboard()`, `createSavedQuery()`, `listSavedQueries()`, `getSavedQuery()`, `deleteSavedQuery()`, `createAlert()`, `listAlerts()`, `getAlert()`, `deleteAlert()`, `exportDataset()`, `refreshHourlyRollup()`, `listOrgsWithRecentErrors()`, `refreshErrorGroups()`, `ping()`
- **Tables Touched:** `users`, `events_errors`, `events_requests`, `events_spans`, `events_metrics`, `events_traces`, `events_logs`, `events_cron_checkins`, `analytics_error_groups`, `analytics_performance_summary`, `analytics_user_sessions`, `analytics_dashboards`, `analytics_saved_queries`, `analytics_alerts`, `traces`, `metrics`, `logs`, `errors`, `requests`
- **Transactions:** ✅ Uses Database Transactions


---

## 6. Database Tables & Ownership Matrix


| Table Name | Role | Columns | Indexes | Foreign Keys |
|---|---|---|---|---|
| `users` | Reader/Writer | 46 | 7 | 0 |
| `events_errors` | Reader/Writer | 32 | 8 | 1 |
| `events_requests` | Reader/Writer | 33 | 8 | 1 |
| `events_spans` | Reader/Writer | 42 | 8 | 1 |
| `events_metrics` | Reader/Writer | 24 | 4 | 1 |
| `events_traces` | Reader/Writer | 22 | 4 | 1 |
| `events_logs` | Reader/Writer | 19 | 4 | 1 |
| `events_cron_checkins` | Reader/Writer | 15 | 3 | 1 |
| `analytics_error_groups` | Reader/Writer | 19 | 2 | 1 |
| `analytics_performance_summary` | Reader/Writer | 18 | 1 | 1 |
| `analytics_user_sessions` | Reader/Writer | 13 | 1 | 1 |
| `analytics_dashboards` | Reader/Writer | 14 | 1 | 0 |
| `analytics_saved_queries` | Reader/Writer | 13 | 1 | 0 |
| `analytics_alerts` | Reader/Writer | 14 | 1 | 0 |
| `traces` | Reader/Writer | 16 | 3 | 0 |
| `metrics` | Reader/Writer | 17 | 2 | 0 |
| `logs` | Reader/Writer | 12 | 3 | 0 |
| `errors` | Reader/Writer | 19 | 4 | 0 |
| `requests` | Reader/Writer | 24 | 5 | 0 |


---

## 7. Event Bus & Queue Processing

- **Published Events:** None
- **Consumed Events:** `close`, `error`
- **Queue Jobs:** None

---

## 8. Enterprise Health Scorecard

| Domain | Score | Rating | Analysis |
|---|---|---|---|
| **Architecture** | 85/100 | Great | Bounded context isolation |
| **Security** | 60/100 | Needs Review | Route guards & input schemas |
| **Performance** | 82/100 | Great | Query efficiency & indexing |
| **Scalability** | 80/100 | Great | Stateless design |
| **Maintainability** | 85/100 | Great | Readable TS code & types |
| **Testing** | 75/100 | Moderate | Unit & integration coverage |
| **DDD Compliance** | 88/100 | Great | Domain model separation |
| **Overall Score** | **78/100** | **REMEDIATION NEEDED** | Core System Rating |

---

## 9. Actionable Recommendations

- **P1:** Ensure all endpoints in `event-analytics` implement strict rate limiting.
- **P2:** Expand unit test coverage for `EventAnalyticsService`.
- **P3:** Refactor raw SQL string concatenations into parameterised repository helpers where applicable.

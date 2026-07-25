# MODULE KNOWLEDGE BASE: ANALYTICS

> **Code Intelligence Static Analysis Report**
> **Module Path:** `src/modules/analytics`
> **Health Score:** 87/100

---

## 1. Executive Summary & Purpose

The **analytics** module provides core bounded-context capabilities within the backend domain architecture.

- **Controllers:** 0
- **Services:** 1
- **Repositories:** 1
- **Discovered Routes:** 8
- **Owned Database Tables:** None directly owned
- **External Integrations:** None

---

## 2. Architecture & Folder Structure

### Folder Structure
```
src/modules/analytics/
├── analytics.module.ts
├── cache.ts
├── repository.ts
├── routes.ts
├── service.ts
├── types.ts
```

### Module Boundaries & Dependencies
- **Imported Modules:** None (Standalone Module)
- **Layering Compliance:** Controller → Service → Repository pattern strictly followed.

---

## 3. Route Inventory & Execution Flow

### Route Table
| Method | Path | Auth | Scoped | Handler | Rate Limit |
|---|---|---|---|---|---|
| `GET` | `/:projectId/events` | ✅ Yes | Project | `src/modules/analytics/routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/events/:eventId` | ✅ Yes | Project | `src/modules/analytics/routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/requests/overview` | ✅ Yes | Project | `src/modules/analytics/routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/dashboard` | ✅ Yes | Project | `src/modules/analytics/routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/error-groups` | ✅ Yes | Project | `src/modules/analytics/routes.ts` | Standard (60/min) |
| `PATCH` | `/:projectId/error-groups/:fingerprint` | ✅ Yes | Project | `src/modules/analytics/routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/error-groups/:fingerprint/resolve` | ✅ Yes | Project | `src/modules/analytics/routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/health` | ✅ Yes | Project | `src/modules/analytics/routes.ts` | Standard (60/min) |

### Detailed Execution Trace Sample
```
HTTP Request (GET /:projectId/events)
  ↓
[Middleware] Fastify Plugin / Body Parser
  ↓
[Auth Guard] JWT Bearer Authentication Validated
  ↓
[Validation] Zod Schema Validation
  ↓
[Controller] analyticsController
  ↓
[Service] AnalyticsService
  ↓
[Repository] AnalyticsRepository
  ↓
[Database SQL] PostgreSQL / ClickHouse Query
  ↓
HTTP Response (200 OK / JSON)
```

---

## 4. Services & Business Logic


### AnalyticsService
- **Source File:** `src/modules/analytics/service.ts`
- **Methods:** `listEvents()`, `getEventDetails()`, `getRequestOverview()`, `getDashboard()`, `listErrorGroups()`, `updateErrorGroup()`, `resolveErrorGroup()`, `getHealth()`, `cached()`, `timed()`, `timedData()`, `cacheKey()`, `stableStringify()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/analytics/repository").AnalyticsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/analytics/cache").AnalyticsCache
- **External Calls:** None


---

## 5. Repositories & Database Operations


### AnalyticsRepository
- **Source File:** `src/modules/analytics/repository.ts`
- **Methods:** `listEvents()`, `getEventDetails()`, `getRequestOverview()`, `getDashboard()`, `listErrorGroups()`, `updateErrorGroup()`, `checkHealth()`, `one()`, `queryData()`, `queryRows()`, `withProjectContext()`, `clampLimit()`, `encodeCursor()`, `decodeCursor()`
- **Tables Touched:** `errors`, `requests`, `error_groups`
- **Transactions:** ✅ Uses Database Transactions


---

## 6. Database Tables & Ownership Matrix


| Table Name | Role | Columns | Indexes | Foreign Keys |
|---|---|---|---|---|
| `errors` | Reader/Writer | 19 | 4 | 0 |
| `requests` | Reader/Writer | 24 | 5 | 0 |
| `error_groups` | Reader/Writer | 12 | 1 | 0 |


---

## 7. Event Bus & Queue Processing

- **Published Events:** None
- **Consumed Events:** None
- **Queue Jobs:** None

---

## 8. Enterprise Health Scorecard

| Domain | Score | Rating | Analysis |
|---|---|---|---|
| **Architecture** | 85/100 | Great | Bounded context isolation |
| **Security** | 95/100 | Great | Route guards & input schemas |
| **Performance** | 82/100 | Great | Query efficiency & indexing |
| **Scalability** | 80/100 | Great | Stateless design |
| **Maintainability** | 85/100 | Great | Readable TS code & types |
| **Testing** | 75/100 | Moderate | Unit & integration coverage |
| **DDD Compliance** | 88/100 | Great | Domain model separation |
| **Overall Score** | **87/100** | **ENTERPRISE READY** | Core System Rating |

---

## 9. Actionable Recommendations

- **P1:** Ensure all endpoints in `analytics` implement strict rate limiting.
- **P2:** Expand unit test coverage for `AnalyticsService`.
- **P3:** Refactor raw SQL string concatenations into parameterised repository helpers where applicable.

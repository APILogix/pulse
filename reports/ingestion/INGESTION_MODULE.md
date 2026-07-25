# MODULE KNOWLEDGE BASE: INGESTION

> **Code Intelligence Static Analysis Report**
> **Module Path:** `src/modules/ingestion`
> **Health Score:** 78/100

---

## 1. Executive Summary & Purpose

The **ingestion** module provides core bounded-context capabilities within the backend domain architecture.

- **Controllers:** 1
- **Services:** 1
- **Repositories:** 0
- **Discovered Routes:** 17
- **Owned Database Tables:** None directly owned
- **External Integrations:** None

---

## 2. Architecture & Folder Structure

### Folder Structure
```
src/modules/ingestion/
├── controller.ts
├── ingestion.module.ts
├── admin-logger.ts
├── log-database.ts
├── event-normalizer.ts
├── ingestion-job-handler.ts
├── telemetry-reader.ts
├── telemetry-writer.legacy.ts
├── telemetry-writer.ts
├── postgress.writter.ts
├── ingest-queues.ts
├── pg-queue-worker.ts
├── pg-queue.ts
├── rate-limiter.ts
├── routes.ts
├── service.ts
├── types.ts
├── usage-counter.ts
├── api-key.ts
├── event-processor.ts
├── metrics-server.ts
├── usage-rollup.ts
├── worker-registry.ts
```

### Module Boundaries & Dependencies
- **Imported Modules:** None (Standalone Module)
- **Layering Compliance:** Controller → Service → Repository pattern strictly followed.

---

## 3. Route Inventory & Execution Flow

### Route Table
| Method | Path | Auth | Scoped | Handler | Rate Limit |
|---|---|---|---|---|---|
| `POST` | `/v1/init` | ❌ No | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `POST` | `/v1/ingest` | ❌ No | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `POST` | `/v1/ingest/requests` | ❌ No | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `POST` | `/v1/ingest/errors` | ❌ No | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `POST` | `/v1/ingest/logs` | ❌ No | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `POST` | `/v1/ingest/metrics` | ❌ No | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `GET` | `/v1/health` | ❌ No | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `GET` | `/v1/ingest/health` | ✅ Yes | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `GET` | `/v1/limits` | ❌ No | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `GET` | `/v1/usage` | ✅ Yes | Project | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `GET` | `/v1/errors` | ✅ Yes | Project | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `GET` | `/v1/errors/:errorId` | ✅ Yes | Project | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `GET` | `/v1/dlq` | ✅ Yes | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `POST` | `/v1/dlq/reprocess/:jobId` | ✅ Yes | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `POST` | `/v1/dlq/reprocess-all` | ✅ Yes | Global | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `POST` | `/v1/replay` | ✅ Yes | Project | `src/modules/ingestion/routes.ts` | Standard (60/min) |
| `GET` | `/v1/debug/events/:id` | ✅ Yes | Project | `src/modules/ingestion/routes.ts` | Standard (60/min) |

### Detailed Execution Trace Sample
```
HTTP Request (POST /v1/init)
  ↓
[Middleware] Fastify Plugin / Body Parser
  ↓
[Auth Guard] Public Route
  ↓
[Validation] Zod Schema Validation
  ↓
[Controller] IngestionController
  ↓
[Service] IngestionService
  ↓
[Repository] ingestionRepository
  ↓
[Database SQL] PostgreSQL / ClickHouse Query
  ↓
HTTP Response (200 OK / JSON)
```

---

## 4. Services & Business Logic


### IngestionService
- **Source File:** `src/modules/ingestion/service.ts`
- **Methods:** `resolveProject()`, `queueDepth()`, `shouldShed()`, `assertQuotaAvailable()`, `initializeSdk()`, `ingestBatch()`, `ingestRequests()`, `ingestErrors()`, `ingestLogs()`, `ingestMetrics()`, `processIngest()`, `buildJobs()`, `extractEventId()`, `assertKeyCanUseEndpoint()`, `isEventTypeAllowed()`, `getHealth()`, `getIngestionHealth()`, `getLimits()`, `getDLQJobs()`, `reprocessDLQJob()`, `dlqRowToJobPayload()`, `reprocessAllDLQ()`, `replayEvents()`, `listErrors()`, `getErrorById()`, `getDebugEvent()`, `shutdown()`, `getProjectUsage()`, `normalizeErrorEventListQuery()`, `parseOptionalDate()`, `normalizeInteger()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/@types/pg/index").Pool, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/postgress.writter").PostgresWriter, ServiceConfig
- **External Calls:** None


---

## 5. Repositories & Database Operations

*No repository classes found in this module.*

---

## 6. Database Tables & Ownership Matrix

*No database tables accessed directly by this module.*

---

## 7. Event Bus & Queue Processing

- **Published Events:** None
- **Consumed Events:** `error`, `type`
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

- **P1:** Ensure all endpoints in `ingestion` implement strict rate limiting.
- **P2:** Expand unit test coverage for `IngestionService`.
- **P3:** Refactor raw SQL string concatenations into parameterised repository helpers where applicable.

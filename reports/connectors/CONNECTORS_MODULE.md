# MODULE KNOWLEDGE BASE: CONNECTORS

> **Code Intelligence Static Analysis Report**
> **Module Path:** `src/modules/connectors`
> **Health Score:** 78/100

---

## 1. Executive Summary & Purpose

The **connectors** module provides core bounded-context capabilities within the backend domain architecture.

- **Controllers:** 0
- **Services:** 2
- **Repositories:** 6
- **Discovered Routes:** 34
- **Owned Database Tables:** None directly owned
- **External Integrations:** Slack API, Email/Nodemailer

---

## 2. Architecture & Folder Structure

### Folder Structure
```
src/modules/connectors/
├── audit.repository.ts
├── connectors.module.ts
├── connector.repository.ts
├── connector.types.ts
├── delivery.repository.ts
├── delivery.service.ts
├── delivery.types.ts
├── job.constants.ts
├── metrics.repository.ts
├── worker-metrics.ts
├── permission.constants.ts
├── permissions.ts
├── monitor.ts
├── discord.connector.ts
├── email.connector.ts
├── pagerduty.connector.ts
├── slack.connector.ts
├── slack.routes.ts
├── slack.service.ts
├── sms.connector.ts
├── teams.connector.ts
├── webhook.connector.ts
├── queue.ts
├── registry.ts
├── repository.ts
├── routes.ts
├── routes.repository.ts
├── runtime.ts
├── secret.service.ts
├── service.ts
```

### Module Boundaries & Dependencies
- **Imported Modules:** None (Standalone Module)
- **Layering Compliance:** Controller → Service → Repository pattern strictly followed.

---

## 3. Route Inventory & Execution Flow

### Route Table
| Method | Path | Auth | Scoped | Handler | Rate Limit |
|---|---|---|---|---|---|
| `GET` | `/types` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/:id` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/:id/details` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `PATCH` | `/:id` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `DELETE` | `/:id` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/enable` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/disable` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/rotate-secret` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/test` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/health-check` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/:id/health-history` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/:id/test-runs` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/send` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/:id/deliveries` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/deliveries/:deliveryId` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/deliveries/:deliveryId/retry` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/:id/deliveries/:deliveryId/attempts` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/:id/audit` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/audit` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/routes` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `GET` | `/:id/routes` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `PATCH` | `/:id/routes/:routeId` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `DELETE` | `/:id/routes/:routeId` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/oauth/start` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/oauth/callback` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/oauth/refresh` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/:id/oauth/disconnect` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/preview` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/validate-configuration` | ❌ No | Global | `src/modules/connectors/routes.ts` | Standard (60/min) |
| `POST` | `/organizations/:orgId/connectors/slack/oauth/start` | ❌ No | Org | `src/modules/connectors/providers/slack/slack.routes.ts` | Standard (60/min) |
| `GET` | `/connectors/slack/oauth/callback` | ❌ No | Global | `src/modules/connectors/providers/slack/slack.routes.ts` | Standard (60/min) |
| `GET` | `/organizations/:orgId/connectors/:id/slack/channels` | ❌ No | Org | `src/modules/connectors/providers/slack/slack.routes.ts` | Standard (60/min) |

### Detailed Execution Trace Sample
```
HTTP Request (GET /types)
  ↓
[Middleware] Fastify Plugin / Body Parser
  ↓
[Auth Guard] Public Route
  ↓
[Validation] Zod Schema Validation
  ↓
[Controller] connectorsController
  ↓
[Service] ConnectorService
  ↓
[Repository] ConnectorRepository
  ↓
[Database SQL] PostgreSQL / ClickHouse Query
  ↓
HTTP Response (200 OK / JSON)
```

---

## 4. Services & Business Logic


### ConnectorService
- **Source File:** `src/modules/connectors/service.ts`
- **Methods:** `listTypes()`, `createConnector()`, `listConnectors()`, `getConnector()`, `updateConnector()`, `deleteConnector()`, `setConnectorEnabled()`, `rotateSecret()`, `validateConfiguration()`, `testConnection()`, `runConnectionTest()`, `runHealthCheckForConnector()`, `sendTest()`, `listDeliveries()`, `getDelivery()`, `listDeliveryAttempts()`, `retryDelivery()`, `listHealthHistory()`, `listTestRuns()`, `listAudit()`, `createRoute()`, `updateRoute()`, `deleteRoute()`, `listRoutes()`, `startOAuth()`, `completeOAuth()`, `refreshOAuth()`, `disconnectOAuth()`, `previewNotification()`, `runHealthCheck()`, `requireConnector()`, `validateConfigOrThrow()`, `assertSafeUrls()`, `audit()`, `toDto()`, `deliveryToDto()`, `routeToDto()`, `resolveOAuthExpiry()`, `enqueueOAuthRefreshIfNeeded()`, `enqueueConnectorTestIfAvailable()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/service").ConnectorServiceDeps
- **External Calls:** None


### SlackService
- **Source File:** `src/modules/connectors/providers/slack/slack.service.ts`
- **Methods:** `startOAuth()`, `handleCallback()`, `listChannels()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/providers/slack/slack.service").SlackServiceDeps
- **External Calls:** None


---

## 5. Repositories & Database Operations


### ConnectorRepository
- **Source File:** `src/modules/connectors/repository.ts`
- **Methods:** `withTransaction()`, `create()`, `findById()`, `findByIdInternal()`, `getByIds()`, `list()`, `listMonitorable()`, `update()`, `upsertCredential()`, `getCredential()`, `softDelete()`, `setStatus()`, `insertDelivery()`, `markDeliverySent()`, `markDeliveryRetrying()`, `markDeliveryFailed()`, `claimRetryableDeliveries()`, `listDeliveries()`, `getDelivery()`, `insertDeliveryIdempotent()`, `findDeliveryByDedupKey()`, `listAttempts()`, `retryDelivery()`, `getDlqGrowth()`, `insertDeadLetter()`, `recordSuccess()`, `recordFailure()`, `insertHealthCheck()`, `listHealthChecks()`, `insertTestRun()`, `listTestRuns()`, `insertAuditLog()`, `listAuditLogs()`, `createRoute()`, `updateRoute()`, `deleteRoute()`, `listRoutes()`, `listRoutesByIds()`, `createOAuthState()`, `consumeOAuthState()`, `cleanupExpiredOAuthStates()`, `findOAuthStateWithConnector()`, `deleteOAuthState()`
- **Tables Touched:** `metrics`
- **Transactions:** ❌ Simple Queries Only


### ConnectorAuditRepository
- **Source File:** `src/modules/connectors/audit/audit.repository.ts`
- **Methods:** `insertAuditLog()`, `listAuditLogs()`
- **Tables Touched:** `connector_audit_logs`
- **Transactions:** ❌ Simple Queries Only


### ConnectorRepository
- **Source File:** `src/modules/connectors/core/connector.repository.ts`
- **Methods:** `withTransaction()`, `create()`, `findById()`, `findByIdInternal()`, `getByIds()`, `list()`, `listMonitorable()`, `update()`, `upsertCredential()`, `getCredential()`, `softDelete()`, `setStatus()`
- **Tables Touched:** `connector_configs`, `connector_credentials`, `connector_secret_versions`
- **Transactions:** ✅ Uses Database Transactions


### DeliveryRepository
- **Source File:** `src/modules/connectors/delivery/delivery.repository.ts`
- **Methods:** `withTransaction()`, `insertDelivery()`, `insertDeliveryIdempotent()`, `markDeliverySent()`, `markDeliveryRetrying()`, `markDeliveryFailed()`, `claimRetryableDeliveries()`, `listDeliveries()`, `getDelivery()`, `findDeliveryByDedupKey()`, `listAttempts()`, `retryDelivery()`, `insertDeadLetter()`, `getDlqGrowth()`, `insertAttempt()`
- **Tables Touched:** `connector_deliveries`, `connector_delivery_attempts`, `connector_audit_logs`
- **Transactions:** ✅ Uses Database Transactions


### ConnectorMetricsRepository
- **Source File:** `src/modules/connectors/metrics/metrics.repository.ts`
- **Methods:** `recordSuccess()`, `recordFailure()`, `insertHealthCheck()`, `listHealthChecks()`, `insertTestRun()`, `listTestRuns()`
- **Tables Touched:** `connector_configs`, `connector_health_checks`, `connector_test_runs`
- **Transactions:** ❌ Simple Queries Only


### ConnectorRoutesRepository
- **Source File:** `src/modules/connectors/routing/routes.repository.ts`
- **Methods:** `createRoute()`, `updateRoute()`, `deleteRoute()`, `getRoute()`, `listRoutes()`, `listRoutesByIds()`, `createOAuthState()`, `consumeOAuthState()`, `cleanupExpiredOAuthStates()`, `findOAuthStateWithConnector()`, `deleteOAuthState()`, `requireOwnedConnector()`, `requireOwnedProject()`
- **Tables Touched:** `projects`, `connector_configs`, `connector_routes`, `connector_oauth_states`
- **Transactions:** ✅ Uses Database Transactions


---

## 6. Database Tables & Ownership Matrix


| Table Name | Role | Columns | Indexes | Foreign Keys |
|---|---|---|---|---|
| `metrics` | Reader/Writer | 17 | 2 | 0 |
| `connector_audit_logs` | Reader/Writer | 14 | 5 | 0 |
| `connector_configs` | Reader/Writer | 31 | 9 | 0 |
| `connector_credentials` | Reader/Writer | 14 | 5 | 0 |
| `connector_secret_versions` | Reader/Writer | 6 | 2 | 0 |
| `connector_deliveries` | Reader/Writer | 34 | 11 | 0 |
| `connector_delivery_attempts` | Reader/Writer | 13 | 3 | 1 |
| `connector_health_checks` | Reader/Writer | 13 | 3 | 0 |
| `connector_test_runs` | Reader/Writer | 7 | 2 | 0 |
| `projects` | Reader/Writer | 15 | 5 | 0 |
| `connector_routes` | Reader/Writer | 8 | 6 | 1 |
| `connector_oauth_states` | Reader/Writer | 6 | 3 | 0 |


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
| **Security** | 60/100 | Needs Review | Route guards & input schemas |
| **Performance** | 82/100 | Great | Query efficiency & indexing |
| **Scalability** | 80/100 | Great | Stateless design |
| **Maintainability** | 85/100 | Great | Readable TS code & types |
| **Testing** | 75/100 | Moderate | Unit & integration coverage |
| **DDD Compliance** | 88/100 | Great | Domain model separation |
| **Overall Score** | **78/100** | **REMEDIATION NEEDED** | Core System Rating |

---

## 9. Actionable Recommendations

- **P1:** Ensure all endpoints in `connectors` implement strict rate limiting.
- **P2:** Expand unit test coverage for `ConnectorService`.
- **P3:** Refactor raw SQL string concatenations into parameterised repository helpers where applicable.

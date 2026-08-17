# Pulse Observability Platform — Comprehensive Architectural & Resource Report (Branch: `kimi/ai-schema-redesgin`)

**Document Title**: Observability Platform Deep Analysis Report  
**Branch**: `kimi/ai-schema-redesgin`  
**Authoritative Scope**: Backend (`pulse/src/modules/observability`) & Frontend (`pulsiv_fe/src/pages/observe`)  
**Database Plane**: Dedicated Log Database (`logDB` / `events_*` tables) & Primary DB (`control plane`)  
**Date**: 2026-08-16  

---

## Executive Summary & What Changed on `kimi/ai-schema-redesgin`

On the `kimi/ai-schema-redesgin` branch, the Observability Platform has been significantly elevated from an initial 9-resource query engine into a **fully integrated enterprise telemetry and developer observability suite**:

1. **Resource Portfolio Expanded to 11 Resources**: Added dedicated resource explorers for **`replays`** (`events_replays`) and **`sessions`** (`analytics_user_sessions`).
2. **First-Class Public ID System (`public_id`)**: Standardized canonical public IDs (`REQ-...`, `ERR-...`, `ISS-...`, `TRC-...`) with cryptographic verification, lookup mapping, and direct routing.
3. **Specialized Sectioned Detail Pipelines**:
   - **Request Detail** (`detailRequest`): Structured into `header`, `summaryCards`, `http` (parameters/headers/bodies), `trace`, `performance`, `context` (geo/client/server/sdk), `metadata`, and `related`.
   - **Error Detail** (`detailError`): Structured into `error`, `http`, `project`, `service`, `server`, `release`, `sdk`, `trace`, `errorGroup`, `request`, `debugging` (`stackFrames`, `breadcrumbs`), and `related`.
   - **Developer Tools API** (`GET /requests/:id/developer-tools`): Lazy, on-demand raw payload inspector with automated multi-layer sensitive data redaction (`authorization`, `cookie`, `token`, `password`, `apiKey`).
4. **Releases & Deployment Observability**: Added `GET /releases` with signed HMAC-SHA256 cursor pagination querying `project_releases` and `project_environments`.
5. **Advanced Error Groups Architecture**: Canonical item assembly (`assembleErrorGroupItem`), optimistic concurrency control (`expectedVersion`), regression count/timestamp tracking, merge/unmerge lifecycle actions, and audit logging via `error_group_history`.

---

## 1. System Architecture Diagram

```
                                  ┌────────────────────────────────────────┐
                                  │      Frontend (React / Vite / TSX)     │
                                  │   (InfiniteTable, Search, Ask AI Modal)│
                                  └───────────────────┬────────────────────┘
                                                      │ HTTP / REST / SSE
                                                      ▼
                                  ┌────────────────────────────────────────┐
                                  │     Observability Controller & Routes   │
                                  │  (/organizations/:orgId/observability) │
                                  └───────────────────┬────────────────────┘
                                                      │
         ┌────────────────────────────────────────────┼────────────────────────────────────────────┐
         ▼                                            ▼                                            ▼
┌───────────────────────────────┐     ┌───────────────────────────────┐     ┌───────────────────────────────┐
│ Unified Explorer Query Engine │     │      Correlation Engine       │     │   Dedicated Detail Handlers   │
│  - Search Parser (Grammar)    │     │  - Seed Event Resolution      │     │  - Request Detail Assembler   │
│  - 11-Resource Field Registry │     │  - Multi-Entity Bundle        │     │  - Error Detail Assembler     │
│  - Keyset Cursor Pagination   │     │  - Cross-Signal Traversal     │     │  - Error Group Canonical Form │
│  - Dynamic Project Lookups    │     └───────────────┬───────────────┘     │  - Developer Tools Redactor   │
└───────────────┬───────────────┘                     │                     └───────────────┬───────────────┘
                │                                     ▼                                     │
                │                     ┌───────────────────────────────┐                     │
                │                     │    AI Context Assembler       │                     │
                │                     │  - Fact Extraction & Sanitizer│                     │
                │                     │  - LLM / Heuristic Analysis   │                     │
                │                     └───────────────┬───────────────┘                     │
                ▼                                     │                                     ▼
┌─────────────────────────────────────────────────────▼─────────────────────────────────────────────────────┐
│                                         Log Database (PostgreSQL)                                         │
│ ┌───────────────────┬───────────────────┬───────────────────┬───────────────────┬───────────────────────┐ │
│ │  events_requests  │   events_errors   │   error_groups    │    events_logs    │     events_traces     │ │
│ ├───────────────────┼───────────────────┼───────────────────┼───────────────────┼───────────────────────┤ │
│ │   events_spans    │  events_metrics   │   events_crons    │  events_profiles  │    events_replays     │ │
│ ├───────────────────┼───────────────────┼───────────────────┼───────────────────┼───────────────────────┤ │
│ │analytics_sessions │ project_releases  │project_lookup (FK)│error_group_history│  audit & migrations   │ │
│ └───────────────────┴───────────────────┴───────────────────┴───────────────────┴───────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Universal Query Protocol & DSL

Every explorer resource list endpoint conforms to the **Common Explorer Framework** via `RawExplorerQuerySchema`.

### 2.1 Standard Query Parameters Accepted

| Parameter | Type | Validation / Constraints | Description |
| :--- | :--- | :--- | :--- |
| `search` | `string` | Max 2000 chars | Search DSL expression (tokens, aliases, comparisons, quoted strings, free text). |
| `from` | `ISO Date` | Coerced to Date | Explicit time window start (half-open `[from, to)`). |
| `to` | `ISO Date` | Coerced to Date | Explicit time window end. Defaults to `NOW()`. |
| `range` | `enum` | `15m`, `1h`, `6h`, `24h`, `7d`, `30d`, `90d` | Relative time preset used when `from` is omitted (default: `24h`). |
| `environment` | `string` | Regex `^[A-Za-z0-9][A-Za-z0-9._-]*$` | Scopes query to a specific deployment environment. |
| `projectId` | `UUID` | Valid UUID string | Scopes query to a specific project. |
| `filters` | `JSON` | Array of `{ field, op, value? }` (Max 50) | Structured JSON filters with typed operators. |
| `sort` | `string` | Format `field:asc` or `field:desc` | Resource sort override (defaults to resource's `defaultSort`). |
| `cursor` | `string` | Base64 opaque string | Keyset pagination token encoding `{ t: ISOString, id: string, d: 'asc'\|'desc' }`. |
| `direction` | `enum` | `forward` \| `backward` (Default: `forward`) | Keyset pagination scan direction. |
| `limit` | `integer` | Min 1, Max 200 (Default: 50) | Row limit for page. Backend fetches `limit + 1` to compute `hasNext`. |
| `fields` | `string` | Comma-separated list of field names | Dynamic projection allow-list. Restricts returned columns. |
| `live` | `boolean` | `true` \| `false` \| `1` \| `0` | Reserved for live stream polling. |

---

### 2.2 Filter Operators & JSON Attribute Addressing

#### Supported Operators
- **Scalar Comparison**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
- **Set Membership**: `in`, `nin` (values passed as array)
- **Range**: `between` (values passed as `[min, max]`)
- **String Matching**: `contains` (ILIKE `%val%`), `ncontains`, `startsWith` (ILIKE `val%`), `endsWith` (ILIKE `%val`)
- **Nullability**: `exists` (`IS NOT NULL`), `nexists` (`IS NULL`)

#### JSON Path Addressing
Filters and search can target arbitrary JSONB paths on `attributes`, `metadata`, or `payload`:
- `attr:<jsonKey>` $\rightarrow$ translates to `attributes ->> $param`
- `meta:<jsonKey>` $\rightarrow$ translates to `metadata ->> $param`
- `payload:<jsonKey>` $\rightarrow$ translates to `payload ->> $param`

---

## 3. Complete Resource Inventory (11 Resources)

```
1.  requests        (events_requests)
2.  errors          (events_errors)
3.  error-groups    (error_groups)
4.  logs            (events_logs)
5.  traces          (events_traces)
6.  spans           (events_spans)
7.  metrics         (events_metrics)
8.  crons           (events_cron_checkins)
9.  profiles        (events_profiles)
10. replays         (events_replays)          [NEW ON BRANCH]
11. sessions        (analytics_user_sessions) [NEW ON BRANCH]
```

---

### 3.1 Resource: `requests`

* **Table**: `events_requests`
* **Time Column**: `occurred_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_events_requests_tenant_env_time`, `idx_events_requests_endpoint_time`, `idx_events_requests_user_time`
* **Error Predicate**: `is_error`

#### Accepted Query Fields & Search Aliases
- **Identity & Public ID**: `id` (uuid), `publicId` (string, `public_id`), `requestId` (string, `request_id`), `eventId` (string)
- **HTTP**: `method` (string), `endpoint` (string), `name` (string), `statusCode` / `status` (number), `durationMs` / `latencyMs` (number), `framework` (string), `bodySize` (number), `responseSize` (number)
- **Client & Geo**: `clientIp` / `clientIpHash` (string), `userAgent` (string), `referer` (string), `geoCountry` (string), `geoRegion` (string), `geoAsn` (number), `browser` (string), `browserVersion` (string), `os` (string), `osVersion` (string), `device` (string)
- **Classifiers**: `isBot` (boolean), `isSlow` (boolean), `hasError` (boolean), `hasTrace` (boolean)
- **Correlation**: `traceId` (string), `tracePublicId` (string), `spanId` (string), `userId` (string), `tenantId` (string), `service` (string), `environment` (string), `release` (string)
- **Search Aliases**: `status`, `code`, `latency`, `duration`, `country`, `browser`, `os`, `device`, `ip`, `svc`, `env`, `trace`, `user`
- **Summary & Stats**: Total, errors, slow, unique users, unique routes, avg/max/p50/p95/p99 latency, error rate

---

### 3.2 Resource: `errors`

* **Table**: `events_errors`
* **Time Column**: `occurred_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_events_errors_tenant_env_time`, `idx_events_errors_fingerprint_time`
* **Error Predicate**: `severity IN ('error','critical','fatal')`

#### Accepted Query Fields & Search Aliases
- **Identity & Public ID**: `id` (uuid), `publicId` (string, `public_id`), `eventId` (string)
- **Error Specifics**: `fingerprint` (string), `errorGroupId` (uuid), `errorGroupPublicId` (string, `ISS-...`), `errorName` (string), `message` (string), `severity` (enum: `debug`..`fatal`), `mechanism` (string), `handled` / `isHandled` (boolean)
- **HTTP & Environment**: `method` (string), `route` (string), `url` (string), `statusCode` (number), `statusText` (string), `environment` (string), `service` (string), `serverName` (string), `release` (string), `sdkName` (string), `sdkVersion` (string)
- **Correlation**: `traceId` (string), `tracePublicId` (string, `TRC-...`), `spanId` (string), `parentSpanId` (string), `sessionId` (string), `userId` (string), `requestId` (string)
- **Project Lookups**: `project` / `projectSlug` / `projectName` (via `project_lookup` subqueries)
- **Search Aliases**: `error`, `exception`, `fingerprint`, `route`, `errorGroupPublicId`, `error_group`, `group`, `severity`, `level`, `trace`, `tracePublicId`, `msg`
- **Summary**: Total, unique fingerprints, affected users, fatal errors

---

### 3.3 Resource: `error-groups`

* **Table**: `error_groups`
* **Time Column**: `last_seen_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_error_groups_project_status_last_seen`, `idx_error_groups_project_occurrence`

#### Accepted Query Fields & Search Aliases
- **Fields**: `id` (uuid), `publicId` (string, `public_id`), `fingerprint` (string), `status` (enum: `open`, `resolved`, `ignored`, `archived`, `regressed`), `occurrenceCount` (number), `firstSeen` / `firstSeenAt` (timestamp), `lastSeen` / `lastSeenAt` (timestamp), `highestSeverity` (enum), `latestSeverity` (enum), `isRegression` (boolean), `regressionCount` (number), `lastRegressedAt` (timestamp), `latestRelease` (string), `resolvedRelease` (string), `lastErrorMessage` (string), `lastErrorName` (string), `lastStatusCode` (number), `lastTraceId` (string), `lastRequestId` (string), `isMerged` (boolean), `mergedInto` (uuid)
- **Summary**: Total, open, resolved, ignored, archived, regressions, total occurrences

---

### 3.4 Resource: `replays` [NEW ON BRANCH]

* **Table**: `events_replays`
* **Time Column**: `occurred_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_events_replays_tenant_env_time`, `idx_events_replays_service`
* **Error Predicate**: `severity IN ('error','critical','fatal')`

#### Accepted Query Fields & Search Aliases
- **Fields**: `id` (uuid), `publicId` (string, `public_id`), `eventId` (string), `environment` (string), `traceId` (string), `spanId` (string), `sessionId` (string), `userId` (string), `requestId` (string), `segmentId` (number), `name` (string), `message` (string), `service` (string), `endpoint` (string), `release` (string), `severity` (enum), `statusCode` (number), `durationMs` (number), `occurredAt` (timestamp)
- **Search Aliases**: `public_id`, `session`, `replay`, `endpoint`
- **Summary & Stats**: Total replays, unique sessions, unique users, avg duration, max duration

---

### 3.5 Resource: `sessions` [NEW ON BRANCH]

* **Table**: `analytics_user_sessions`
* **Time Column**: `started_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_analytics_sessions_org_time`, `idx_analytics_sessions_user`

#### Accepted Query Fields & Search Aliases
- **Fields**: `id` (uuid), `publicId` (string, `public_id`), `environment` (string), `sessionId` (string), `userId` (string), `startedAt` (timestamp), `endedAt` (timestamp), `durationMs` (number), `isCrashed` (boolean)
- **Search Aliases**: `public_id`, `session`
- **Summary & Stats**: Total sessions, crashed sessions, unique users, avg duration, max duration

---

### 3.6 Resource: `logs`

* **Table**: `events_logs`
* **Time Column**: `occurred_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_events_logs_level_time`, `idx_events_logs_endpoint_time`, `idx_events_logs_category_time`, `idx_events_logs_logger_time`
* **Error Predicate**: `level IN ('error','fatal') OR status_code >= 500`
* **Fields**: `id`, `publicId`, `occurredAt`, `level` (`debug`..`fatal`), `name`, `message`, `logger`, `loggerName`, `logCategory`, `logSource`, `endpoint`, `httpMethod`, `statusCode`, `durationMs`, `requestId`, `traceId`, `spanId`, `parentSpanId`, `sessionId`, `userIp`, `service`, `environment`
* **Summary & Stats**: Total, error logs, warn logs, http 5xx, unique loggers, avg/max/p95 runtime

---

### 3.7 Resource: `traces`

* **Table**: `events_traces`
* **Time Column**: `occurred_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_events_traces_tenant_env_time`, `idx_events_traces_trace_time`, `idx_events_traces_endpoint_time`, `idx_events_traces_root_status_time`, `idx_events_traces_span_kind_time`
* **Fields**: `id`, `publicId`, `occurredAt`, `traceId`, `rootSpanName`, `rootSpanId`, `spanKind`, `rootSpanStatus`, `httpMethod`, `endpoint`, `statusCode`, `spanCount`, `totalDurationMs`, `responseSize`, `isPartial`, `requestId`, `service`, `environment`
* **Summary & Stats**: Total, avg spans, partial count, unique operations, avg/max/p50/p95/p99 duration

---

### 3.8 Resource: `spans`

* **Table**: `events_spans`
* **Time Column**: `occurred_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_events_spans_trace_time`, `idx_events_spans_parent_time`, `idx_events_spans_type_time`, `idx_events_spans_endpoint_time`
* **Fields**: `id`, `publicId`, `occurredAt`, `traceId`, `spanId`, `parentSpanId`, `name`, `spanKind`, `spanType`, `spanStatus`, `isRootSpan`, `isHttpSpan`, `isDbSpan`, `isCacheSpan`, `isMessagingSpan`, `durationMs`, `exclusiveDurationMs`, `depth`, `dbSystem`, `dbName`, `dbOperation`, `dbCollection`, `dbStatement`, `httpMethod`, `httpUrl`, `httpRoute`, `httpStatusCode`, `httpResponseSize`, `netTransport`, `messagingSystem`, `service`, `endpoint`
* **Summary & Stats**: Total, unique operations, db spans, http spans, avg/max/p50/p95/p99 duration

---

### 3.9 Resource: `metrics`

* **Table**: `events_metrics`
* **Time Column**: `occurred_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_events_metrics_tenant_env_time`, `idx_events_metrics_name_time`
* **Fields**: `id`, `publicId`, `occurredAt`, `metricName`, `metricType`, `metricUnit`, `metricNamespace`, `metricDescription`, `metricCategory`, `aggregationType`, `temporality`, `isMonotonic`, `value`, `count`, `sum`, `min`, `max`, `avg`, `rate`, `p50`...`p99`, `endpoint`, `httpMethod`, `statusCode`, `service`, `traceId`
* **Summary & Stats**: Total, unique metrics, avg/max/min/sum value

---

### 3.10 Resource: `crons`

* **Table**: `events_cron_checkins`
* **Time Column**: `occurred_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_events_cron_checkins_monitor_time`, `idx_events_cron_checkins_tenant_env_time`
* **Fields**: `id`, `publicId`, `occurredAt`, `monitorSlug`, `monitorName`, `status` (`ok`, `in_progress`, `error`, `failed`, `timeout`, `missed`), `isSuccess`, `durationMs`, `startedAt`, `finishedAt`, `checkinType`, `scheduleType`, `service`, `requestId`, `traceId`
* **Summary & Stats**: Total, ok, failed, in-progress, unique monitors, success rate, avg/max/min/p95 runtime

---

### 3.11 Resource: `profiles`

* **Table**: `events_profiles`
* **Time Column**: `occurred_at` | **ID Column**: `id`
* **Preferred Indexes**: `idx_events_profiles_tenant_env_time`
* **Fields**: `id`, `publicId`, `occurredAt`, `profileType`, `requestId`, `startTime`, `endTime`, `durationMs`, `service`
* **Summary & Stats**: Total, unique types, avg duration, max duration

---

## 4. Frontend Wire Formats & Response Contracts

### 4.1 Explorer List Response (`GET /organizations/:orgId/observability/:resource`)

```jsonc
{
  "success": true,
  "items": [
    {
      "id": "a4d95267-33a7-47b2-bd78-b1187ebce811",
      "publicId": "REQ-7X9K2M",
      "occurredAt": "2026-08-16T12:00:00.000Z",
      "method": "POST",
      "endpoint": "/api/v1/checkout",
      "statusCode": 500,
      "durationMs": 1420,
      "environment": "production",
      "traceId": "trace_88f8d910a",
      "tracePublicId": "TRC-3M4N5P",
      "hasTrace": true
    }
  ],
  "pagination": {
    "nextCursor": "eyJ0IjoiMjAyNi0wOC0xNlQxMjowMDowMC4wMDBaIiwiaWQiOiJhNGQ5NTI2Ny0zM2E3LTQ3YjItYmQ3OC1iMTE4N2ViY2U4MTEiLCJkIjoiZGVzYyJ9",
    "previousCursor": null,
    "hasNext": true,
    "hasPrevious": false,
    "limit": 50,
    "direction": "forward"
  },
  "summary": { "total": 125000, "errors": 420, "slow": 1200, "uniqueUsers": 8900 },
  "statistics": { "avgLatency": 84.5, "maxLatency": 4500, "p50": 35, "p95": 210, "p99": 980, "errorRate": 0.00336 },
  "appliedFilters": [ { "field": "statusCode", "op": "gte", "value": 500 } ],
  "availableFilters": [ { "field": "method", "label": "Method", "type": "string", "operators": ["eq", "in", "neq"] } ],
  "aggregations": {},
  "query": { "resource": "requests", "timeRange": { "from": "...", "to": "..." }, "sort": { "field": "occurredAt", "direction": "desc" }, "search": "status>=500" },
  "states": { "empty": false }
}
```

---

### 4.2 Error Groups List Response (`GET /organizations/:orgId/observability/error-groups`)

Error groups are automatically transformed into the **Canonical Item Shape**:

```jsonc
{
  "success": true,
  "items": [
    {
      "id": "44556677-8899-aabb-ccdd-eeff00112233",
      "publicId": "ISS-990011",
      "status": "OPEN",
      "occurrences": {
        "count": 1840,
        "firstSeenAt": "2026-08-01T08:14:22.000Z",
        "lastSeenAt": "2026-08-16T12:35:10.000Z"
      },
      "severity": {
        "highest": "fatal",
        "latest": "error"
      },
      "regression": {
        "count": 2,
        "lastRegressedAt": "2026-08-15T09:12:00.000Z"
      },
      "release": {
        "latest": "v2.14.0",
        "resolvedIn": null
      },
      "latestEvent": {
        "publicId": "ERR-881122",
        "errorName": "TypeError",
        "message": "Cannot read properties of undefined (reading 'customer')",
        "statusCode": 500,
        "trace": {
          "publicId": "TRC-334455",
          "traceId": "trace_9901aa"
        }
      }
    }
  ],
  "pagination": { "nextCursor": null, "previousCursor": null, "hasNext": false, "hasPrevious": false, "limit": 50, "direction": "forward" },
  "summary": { "total": 142, "open": 28, "resolved": 105, "ignored": 7, "archived": 2, "regressions": 4, "totalOccurrences": 18450 }
}
```

---

### 4.3 Dedicated Request Event Detail (`GET /observability/requests/:id`)

When `:id` is a `REQ-...` public ID:

```jsonc
{
  "success": true,
  "data": {
    "header": {
      "publicId": "REQ-7X9K2M",
      "method": "POST",
      "endpoint": "/api/v1/checkout",
      "statusCode": 500,
      "duration": 1420,
      "timestamp": "2026-08-16T12:00:00.000Z",
      "environment": "production",
      "project": "web-api",
      "service": "billing-service",
      "release": "v2.14.0",
      "tracePublicId": "TRC-3M4N5P"
    },
    "summaryCards": {
      "duration": 1420,
      "status": 500,
      "responseSize": 450,
      "requestSize": 1280,
      "spanCount": 14
    },
    "http": {
      "url": "https://api.pulsiv.io/api/v1/checkout",
      "endpoint": "/api/v1/checkout",
      "method": "POST",
      "queryParameters": { "coupon": "SUMMER26" },
      "routeParameters": {},
      "requestHeaders": { "host": "api.pulsiv.io", "content-type": "application/json" },
      "responseHeaders": { "content-type": "application/json" },
      "requestBody": { "cartId": "cart_112233" },
      "responseBody": { "error": "Internal Gateway Timeout" }
    },
    "trace": { "publicId": "TRC-3M4N5P" },
    "performance": { "totalDuration": 1420, "isSlow": true },
    "context": {
      "user": "usr_99812",
      "session": "ses_4455",
      "tenant": "org_enterprise",
      "sdk": "pulse-node@2.4.1",
      "release": "v2.14.0",
      "server": "prod-k8s-pod-7",
      "browser": "Chrome",
      "os": "macOS",
      "device": "desktop",
      "geo": { "country": "US", "region": "CA", "asn": 13335 }
    },
    "metadata": { "attributes": {}, "metadata": { "cluster": "us-west-1" } },
    "ai": { "aiResponse": null },
    "related": {
      "trace": { "publicId": "TRC-3M4N5P" },
      "errors": [ { "publicId": "ERR-881122", "message": "Stripe Gateway Timeout" } ],
      "logs": { "count": 8 }
    },
    "tags": [
      { "key": "environment", "label": "Environment", "value": "production" },
      { "key": "service", "label": "Service", "value": "billing-service" },
      { "key": "method", "label": "Method", "value": "POST" },
      { "key": "status", "label": "Status", "value": "500" }
    ]
  }
}
```

---

### 4.4 Dedicated Developer Tools Accordion (`GET /observability/requests/:id/developer-tools`)

```jsonc
{
  "success": true,
  "data": {
    "rawSdkEvent": {
      "method": "POST",
      "url": "/api/v1/checkout",
      "headers": {
        "authorization": "[REDACTED]",
        "cookie": "[REDACTED]",
        "x-api-key": "[REDACTED]",
        "user-agent": "Mozilla/5.0..."
      },
      "body": { "cartId": "cart_112233", "creditCardNumber": "[REDACTED]" }
    },
    "normalizedEvent": { "publicId": "REQ-7X9K2M", "method": "POST", "statusCode": 500 },
    "rawDatabaseRecord": { "id": "a4d95267...", "public_id": "REQ-7X9K2M", "duration_ms": 1420 }
  }
}
```

---

### 4.5 Dedicated Error Event Detail (`GET /observability/errors/:id`)

When `:id` is an `ERR-...` public ID:

```jsonc
{
  "success": true,
  "data": {
    "id": "e8a91011-1213-1415-1617-181920212223",
    "publicId": "ERR-881122",
    "occurredAt": "2026-08-16T12:00:00.000Z",
    "error": {
      "name": "TypeError",
      "message": "Cannot read properties of undefined (reading 'customer')",
      "severity": "error",
      "handled": false,
      "mechanism": "uncaughtException"
    },
    "http": {
      "method": "POST",
      "route": "/api/v1/checkout",
      "url": "https://api.pulsiv.io/api/v1/checkout",
      "statusCode": 500,
      "statusText": "Internal Server Error"
    },
    "environment": "production",
    "project": { "name": "Web API", "slug": "web-api" },
    "service": "billing-service",
    "server": { "name": "prod-k8s-pod-7" },
    "release": "v2.14.0",
    "sdk": { "name": "pulse-node", "version": "2.4.1" },
    "trace": { "publicId": "TRC-3M4N5P", "traceId": "trace_88f8d910a" },
    "errorGroup": { "publicId": "ISS-990011" },
    "request": { "publicId": "REQ-7X9K2M" },
    "debugging": {
      "stackFrames": [
        { "filename": "dist/services/checkout.service.js", "function": "processPayment", "lineno": 142, "colno": 18, "in_app": true }
      ],
      "breadcrumbs": [
        { "timestamp": "2026-08-16T11:59:58.000Z", "category": "http", "message": "GET /api/v1/cart/cart_112233 status 200" }
      ]
    },
    "context": {},
    "tags": {},
    "extra": {},
    "metadata": {},
    "aiResponse": null,
    "related": {
      "errorGroup": { "publicId": "ISS-990011" },
      "trace": { "publicId": "TRC-3M4N5P" },
      "request": { "publicId": "REQ-7X9K2M" },
      "logs": { "count": 8 }
    }
  }
}
```

---

### 4.6 Releases & Deployment Timeline (`GET /observability/releases`)

```jsonc
{
  "success": true,
  "items": [
    {
      "version": "v2.14.0",
      "commitSha": "a4ea212398471203",
      "branch": "main",
      "environment": "production",
      "releasedAt": "2026-08-16T08:00:00.000Z"
    }
  ],
  "pagination": {
    "nextCursor": "ey..." /* Cryptographically signed HMAC cursor */,
    "previousCursor": null,
    "hasNext": false,
    "hasPrevious": false,
    "limit": 50,
    "direction": "forward"
  },
  "query": { "from": "...", "to": "...", "search": null, "environment": "production", "sort": "releasedAt:desc" }
}
```

---

## 5. Complete API Route Reference

Mounted under: `/organizations/:orgId/observability`

| Method | Route Path | Description |
| :--- | :--- | :--- |
| `GET` | `/navigation` | Dynamically generated sidebar navigation tree |
| `GET` | `/resources` | List of all 11 registered resource names |
| `GET` | `/releases` | Deployments & releases timeline with signed cursor pagination |
| `GET` | `/error-groups` | Error groups explorer (Canonical shape items + KPI summary) |
| `GET` | `/error-groups/summary` | Error groups aggregate KPIs (`total`, `open`, `resolved`, etc.) |
| `GET` | `/error-groups/:id` | Full Error Group detail + stack frames + 24h/7d/30d sparklines |
| `GET` | `/error-groups/:id/history` | Audit log of state transitions (`marked_resolved`, `merged`, etc.) |
| `GET` | `/error-groups/:id/events` | Telemetry error events linked to this error group |
| `PATCH` | `/error-groups/:id/status` | Update lifecycle status (`open`, `resolved`, `ignored`, `archived`) |
| `POST` | `/error-groups/:id/resolve` | Shortcut status resolution endpoint |
| `POST` | `/error-groups/:id/merge` | Merge group into target group and reassign events |
| `POST` | `/error-groups/:id/unmerge` | Reverses previous merge actions |
| `GET` | `/:resource` | Primary explorer list endpoint with keyset pagination & statistics |
| `GET` | `/:resource/summary` | Summary counters only |
| `GET` | `/:resource/statistics` | Latency / percentiles / error-rate metrics |
| `GET` | `/:resource/timeline` | Bucketed count + error count timeline (`minute`, `hour`, `day`) |
| `GET` | `/:resource/facets` | Dynamic toolbar facet filter definitions |
| `GET` | `/:resource/stream` | Server-Sent Events (SSE) live streaming tail |
| `POST` | `/:resource/ask` | AI investigation over filtered aggregate result set |
| `POST` | `/:resource/analyze` | Bulk AI investigation on user-selected row IDs |
| `GET` | `/:resource/:id` | Event detail (`requests` and `errors` route to dedicated assemblers) |
| `GET` | `/:resource/:id/developer-tools` | Developer tools raw dumps with automated redaction (`requests` only) |
| `GET` | `/:resource/:id/related/:relation` | Lazy relation fetcher (`spans`, `logs`, `errors`, `requests`, `metrics`, `profiles`, `crons`) |
| `POST` | `/:resource/:id/ask` | AI investigation on a single event instance |

---

## 6. Summary Comparison Table

| Feature Dimension | Initial Architecture | `kimi/ai-schema-redesgin` Branch |
| :--- | :--- | :--- |
| **Total Registered Resources** | 9 Resources | **11 Resources** (Added `replays` and `sessions`) |
| **Primary Event Identifiers** | Internal UUIDs | **Public IDs** (`REQ-...`, `ERR-...`, `ISS-...`, `TRC-...`) |
| **Request Detail Page** | Flat `EventDetail` | **`RequestDetailResponse`** (Sectioned HTTP/Geo/Trace/Performance) |
| **Error Detail Page** | Flat `EventDetail` | **`ErrorDetailResponse`** (Sectioned Debugging/Project/HTTP) |
| **Developer Tools** | Raw DB dump in entity | **`assembleRequestDeveloperTools`** with auto-redaction |
| **Error Groups Items** | Raw DB row mapping | **`assembleErrorGroupItem`** (Nested occurrences/regression/latestEvent) |
| **Error Groups Lifecycle** | Merge only | **Merge + Unmerge + Optimistic Version Locking** |
| **Releases Tracking** | Placeholder | **`ObservabilityReleasesRepository`** with signed HMAC cursors |
| **Project Name/Slug** | Manual client join | **Server-side `project_lookup` subquery projections** |

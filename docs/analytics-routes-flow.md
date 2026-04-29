# Analytics Routes Flow

This document explains the full request flow for the analytics module. The module is registered in `src/modules/analytics/analytics.module.ts` and mounted at `/analytics`.

## Module Wiring

1. `buildApp()` registers `registerAnalyticsModule`.
2. `analytics.module.ts` creates:
   - `AnalyticsRepository`, backed by the Postgres `pool`.
   - `AnalyticsCache`, backed by Redis plus an in-process LRU cache.
   - `AnalyticsService`, which coordinates repository reads/writes and cache behavior.
3. The module decorates Fastify as `fastify.analytics`.
4. `analyticsRoutes` are registered with prefix `/analytics`.

Every analytics route uses the `authenticate` pre-handler. The caller must send:

```http
Authorization: Bearer <access-token>
```

The auth middleware verifies the JWT, validates the session, loads the user, rejects suspended/deleted users, and attaches `request.user`.

## Shared Flow Concepts

### Time Range Parsing

Routes that accept `from` and `to` parse them as JavaScript dates.

- Invalid or missing `to` defaults to the current time.
- Invalid or missing `from` defaults to `to - fallback`.
- Event listing fallback is 7 days.
- Dashboard and request overview fallback is 24 hours.

### Limit Parsing

List routes clamp `limit` to the range `1..100`.

### Cache Flow

Read routes go through `AnalyticsService.cached()`:

1. Build cache key: `analytics:<scope>:<projectId>:<sha256(JSON.stringify(input))>`.
2. Check in-process LRU cache.
3. If LRU misses, check Redis.
4. If either cache hits:
   - Return cached data.
   - Set `queryTimeMs` to `0`.
   - Set `cacheHit: true`.
5. If cache misses:
   - Run repository query.
   - Measure query time.
   - Store result in LRU and Redis.
   - Return `cacheHit: false`.

Cache TTLs:

| Scope | TTL |
| --- | ---: |
| Events list | 30 seconds |
| Event details | 300 seconds |
| Request overview | 120 seconds |
| Dashboard | 30 seconds |
| Error groups list | 30 seconds |

Write routes invalidate analytics cache for the project after updating an error group.

### Database Tenant Context

Repository methods wrap database work in `withProjectContext()`:

1. Connect to Postgres.
2. Start transaction.
3. Run `SELECT set_config('app.current_project_id', $1, true)`.
4. Execute the query callback.
5. Commit or roll back.
6. Release the client.

The logging schema enables row-level security on analytics tables and policies compare `project_id` with `current_setting('app.current_project_id')::UUID`.

Analytics tables used:

- `events`
- `request_events`
- `error_events`
- `error_groups`

## Routes

## 1. List Events

```http
GET /analytics/:projectId/events
```

### Purpose

Returns a paginated list of project events with optional filters.

### Query Parameters

| Parameter | Behavior |
| --- | --- |
| `from` | Optional ISO date. Defaults to 7 days before `to`. |
| `to` | Optional ISO date. Defaults to current time. |
| `type` | Optional. Only accepts `error`, `request`, or `custom`. Invalid values are ignored. |
| `statusCode` / `status_code` | Optional integer HTTP status filter. |
| `method` | Optional HTTP method filter. Repository uppercases it before querying. |
| `cursor` | Optional base64url cursor from `meta.nextCursor`. |
| `limit` | Optional. Clamped to `1..100`, default `25`. |
| `sort` | `asc` or `desc`. Defaults to `desc`. |
| `q` | Optional text search over event payload, error message, and request URL. |

### Flow

1. `authenticate` validates the caller.
2. Route extracts `projectId`.
3. Route calls `parseEventListQuery()`.
4. Service calls `cached(projectId, "events", query, 30s, fetcher)`.
5. Repository builds SQL filters:
   - Always filters `e.project_id = $1`.
   - Always filters `e.timestamp BETWEEN from AND to`.
   - Optionally filters event type, request status code, request method, text search, and cursor.
6. Repository runs two queries in parallel:
   - Item query joins `events`, `request_events`, and `error_events`.
   - Count query returns total matching rows.
7. Repository fetches `limit + 1` rows to detect whether there is another page.
8. If there are more rows, repository creates `nextCursor` from the last returned row's timestamp and id.
9. Route returns metadata plus event rows.

### Response Shape

```json
{
  "meta": {
    "projectId": "...",
    "totalEstimated": 10,
    "returned": 10,
    "hasMore": false,
    "nextCursor": null,
    "queryTimeMs": 12,
    "cacheHit": false
  },
  "data": []
}
```

## 2. Get Event Details

```http
GET /analytics/:projectId/events/:eventId
```

### Purpose

Returns full details for one event, including base event data, typed request/error data, and related trace events sharing the same `request_id`.

### Flow

1. `authenticate` validates the caller.
2. Route extracts `projectId` and `eventId`.
3. Service calls `cached(projectId, "event-details", { eventId }, 300s, fetcher)`.
4. Repository runs four queries in parallel:
   - Base row from `events`.
   - Matching row from `request_events`.
   - Matching row from `error_events`.
   - Trace rows from `events` where `request_id` matches the selected event.
5. If the base event does not exist, service returns `null`.
6. Route returns `404 EVENT_NOT_FOUND` when service returns `null`.
7. Otherwise route returns details.

### Response Shape

```json
{
  "meta": {
    "projectId": "...",
    "eventId": "...",
    "queryTimeMs": 8,
    "cacheHit": false
  },
  "data": {
    "base": {},
    "request": null,
    "error": null,
    "trace": []
  }
}
```

## 3. Request Overview

```http
GET /analytics/:projectId/requests/overview
```

### Purpose

Returns aggregate request metrics for a project and time range.

### Query Parameters

| Parameter | Behavior |
| --- | --- |
| `from` | Optional ISO date. Defaults to 24 hours before `to`. |
| `to` | Optional ISO date. Defaults to current time. |

### Flow

1. `authenticate` validates the caller.
2. Route extracts `projectId`.
3. Route parses the time range with a 24-hour fallback.
4. Service calls `cached(projectId, "request-overview", range, 120s, fetcher)`.
5. Repository queries `request_events` and builds a JSON object containing:
   - `total_requests`
   - `avg_latency_ms`
   - `p95_latency_ms`
   - `error_count` for `status_code >= 500`
   - `error_rate_pct`
   - `unique_users`
6. Route returns the aggregate data and normalized ISO time range.

### Response Shape

```json
{
  "meta": {
    "projectId": "...",
    "timeRange": {
      "from": "2026-04-28T00:00:00.000Z",
      "to": "2026-04-29T00:00:00.000Z"
    },
    "queryTimeMs": 5,
    "cacheHit": false
  },
  "data": {
    "total_requests": 0,
    "avg_latency_ms": 0,
    "p95_latency_ms": 0,
    "error_count": 0,
    "error_rate_pct": 0,
    "unique_users": 0
  }
}
```

## 4. Dashboard

```http
GET /analytics/:projectId/dashboard
```

### Purpose

Returns the main dashboard payload for a project and time range.

### Query Parameters

| Parameter | Behavior |
| --- | --- |
| `from` | Optional ISO date. Defaults to 24 hours before `to`. |
| `to` | Optional ISO date. Defaults to current time. |

### Flow

1. `authenticate` validates the caller.
2. Route extracts `projectId`.
3. Route parses the time range with a 24-hour fallback.
4. Service calls `cached(projectId, "dashboard", range, 30s, fetcher)`.
5. Repository runs five dashboard queries in parallel:
   - Request summary from `request_events`.
   - Error summary from `error_groups`.
   - Top 10 endpoints from `request_events`.
   - Top 10 errors from `error_groups`.
   - HTTP status distribution from `request_events`.
6. Repository returns a `DashboardData` object with a repository-generated `generatedAt`.
7. Route wraps it with metadata and also adds a route-level `generatedAt`.

### Data Sections

| Field | Source |
| --- | --- |
| `requests` | Total, average latency, p95 latency, and 5xx error rate from `request_events`. |
| `errors` | Total, unresolved, and critical unresolved counts from `error_groups`. |
| `topEndpoints` | Top URLs/methods ordered by request count. |
| `topErrors` | Top error groups ordered by occurrences. |
| `statusDistribution` | Counts for 2xx, 3xx, 4xx, and 5xx responses. |
| `generatedAt` | Timestamp generated in repository. |

### Response Shape

```json
{
  "meta": {
    "projectId": "...",
    "timeRange": {
      "from": "2026-04-28T00:00:00.000Z",
      "to": "2026-04-29T00:00:00.000Z"
    },
    "generatedAt": "2026-04-29T00:00:00.000Z",
    "queryTimeMs": 20,
    "cacheHit": false
  },
  "data": {
    "requests": {},
    "errors": {},
    "topEndpoints": [],
    "topErrors": [],
    "statusDistribution": {},
    "generatedAt": "2026-04-29T00:00:00.000Z"
  }
}
```

## 5. List Error Groups

```http
GET /analytics/:projectId/error-groups
```

### Purpose

Returns paginated error groups for a project.

### Query Parameters

| Parameter | Behavior |
| --- | --- |
| `status` | `all`, `resolved`, or `unresolved`. Defaults to `all`. |
| `priority` | Optional integer priority filter. |
| `cursor` | Optional cursor. For this route it is an ISO `last_seen` timestamp. |
| `limit` | Optional. Clamped to `1..100`, default `25`. |

### Flow

1. `authenticate` validates the caller.
2. Route extracts `projectId`.
3. Route parses `status`, `priority`, `cursor`, and `limit`.
4. Service calls `cached(projectId, "error-groups", query, 30s, fetcher)`.
5. Repository builds SQL filters:
   - Always filters `project_id = $1`.
   - Adds `is_resolved = TRUE` for `status=resolved`.
   - Adds `is_resolved = FALSE` for `status=unresolved`.
   - Adds `priority = $n` when priority is present.
   - Adds `last_seen < cursor` when cursor is present.
6. Repository orders by `last_seen DESC` and fetches `limit + 1` rows.
7. If more rows exist, `nextCursor` is the last returned row's `last_seen` as an ISO string.
8. Route returns metadata plus error group rows.

### Response Shape

```json
{
  "meta": {
    "projectId": "...",
    "totalEstimated": 5,
    "returned": 5,
    "hasMore": false,
    "nextCursor": null,
    "queryTimeMs": 10,
    "cacheHit": false
  },
  "data": []
}
```

## 6. Update Error Group

```http
PATCH /analytics/:projectId/error-groups/:fingerprint
```

### Purpose

Updates mutable fields on an error group.

### Body

```json
{
  "priority": 2,
  "isResolved": false,
  "resolvedBy": "user@example.com"
}
```

The route also accepts snake_case fields:

```json
{
  "is_resolved": true,
  "resolved_by": "user@example.com"
}
```

### Flow

1. `authenticate` validates the caller.
2. Route extracts `projectId` and `fingerprint`.
3. Route builds an `ErrorGroupUpdate` object from the body.
4. Service calls `repository.updateErrorGroup(projectId, fingerprint, update)`.
5. Repository builds an `UPDATE error_groups` query:
   - Always sets `updated_at = NOW()`.
   - Sets `priority` if provided.
   - Sets `is_resolved` if provided.
   - Sets `resolved_at = NOW()` when `is_resolved` is true.
   - Sets `resolved_at = NULL` when `is_resolved` is false.
6. Repository returns the updated row or `null`.
7. Service invalidates all analytics cache entries for the project.
8. Route returns `404 ERROR_GROUP_NOT_FOUND` if no row was updated.
9. Otherwise route returns the updated row.

### Current Behavior Note

`resolvedBy` / `resolved_by` is accepted by the route and passed through the service, but `AnalyticsRepository.updateErrorGroup()` does not currently write it to `error_groups`. The current `error_groups` schema does not include a `resolved_by` column.

### Response Shape

```json
{
  "meta": {
    "projectId": "...",
    "fingerprint": "..."
  },
  "data": {}
}
```

## 7. Resolve Error Group

```http
POST /analytics/:projectId/error-groups/:fingerprint/resolve
```

### Purpose

Convenience endpoint for marking an error group as resolved.

### Body

```json
{
  "resolvedBy": "user@example.com"
}
```

The route also accepts:

```json
{
  "resolved_by": "user@example.com"
}
```

### Flow

1. `authenticate` validates the caller.
2. Route extracts `projectId` and `fingerprint`.
3. Route reads optional `resolvedBy` / `resolved_by`.
4. Service creates update `{ isResolved: true }`.
5. If resolver was provided, service adds `resolvedBy`.
6. Service delegates to `updateErrorGroup()`.
7. Repository updates `error_groups` and sets:
   - `is_resolved = true`
   - `resolved_at = NOW()`
   - `updated_at = NOW()`
8. Service invalidates project analytics cache.
9. Route returns `404 ERROR_GROUP_NOT_FOUND` if no row was updated.
10. Otherwise route returns the updated row plus a route-level `resolvedAt` timestamp.

### Current Behavior Note

As with the PATCH route, the resolver identity is accepted but not persisted by the repository.

### Response Shape

```json
{
  "meta": {
    "projectId": "...",
    "fingerprint": "...",
    "resolvedAt": "2026-04-29T00:00:00.000Z"
  },
  "data": {}
}
```

## 8. Analytics Health

```http
GET /analytics/:projectId/health
```

### Purpose

Checks whether the analytics repository and analytics cache are reachable.

### Flow

1. `authenticate` validates the caller.
2. Route extracts `projectId`.
3. Service checks database and cache in parallel:
   - Database health runs `SELECT 1` inside `withProjectContext(projectId)`.
   - Cache health sends `PING` to Redis and expects `PONG`.
4. Service returns:
   - `healthy` when both database and cache are connected.
   - `degraded` when either dependency fails.
5. Route responds with:
   - HTTP `200` when status is `healthy`.
   - HTTP `503` when status is `degraded`.

### Response Shape

```json
{
  "data": {
    "status": "healthy",
    "database": "connected",
    "cache": "connected",
    "checkedAt": "2026-04-29T00:00:00.000Z"
  }
}
```

## Error Responses

### Authentication Errors

Authentication failures return `401` or `403` from the shared auth middleware. Common codes include:

- `UNAUTHORIZED`
- `INVALID_TOKEN`
- `INVALID_TOKEN_TYPE`
- `SESSION_INVALID`
- `SESSION_EXPIRED`
- `SESSION_MISMATCH`
- `USER_NOT_FOUND`
- `ACCOUNT_SUSPENDED`

### Not Found Errors

Event and error-group detail/update routes return this shape when the target row does not exist:

```json
{
  "error": {
    "code": "EVENT_NOT_FOUND",
    "message": "Event not found",
    "requestId": "req-...",
    "timestamp": "2026-04-29T00:00:00.000Z"
  }
}
```

or:

```json
{
  "error": {
    "code": "ERROR_GROUP_NOT_FOUND",
    "message": "Error group not found",
    "requestId": "req-...",
    "timestamp": "2026-04-29T00:00:00.000Z"
  }
}
```

## Implementation Notes

- Analytics routes currently require authentication but do not call an explicit project membership middleware. Access control depends on valid authentication plus project-scoped database context/RLS behavior.
- List event cursors are base64url JSON objects containing `{ timestamp, id }`.
- Error group cursors are plain ISO timestamps from `last_seen`.
- Redis failures are non-fatal for normal read caching. The route falls back to repository reads.
- Cache invalidation for one project clears the whole in-memory LRU cache, then best-effort deletes Redis keys matching `analytics:*:<projectId>:*`.

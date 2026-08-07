# Enterprise Observability Backend Contract Audit

## Scope and implementation status

This document records the backend contract implemented from `planning/observibilityfix.md`. The frontend repository is separate (`SaasBackend/pulsiv_fe`); this audit covers the backend routes, query engine, repositories, Log DB schema, analytics read paths, and security boundaries.

The organization-scoped route is retained for compatibility:

```text
/organizations/:orgId/observability
```

The backend resolves authorization context from the authenticated session and control-plane membership. `projectId`, organization IDs, raw field projections, and live/projection controls are not public observability query parameters.

## Canonical GET query contract

All explorer list, summary, statistics, timeline, stream, and AI-list reads use the following public base parameters where applicable:

| Parameter | Meaning | Rules |
|---|---|---|
| `from` | Inclusive UTC start | Must be before `to`; retention-clamped |
| `to` | Exclusive UTC end | Defaults to server time; bounded by policy |
| `range` | Named range | `15m`, `1h`, `6h`, `24h`, `7d`, `30d`, `90d` |
| `search` | Free text or declared `key:value` search | Escaped, max 2,000 chars and five terms |
| `limit` | Page size | Integer, 1–200; server may use lower route caps |
| `cursor` | Signed keyset cursor | Resource/sort/scope/expiry bound |
| `direction` | Page direction | `forward` or `backward` |
| `sort` | `field:asc` or `field:desc` | Resource registry allow-list only |
| `environment` | Environment scope | Regex validated; server-side organization/project scope remains authoritative |

Rejected public controls include `projectId`, `project_id`, `organizationId`, `organization_id`, `orgId`, `org_id`, `fields`, and `live`. Structured `filters` remain supported internally through the canonical query builder but are validated against the resource registry and may not address arbitrary JSON paths.

Every successful list response uses the shared envelope:

```json
{
  "success": true,
  "items": [],
  "pagination": {
    "nextCursor": null,
    "previousCursor": null,
    "hasNext": false,
    "hasPrevious": false,
    "limit": 50,
    "direction": "forward"
  },
  "summary": {},
  "statistics": {},
  "appliedFilters": [],
  "availableFilters": [],
  "aggregations": {},
  "query": {
    "resource": "requests",
    "timeRange": { "from": "...", "to": "..." },
    "sort": { "field": "occurredAt", "direction": "desc" },
    "search": null
  },
  "states": { "empty": true }
}
```

Errors use `success: false` with a stable error code and no database details.

## Server-side tenant and project resolution

`ObservabilityContextResolver` resolves:

- authenticated user ID;
- active organization membership and role;
- organization plan/retention floor;
- visible project IDs from active organization admin membership or active project membership;
- environment context.

The resolved `QueryContext.allowedProjectIds` is authoritative. A non-empty list compiles to `project_id = ANY($n)`. An empty list compiles to `FALSE`. The engine never turns an empty authorization result into an unscoped organization query.

The route `orgId` remains a path context and is checked by `authenticate` plus `requireOrgAccess`. It is never accepted as a query filter. Repositories receive `QueryContext`, not independent client-provided tenant values.

## Endpoint inventory

### Discovery and resource endpoints

| Route | Controller | Service | Read behavior |
|---|---|---|---|
| `GET /organizations/:orgId/observability/navigation` | `navigation` | `getNavigation` | Static server-owned navigation |
| `GET /organizations/:orgId/observability/resources` | `resources` | `resourceNames` | Registry names |
| `GET /organizations/:orgId/observability/releases` | `releases` | `ObservabilityReleasesRepository.list` | Primary-DB releases, server-scoped by authorized projects |
| `GET /organizations/:orgId/observability/:resource/facets` | `facets` | `facets` | Registry-derived public filters; no DB read |

### Resource explorer endpoints

| Route | Controller | Service | Repository/query path |
|---|---|---|---|
| `GET /:resource` | `list` | `list` | Unified query engine, explicit registry projection, signed keyset pagination |
| `GET /:resource/summary` | `summary` | `summary` | Registry summary aggregate, shared scope predicates |
| `GET /:resource/statistics` | `statistics` | `statistics` | Registry statistics aggregate, shared scope predicates |
| `GET /:resource/timeline` | `timeline` | `timeline` | Time bucket aggregate with bounded limit |
| `GET /:resource/stream` | `stream` | `pollSince` | Bounded SSE polling through the same scoped query engine |
| `GET /:resource/:id` | `detail` | `detail` | Scoped detail lookup and correlated bundle |
| `GET /:resource/:id/related/:relation` | `related` | `related` | Scoped correlated relation fetch |

Supported canonical resources are `requests`, `errors`, `logs`, `metrics`, `traces`, `spans`, `crons`, `profiles`, `replays`, `sessions`, and `error-groups`. Replays are backed by `events_replays`; sessions are backed by `analytics_user_sessions`. Releases are exposed through the dedicated primary-database endpoint above. Deployments are not exposed because this schema has no authoritative deployment table; the navigation entry remains reserved for a future deployment source.

### Error-group endpoints

| Route | Controller | Service | Security behavior |
|---|---|---|---|
| `GET /error-groups` | `errorGroupList` | `list('error-groups')` | Shared query engine and project allow-list |
| `GET /error-groups/summary` | `errorGroupSummary` | `summary('error-groups')` | Shared scope |
| `GET /error-groups/:id` | `errorGroupDetail` | `getErrorGroupFullDetail` | Scoped group lookup |
| `GET /error-groups/:id/history` | `errorGroupHistory` | `getErrorGroupHistory` | Group joined to scoped `error_groups`; canonical response |
| `GET /error-groups/:id/events` | `errorGroupEvents` | `getErrorGroupEvents` | Scoped group lookup and events query |
| `PATCH /error-groups/:id/status` | `updateErrorGroupStatus` | `updateErrorGroupStatus` | Scoped transaction and audit history |
| `POST /error-groups/:id/resolve` | `updateErrorGroupStatus` | `updateErrorGroupStatus` | Same status state machine boundary |
| `POST /error-groups/:id/merge` | `mergeErrorGroups` | `mergeErrorGroup` | Deterministic lock order, scoped event reassignment, audit history |

### Analytics endpoints

`/analytics/v2` is the canonical dashboard aggregation API. Its dashboard repository reads rollup/state tables only and never reads `events_*`. The older `/analytics` module remains a compatibility surface and is still project-route based; its migration/deprecation is documented as follow-up work. Any project route must continue through `requireProjectMembership` before repository access.

## Canonical public field mapping

| Canonical field | Physical source | Notes |
|---|---|---|
| `occurredAt` | `occurred_at` | Canonical event time and default sort |
| `durationMs` | `duration_ms` | Canonical latency/duration |
| `statusCode` | `status_code` | Canonical HTTP status |
| `service` | `service` | Service identity |
| `applicationName` | `application_name` | Application identity |
| `applicationVersion` | `application_version` | Application version |
| `sdkName` | `sdk_name` | SDK identity |
| `sdkVersion` | `sdk_version` | SDK version |
| `browser` | `browser_family` | Request client dimension |
| `browserVersion` | `browser_version_major` | Request client dimension |
| `os` | `os_name` | Request client dimension |
| `osVersion` | `os_version_major` | Request client dimension |
| `device` | `device_type` | Request client dimension |
| `firstSeen` | `first_seen_at` | Error group display time |
| `lastSeen` | `last_seen_at` | Error group display time |
| `occurrenceCount` | `occurrence_count` | Error group count |

Removed public aliases include `status_code`, `occurred_at`, `timestamp`, `latency`, `latency_ms`, and duplicate error-group snake_case response keys. Physical snake_case names remain in SQL and storage for compatibility with ingestion.

## Public filters by resource

- **Requests:** environment, occurredAt, service, endpoint, method, statusCode, durationMs, release, sdkName, sdkVersion, browser, browserVersion, os, osVersion, device, isBot, isSlow, hasError, traceId, requestId, userId, search.
- **Errors:** environment, occurredAt, service, route, errorName, errorGroupId, fingerprint, statusCode, severity, handled, release, traceId, requestId, search.
- **Logs:** environment, occurredAt, level, logCategory, logSource, logger, loggerName, endpoint, httpMethod, statusCode, durationMs, service, traceId, requestId, search.
- **Metrics:** environment, occurredAt, metricName, metricType, metricUnit, metricNamespace, metricCategory, aggregationType, temporality, isMonotonic, value, endpoint, httpMethod, statusCode, service, traceId, search.
- **Traces:** environment, occurredAt, rootSpanName, rootSpanId, rootSpanStatus, spanKind, endpoint, httpMethod, statusCode, spanCount, totalDurationMs, isPartial, service, traceId, requestId, search.
- **Spans:** environment, occurredAt, spanKind, spanType, spanStatus, endpoint, durationMs, dbSystem, dbName, dbOperation, httpMethod, httpRoute, httpStatusCode, messagingSystem, traceId, requestId, search.
- **Crons:** environment, occurredAt, monitorSlug, monitorName, status, isSuccess, durationMs, checkinType, scheduleType, service, traceId, requestId, search.
- **Profiles:** environment, occurredAt, profileType, startTime, endTime, durationMs, service, requestId, search.
- **Replays:** environment, occurredAt, sessionId, requestId, name, service, endpoint, release, severity, durationMs, search.
- **Sessions:** environment, startedAt, endedAt, sessionId, durationMs, isCrashed, search.
- **Error groups:** status, fingerprint, occurrenceCount, firstSeen, lastSeen, severity, regression, release, last error name/message, with all group reads scoped by server-resolved projects.

Advanced JSON paths and arbitrary payload scans are not public filters. Internal consumers may use server-owned fields only.

## Internal-only fields

Never expose as normal facets, list projections, or client filters:

- organization/project primary IDs;
- API key names and API key IDs;
- raw user IDs where the resource does not require them;
- raw IPs, IP hashes, user-agent payloads, and sensitive attributes unless a dedicated policy permits them;
- `created_at`/`ingested_at` storage timestamps for normal event exploration;
- raw `attributes`, `metadata`, `payload`, `ai_response`, stack/debug payloads, and partition metadata;
- worker, queue, ingestion-failure, retention, watermark, and database implementation columns;
- internal cursor columns `__id` and `__t`.

Detail assembly may read internal correlation keys, but `projectPublicRow` controls what leaves the backend.

## Database and migration audit

The authoritative telemetry schema is `database/migrations/logdb`:

- canonical event tables are range-partitioned by event time;
- session tables are range-partitioned by `started_at`;
- analytics rollups are range-partitioned by `bucket`;
- BRIN indexes support broad time scans;
- organization/project/environment/time B-tree indexes support dashboard windows;
- GIN indexes exist for selected JSONB storage and are no longer exposed as arbitrary public query paths;
- analytics workers use `ingested_at` watermark indexes and rollup tables rather than aggregating raw telemetry in dashboard requests.

The additive migration `database/migrations/logdb/03_observability_v2/019_observability_query_contract.sql` adds:

- organization/project/status/time and organization/project/occurrence indexes for error groups;
- group history lookup support;
- replay session/time access support;
- session organization/project/time and session-ID/time access support;
- a schema note recording the canonical query contract.

The primary `src/db/postgres/canonical_migrations_draft/14_observability` files are intentionally inert because Log DB owns telemetry. Generated primary migration files were not edited for this contract change.

## Query and security controls

- All SQL values are parameterized.
- Table names and expressions come from server-owned resource registries or static analytics catalogs.
- Unknown resource, field, operator, sort field, cursor, and JSON path inputs fail closed.
- Search wildcards are escaped; term and filter counts are bounded.
- Cursor tokens are HMAC-signed with `AUTH_TOKEN_SECRET`, versioned, expiry-aware, and bound to resource, sort, query window, filters, environment, organization, project scope, and authorized project set.
- Pagination is keyset-based; no `OFFSET` path is used by the explorer engine.
- Time windows are retention-clamped and half-open.
- Empty authorized project lists produce `FALSE` predicates.
- Error-group history, related events, stack frames, trends, status updates, merges, and event reassignment all enforce organization/project scope.
- Merge locks are acquired in deterministic ID order.
- Public projections are explicit; `SELECT *` was removed from the observability repository paths changed by this implementation.

## Compatibility and breaking-change assessment

Breaking changes:

1. Observability explorer requests containing `projectId` or equivalent tenant query keys are rejected.
2. Client-selected `fields` and `live` query controls are rejected.
3. Duplicate snake_case/camelCase response aliases are removed from canonical error-group responses.
4. Unsigned explorer cursors are invalid and must be regenerated by the client.
5. `timestamp`/`occurred_at`/`latency` aliases are no longer canonical public filter names.

Compatibility retained:

- `/organizations/:orgId/observability` route shape;
- physical database columns used by ingestion and workers;
- server-owned project route handling in the legacy analytics compatibility module;
- existing error status input normalization at the controller boundary.

Frontend migration requirement:

- stop manually sending `projectId` to observability endpoints;
- use `from`, `to`, `search`, `limit`, `cursor`, `sort`, `direction`, and `environment`;
- persist the canonical query state in URLs and regenerate cursors after filter/scope changes;
- consume canonical response keys only.

## Verification commands

Run from the backend repository:

```text
npm run build
npm run lint
npm test -- --run test/unit/observability-query-engine.test.ts
npm test -- --run test/unit/analytics-engine-read.test.ts
npm run db:migrate:logdb -- --dry-run
```

Integration verification should apply Log DB migrations to a clean database and prove:

- visible project scope is enforced;
- empty project scope returns no rows;
- cross-project event/group/history/detail access is denied;
- signed cursor tampering and cross-query replay fail;
- partition-pruned time queries use expected indexes;
- dashboard reads remain rollup-only.

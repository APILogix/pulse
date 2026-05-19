# Ingestion Module Enterprise Audit

## Scope

Reviewed source files:

- `src/modules/ingestion/ingestion.module.ts`
- `src/modules/ingestion/routes.ts`
- `src/modules/ingestion/controller.ts`
- `src/modules/ingestion/service.ts`
- `src/modules/ingestion/buffer.ts`
- `src/modules/ingestion/postgress.writter.ts`
- `src/modules/ingestion/types.ts`
- `src/workers/ingestion.processor.ts`
- `src/workers/main.ts`
- `src/workers/index.ts`
- `src/db/redis/cache.ts`
- `src/db/redis/keys.ts`
- `src/config/lrucashe.ts`
- `src/db/postgres/schema3.sql`
- `src/db/postgres/schema4log.sql`
- ingestion tests under `test/unit/modules/ingestion.service.test.ts` and `test/integration/ingestion.test.ts`

Mounted prefix: `/api`.

## Executive Summary

The ingestion module has the correct high-level architecture for a serious SaaS telemetry pipeline:

1. SDK sends API key and events to HTTP ingestion.
2. API key is hashed and resolved to project/org through Redis first, then Postgres.
3. Project-level rate limits are enforced in Redis.
4. Idempotency is enforced in Redis.
5. Accepted events go into an in-memory buffer.
6. Buffer flushes to BullMQ.
7. Worker persists events into Postgres.
8. Failed jobs remain in BullMQ failed-job storage and can be reprocessed through DLQ routes.

But it is not enterprise-grade yet. There are critical correctness gaps around event type support, validation, persistence transactions, data loss behavior, observability, cache consistency, and tenant authorization for admin/read/debug routes.

The most important issue: TypeScript accepts `request`, `error`, `log`, `metric`, and `custom`, but `schema4log.sql` defines the `events.type` check as only `error`, `request`, and `custom`. Unless the live DB has a different migration, `log` and `metric` events are accepted by HTTP and then fail later in the worker. There are also no dedicated `log_events`, `metric_events`, or `custom_events` tables.

## Current Route Catalog

| Route | Status | Purpose | Enterprise Notes |
| --- | --- | --- | --- |
| `POST /api/v1/init` | Present, schema disabled | SDK bootstrap by API key. | Should validate body and never log raw API key. |
| `POST /api/v1/ingest` | Present, schema disabled | Generic mixed-event ingestion. | Currently accepts raw body without Fastify schema. High risk. |
| `POST /api/v1/ingest/requests` | Present | Request-only ingestion. | Schema is generic, not request-specific. |
| `POST /api/v1/ingest/errors` | Present | Error-only ingestion. | Schema is generic, not error-specific. |
| `POST /api/v1/ingest/logs` | Present | Log-only ingestion. | DB support appears incomplete. |
| `POST /api/v1/ingest/metrics` | Present | Metric-only ingestion. | DB support appears incomplete. |
| `GET /api/v1/health` | Present | Public dependency health. | Returns Redis/Postgres/queue state. Good base. |
| `GET /api/v1/ingest/health` | Present, authenticated | Queue and buffer health. | Needs role/org authorization, not only auth. |
| `GET /api/v1/limits` | Present, authenticated | Limits by API key. | Uses query API key, which is sensitive. |
| `GET /api/v1/errors` | Present, authenticated | List error events by project. | Needs project membership authorization. |
| `GET /api/v1/errors/:errorId` | Present, authenticated | Fetch one error event. | Needs project membership authorization. |
| `GET /api/v1/dlq` | Present, authenticated | List failed BullMQ jobs. | Should be platform-admin only. Can expose payloads/API data. |
| `POST /api/v1/dlq/reprocess/:jobId` | Present, authenticated | Retry one failed job. | Should be platform-admin only and audited. |
| `POST /api/v1/dlq/reprocess-all` | Present, authenticated | Retry many failed jobs. | Needs confirmation/idempotency/rate limit. |
| `POST /api/v1/replay` | Present, authenticated | Replay historical events. | Needs project admin/platform permission and replay tracking. |
| `GET /api/v1/debug/events/:id` | Present, authenticated | Inspect raw event and child details. | Should be platform support or org admin with audit. |

## End-to-End Flow Assessment

### What Works

- API keys are hashed before lookup.
- Redis is used as the hot API-key/project lookup path.
- Postgres fallback exists on cache miss.
- Rate limiting is project-scoped.
- Idempotency exists before queue write.
- Buffer uses BullMQ `jobId = event.id` for another duplicate guard.
- Worker retry and failed-job retention are configured.
- Health endpoints check Redis, database, and queue.
- DLQ reprocess and replay routes exist.

### Critical Problems

| Severity | Problem | Impact | Recommended Fix |
| --- | --- | --- | --- |
| Critical | `log` and `metric` event types are accepted in TypeScript and routes, but SQL `events.type` only allows `error`, `request`, `custom`. | Accepted log/metric events can fail asynchronously in the worker. SDK receives `202` but data is lost to retries/DLQ. | Update DB schema/migrations to include `log` and `metric`, or remove those routes until storage exists. |
| Critical | Generic `/v1/ingest` and `/v1/init` have schemas commented out. | Invalid/malicious payloads can reach service and throw runtime errors. | Enable schemas and add strict event-specific schemas. |
| Critical | Request/error child writes are not atomic with base event writes. `writeRequestEvents()` starts a transaction, then calls `writeEvents()` which opens a separate connection and transaction. | Base event can commit while child insert fails, causing orphan/incomplete event graphs. | Refactor writer so one transaction and one client inserts base and child rows together. |
| Critical | Debug `console.log` statements log API keys, request bodies, full events, and payloads. | Sensitive customer telemetry and credentials can leak into logs. | Remove all console logs. Use structured logger with redaction. |
| High | No project/org authorization on read/debug/replay/error routes beyond `authenticate`. | Any authenticated user may query project IDs if not blocked elsewhere. | Require org membership and project access for every project-scoped route. |
| High | In-memory buffer can drop events under backpressure after HTTP already returned accepted. | Silent data loss under queue outage or Redis outage. | Introduce durable pre-queue spool or fail closed when queue/buffer unavailable. |
| High | `writeEvents()` lacks `ON CONFLICT`, despite comment claiming it protects retries. | Worker retries/replay can fail on duplicate IDs and keep jobs in DLQ. | Add `ON CONFLICT (id) DO NOTHING` or deterministic upsert behavior. |
| High | Rate limiting counts batches, not events. | A client sending 1,000 events per request consumes the same rate as one event. | Rate limit by event count and byte size, not only request count. |
| High | Redis API-key cache TTL is fixed at one hour on fallback and may outlive key revocation/expiry unless invalidated everywhere. | Revoked/expired keys can remain accepted until cache expires if invalidation misses. | TTL should be min(default, key expiry), and key mutation paths must invalidate Redis. |
| Medium | Tests for ingestion are empty in inspected files. | Route and worker regressions are likely. | Add unit/integration tests for every route and worker path. |

## Missing Event Problems

### Event Type Coverage

Current TypeScript event union:

- `request`
- `error`
- `log`
- `metric`
- `custom`

Current DB support found in `schema4log.sql`:

- base `events` table: `error`, `request`, `custom`
- specialized table: `request_events`
- specialized table: `error_events`
- no `log_events`
- no `metric_events`
- no `custom_events`

This creates three categories:

| Event Type | HTTP Accepts | Worker Writes | DB Specialized Table | Problem |
| --- | --- | --- | --- | --- |
| `request` | Yes | `events` + `request_events` | Yes | Supported, but transaction bug exists. |
| `error` | Yes | `events` + `error_events` | Yes | Supported, but transaction bug exists. |
| `custom` | Yes | `events` only | No | Basic storage only; no query/index model. |
| `log` | Yes | `events` only | No | Likely DB check failure because SQL does not allow `log`. |
| `metric` | Yes | `events` only | No | Likely DB check failure because SQL does not allow `metric`. |

### Missing Event Types for Enterprise Monitoring

For enterprise-grade API/application monitoring, the ingestion model is missing several common telemetry categories:

| Missing Event Type | Why It Matters |
| --- | --- |
| `trace` / `span` | Distributed tracing and service dependency analysis. |
| `transaction` | User action or backend workflow timing. |
| `deployment` | Correlate errors/performance to releases. |
| `release` | Version-aware grouping, source maps, regression analysis. |
| `session` | Frontend/session health and user impact. |
| `breadcrumb` | Context around errors. |
| `profile` | CPU/memory/profile samples. |
| `uptime_check` | Synthetic and uptime monitoring. |
| `security` | API abuse, invalid key attempts, suspicious ingestion activity. |
| `heartbeat` | SDK/client liveness and project setup validation. |

### Missing Fields in Existing Event Types

Request events should add:

- `durationMs` naming consistency instead of only `latency`
- `route` or normalized path template
- `statusClass`
- `requestSizeBytes`
- `responseSizeBytes`
- `ipAddress`
- `userAgent`
- `traceId`
- `spanId`
- `parentSpanId`
- `serviceName`
- `serviceVersion`
- `environment`
- `region`
- `samplingRate`

Error events should add:

- `exception.type`
- `exception.value`
- `mechanism`
- `handled`
- `severity`
- `release`
- `environment`
- `traceId`
- `spanId`
- `breadcrumbs`
- `tags`
- `user`
- `serverName`
- `runtime`
- `platform`

Log events should add:

- `logger`
- `severityNumber`
- `traceId`
- `spanId`
- `attributes`
- `resource`
- `serviceName`

Metric events should add:

- metric kind: `counter`, `gauge`, `histogram`, `summary`
- points array
- dimensions/tags
- aggregation temporality
- monotonic flag
- unit normalization

Custom events should add:

- `name`
- `category`
- `properties`
- `tags`
- schema version

## Redis Usage

The ingestion module creates a dedicated Redis connection in `ingestion.module.ts` because BullMQ requires `maxRetriesPerRequest: null`.

### Redis-backed Functions

| Code Path | Redis Key | Purpose | TTL |
| --- | --- | --- | --- |
| API key/project lookup | `ingest:apikey:{keyHash}` | Cache API key hash to project config. | 1 hour |
| Rate limit second window | `ingest:ratelimit:{projectId}:1s` | Sliding window per project. | window seconds |
| Rate limit minute window | `ingest:ratelimit:{projectId}:60s` | Sliding window per project. | window seconds |
| Idempotency | `ingest:idempotency:{eventId}` | Prevent duplicate event acceptance. | 24 hours |
| Circuit breaker state | `ingest:circuit:{service}` | Mark database circuit open. | 30 seconds |
| Circuit failure count | `ingest:circuit:{service}:failures` | Count failures in rolling window. | 60 seconds |
| Metrics counter | `ingest:metrics:{projectId}:{date}:{type}` | Ingest counter. | 7 days |
| Last ingest | `ingest:last:{projectId}` | Recent ingestion heartbeat. | 15 seconds |
| BullMQ keys | BullMQ-managed | Queue, retries, failed jobs. | BullMQ config |

### Redis Gaps

- `cacheEvent()` and `getCachedEvent()` exist but are unused.
- `projectConfig`, `ingestionStats`, `replayJob`, and `replayProgress` keys exist but are unused.
- No Redis invalidation is visible in ingestion when a project status changes. Projects service warms cache after key creation, but key disable/rotate/revoke must invalidate old hashes consistently.
- Rate limiting uses project ID only. It should support project + API key + IP dimensions.
- Idempotency uses only event ID globally. It should include project ID to avoid cross-project collisions if clients generate overlapping IDs.
- Ingest counters increment by one per accepted batch, not by accepted events, because `incrementIngestCounter(project.id, 'total')` is called once per batch.
- There is no Redis-based replay progress even though key names exist.

## In-Process Cache / LRU Usage

There is an LRU cache in `src/config/lrucashe.ts`:

```ts
export const apiKeyCache = new LRUCache<string, any>({
  max: 5000,
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: true,
  allowStale: false
});
```

Current usage:

- `src/modules/projects/service.ts` imports `apiKeyCache`.
- Project API-key creation stores project config in both Redis and LRU.
- Ingestion service does not import or read `apiKeyCache`.

Conclusion:

The LRU cache currently does not speed up ingestion API-key lookup. It is warmed by project key creation but unused by the hot ingestion path. Ingestion reads Redis first, then Postgres.

Recommendation:

Either remove the LRU cache from project key creation to avoid misleading behavior, or explicitly add it as the first ingestion lookup layer:

```text
LRU -> Redis -> Postgres -> fill Redis + LRU
```

If added, invalidation must happen on key revoke/disable/rotate/project pause/archive.

## Persistence and Schema Gaps

### Base Event Table

Problems:

- SQL type check does not include `log` or `metric`.
- No org_id column in base events, even though enriched events carry `orgId`.
- No batch_id column, even though enriched events carry `batchId`.
- No SDK metadata columns such as SDK version, source, environment, release, service name.
- `timestamp <= NOW() + INTERVAL '1 minute'` may reject clients with clock skew. Good to prevent bad data, but needs clear SDK error handling.
- No payload size limit at schema or route level.

### Request Events

Problems:

- `request_id` is typed UUID. Many SDKs generate trace/request IDs that are not UUIDs.
- `user_agent` is populated with `JSON.stringify(headers)`, not actual user agent.
- `headers` and `query` are accepted by SDK type but not stored in request_events except headers incorrectly mapped to `user_agent`.
- No response size.
- No normalized route/path.
- No IP address from client metadata.

### Error Events

Problems:

- `name` can be `string | Record`, but schema says string and writer maps non-string to `UnknownError`.
- `metadata` is hard-coded to `{ sdkVersion: 'unknown' }`, ignoring request metadata.
- No severity/handled/release/environment fields.
- Stack is forced to array of strings; JS error stack is often string.

### Logs and Metrics

Problems:

- No specialized tables.
- No query APIs.
- No aggregation strategy.
- Metrics should probably flow to ClickHouse or a time-series optimized store, but ingestion currently writes only to Postgres.

## Queue, Buffer, and Worker Assessment

### Good

- Buffer flushes by size or timer.
- BullMQ bulk enqueue reduces overhead.
- Job IDs use event IDs for queue idempotency.
- Worker has retries and failed-job retention.
- Worker uses a circuit breaker to avoid hammering Postgres during outage.

### Problems

- API returns `202` once data reaches in-memory buffer, not durable queue. If process crashes before flush, accepted events are lost.
- If BullMQ is down, buffer can grow and later drop old events.
- Worker processes one event per job, which can be expensive at scale. The buffer batches into `addBulk`, but workers still persist single events.
- Writer methods accept arrays but worker passes one event at a time.
- Worker logs every completed job with `console.log`, which will be too noisy at enterprise ingestion volume.
- No queue lag SLO, alerting, or metrics export.
- No poison-message classification beyond BullMQ failure.
- No permanent archive of failed payloads outside Redis/BullMQ retention.

## Security and Authorization Gaps

### Public Ingestion Endpoints

Public SDK endpoints must remain unauthenticated by user session, but they need stronger API-key controls:

- no raw API key logging
- key prefix and hash only in logs
- optional IP allowlist per key
- origin/app domain allowlist for browser keys
- key scope and allowed event types from DB, not hard-coded
- key environment enforcement
- key usage counter and last-used IP update
- invalid key attempt logging
- abuse/security event generation

### Authenticated Operational Endpoints

The following routes are only protected by `authenticate`, but should require project/org/platform authorization:

- `GET /api/v1/ingest/health`
- `GET /api/v1/limits`
- `GET /api/v1/errors`
- `GET /api/v1/errors/:errorId`
- `GET /api/v1/dlq`
- `POST /api/v1/dlq/reprocess/:jobId`
- `POST /api/v1/dlq/reprocess-all`
- `POST /api/v1/replay`
- `GET /api/v1/debug/events/:id`

Enterprise-grade policy:

- error list/detail: org member with project access
- debug event: org admin/security or platform support
- replay: org admin/security or platform support, audited
- DLQ: platform admin only
- limits: avoid query API key; use project/key ID and permissions

## Missing Enterprise Routes

### Ingestion Write Routes

| Missing Route | Purpose |
| --- | --- |
| `POST /api/v1/ingest/traces` | Distributed tracing spans. |
| `POST /api/v1/ingest/transactions` | User/backend transaction timings. |
| `POST /api/v1/ingest/releases` | Release/deploy markers. |
| `POST /api/v1/ingest/sessions` | Session/user-impact tracking. |
| `POST /api/v1/ingest/heartbeats` | SDK/project liveness validation. |
| `POST /api/v1/ingest/security` | Security/abuse telemetry from SDK or edge. |

### Ingestion Admin Routes

| Missing Route | Purpose |
| --- | --- |
| `GET /api/v1/projects/:projectId/ingestion/stats` | Project ingestion volume, rejects, latency, last ingest. |
| `GET /api/v1/projects/:projectId/ingestion/rejections` | Invalid event/key/rate-limit rejection history. |
| `GET /api/v1/projects/:projectId/ingestion/schema` | Effective accepted event schema. |
| `GET /api/v1/projects/:projectId/ingestion/keys/:keyId/usage` | Usage per API key. |
| `POST /api/v1/projects/:projectId/ingestion/test-event` | Controlled test event for onboarding. |
| `GET /api/v1/replays/:replayId` | Replay status/progress. |
| `POST /api/v1/replays/:replayId/cancel` | Cancel active replay. |

### Query Routes for Missing Event Types

| Missing Route | Purpose |
| --- | --- |
| `GET /api/v1/logs` | List/search log events. |
| `GET /api/v1/metrics` | Query metric series. |
| `GET /api/v1/traces/:traceId` | Trace waterfall/detail. |
| `GET /api/v1/requests/:requestId/events` | Correlate request, logs, errors, spans. |

## Enterprise Readiness Checklist

### P0 Fixes

1. Remove all ingestion `console.log` statements that print API keys, bodies, events, and payloads.
2. Enable validation schemas on `/v1/init` and `/v1/ingest`.
3. Fix DB event type support for `log` and `metric`, or disable those endpoints.
4. Make base event + child event inserts atomic on one transaction/client.
5. Add project/org authorization to all read/debug/replay routes.
6. Add `ON CONFLICT` behavior for event inserts.
7. Add integration tests that verify accepted events are actually persisted.
8. Add tests for log/metric ingestion to catch the current schema mismatch.

### P1 Fixes

1. Rate limit by events and bytes, not just requests.
2. Add payload byte limits and field-level size limits.
3. Include project ID in idempotency key.
4. Store and expose rejection reasons for invalid payloads.
5. Persist invalid key attempts and rate-limit events to security/audit tables.
6. Make API-key cache TTL respect key expiration.
7. Invalidate Redis and LRU caches on key/project lifecycle mutations.
8. Add queue lag, flush failure, DLQ count, and persistence latency metrics.

### P2 Maturity

1. Add dedicated storage/query paths for logs, metrics, traces, and custom events.
2. Move high-volume analytics to ClickHouse or another columnar/time-series store.
3. Add replay progress tracking using the existing Redis replay keys.
4. Add data retention workers per plan/org settings.
5. Add schema versioning and SDK compatibility negotiation.
6. Add payload compression handling for gzip/zstd.
7. Add multi-region ingestion and regional routing if enterprise data residency matters.

## Recommended Target Architecture

Short term:

```text
HTTP ingestion
  -> strict schema validation
  -> API key LRU/Redis/Postgres resolution
  -> project/key/org policy
  -> event-count and byte rate limits
  -> Redis idempotency scoped by project
  -> durable queue
  -> worker batch persistence
  -> Postgres events + child tables
```

Medium term:

```text
HTTP ingestion
  -> durable queue/spool before ACK
  -> stream processor
  -> Postgres for canonical/debug/error groups
  -> ClickHouse for high-volume analytics/logs/metrics/traces
  -> Redis for hot auth/rate/idempotency only
```

Enterprise operating principle:

Do not return `202 Accepted` until the event is safely durable enough for the product promise. If the promise is "best effort", document it. If the promise is "enterprise monitoring", queue durability must come before success response.

## Final Recommendation

The ingestion module is a solid prototype of the right pipeline, but not yet enterprise-grade.

The immediate blockers are event type mismatch, disabled schemas, sensitive logging, non-atomic writer transactions, missing authorization on operational routes, and lack of real tests. Fix those before adding more event types. After that, add dedicated storage/query support for logs, metrics, traces, releases, and sessions.

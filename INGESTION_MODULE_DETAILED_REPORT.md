# Ingestion Module Detailed Report

## Scope

This report analyzes the ingestion module in `pulse/src/modules/ingestion` and the dedicated ingestion worker pipeline that processes queued telemetry.

Primary files reviewed:

- `src/modules/ingestion/ingestion.module.ts`
- `src/modules/ingestion/routes.ts`
- `src/modules/ingestion/controller.ts`
- `src/modules/ingestion/service.ts`
- `src/modules/ingestion/types.ts`
- `src/modules/ingestion/postgress.writter.ts`
- `src/modules/ingestion/rate-limiter.ts`
- `src/modules/ingestion/usage/usage-counter.ts`
- `src/modules/ingestion/queue/ingest-queues.ts`
- `src/modules/ingestion/workers/worker-registry.ts`
- `src/modules/ingestion/workers/event-processor.ts`
- `src/modules/ingestion/workers/usage-rollup.ts`
- `src/modules/ingestion/pipeline/event-normalizer.ts`
- `src/modules/ingestion/pipeline/telemetry-writer.ts`
- `src/shared/workers/ingestion-worker-main.ts`

## Executive Summary

The ingestion module is implemented as a two-stage pipeline:

1. API gateway stage:
   - receives SDK/admin ingestion requests
   - resolves API keys and project context
   - applies request validation, endpoint permissions, event-type permissions, rate limiting, quota checks, and queue backpressure
   - does not persist raw telemetry directly
   - enqueues raw events into per-type `pg-boss` queues

2. Worker stage:
   - runs in a dedicated ingestion worker process
   - fully validates and normalizes each event
   - generates deterministic event IDs when missing
   - writes valid events to typed `events_*` tables
   - sends invalid or exhausted jobs to dead-letter intake
   - stages usage counters for later rollup

This is a sound architecture for high-throughput ingestion. The most important practical observation is that the API process is intentionally lightweight, and the worker is the real ingestion engine.

## High-Level Flow

### 1. Module registration

`ingestion.module.ts` registers the module as a Fastify plugin, creates a `PostgresWriter`, decorates `fastify.postgresWriter`, and mounts ingestion routes under `/api`.

### 2. Request entry

Routes are defined in `routes.ts`. Most ingestion writes enter through:

- `POST /api/v1/ingest`
- `POST /api/v1/ingest/requests`
- `POST /api/v1/ingest/errors`
- `POST /api/v1/ingest/logs`
- `POST /api/v1/ingest/metrics`

The route scope also installs gzip request-body decompression with a size guard using `INGESTION_GZIP_MAX_BYTES`.

### 3. Controller layer

`controller.ts` is a thin adapter over `IngestionService`. It converts service errors into HTTP responses and returns `202 Accepted` for ingest operations once work is successfully queued.

### 4. Service layer

`service.ts` is the gateway control plane. It:

- validates request envelope
- resolves API key to project/org/environment context
- checks project status and API key constraints
- enforces per-project and per-org rate limits
- performs quota pre-checks
- checks queue depth and may shed load
- performs light per-event validation
- groups events by type
- chunks them into queue jobs
- enqueues one or more `pg-boss` jobs
- records request-side usage counters

### 5. Queue dispatch

`queue/ingest-queues.ts` maps each event type to a dedicated queue and computes job priority from:

- billing plan tier
- event urgency
- fairness defer count

### 6. Worker processing

The dedicated worker process starts in `src/shared/workers/ingestion-worker-main.ts`, builds a `WorkerRegistry`, and consumes per-type ingestion queues.

Each queued job is handled by `workers/event-processor.ts`, which:

- normalizes and validates each event using `event-normalizer.ts`
- generates deterministic IDs for events that lack `eventId`
- dead-letters rejected events
- writes valid rows through `TelemetryWriter`
- updates error-group analytics for inserted error events
- increments worker-side usage counters only for successful inserts

### 7. Usage rollup

Usage counters are buffered into `usage_counter_staging`. `workers/usage-rollup.ts` periodically rolls staging data into durable billing/reporting tables.

## Route Inventory

All routes are mounted under `/api`.

### Public/SDK-facing routes

#### `POST /v1/init`

Purpose:
- SDK bootstrap/init endpoint

Behavior:
- validates API key
- returns project-level SDK configuration such as endpoint, batch size, flush interval, and queue size

#### `POST /v1/ingest`

Purpose:
- generic ingestion endpoint for mixed event batches

Behavior:
- accepts multiple supported event types in one request
- returns `202` after enqueue

#### `POST /v1/ingest/requests`

Purpose:
- typed request-event ingestion endpoint

Behavior:
- forces all incoming events to `request`

#### `POST /v1/ingest/errors`

Purpose:
- typed error-event ingestion endpoint

Behavior:
- forces all incoming events to `error`

#### `POST /v1/ingest/logs`

Purpose:
- typed log-event ingestion endpoint

Behavior:
- forces all incoming events to `log`

#### `POST /v1/ingest/metrics`

Purpose:
- typed metric-event ingestion endpoint

Behavior:
- forces all incoming events to `metric`

#### `GET /v1/health`

Purpose:
- public health check

Behavior:
- checks DB connectivity
- checks `pg-boss` job table availability
- reports ingestion subsystem status

#### `GET /v1/limits`

Purpose:
- returns ingestion limits for an API key

Behavior:
- reads API key from headers
- returns resolved plan/rate-limit settings

### Authenticated product/admin routes

#### `GET /v1/ingest/health`

Purpose:
- operational ingestion health

Access:
- authenticated

Behavior:
- returns queue depth, queue stats, dead-letter counts, limiter sizes, quota cache size, and backpressure thresholds

#### `GET /v1/usage`

Purpose:
- project usage lookup

Access:
- authenticated
- requires project membership from query

Behavior:
- reads `project_usage_realtime`

#### `GET /v1/errors`

Purpose:
- list stored error events

Access:
- authenticated
- requires project membership from query

#### `GET /v1/errors/:errorId`

Purpose:
- fetch one stored error event

Access:
- authenticated
- requires project membership

#### `GET /v1/dlq`

Purpose:
- inspect dead-letter queue records

Access:
- authenticated admin

#### `POST /v1/dlq/reprocess/:jobId`

Purpose:
- requeue one dead-letter job

Access:
- authenticated admin

#### `POST /v1/dlq/reprocess-all`

Purpose:
- bulk requeue dead-letter jobs

Access:
- authenticated admin

#### `POST /v1/replay`

Purpose:
- replay historical events back into the ingestion queues

Access:
- authenticated admin
- requires project membership from body

Behavior:
- reads historical stored events
- re-enqueues them grouped by type

#### `GET /v1/debug/events/:id`

Purpose:
- fetch a stored event for debugging

Access:
- authenticated
- requires project membership

## How Ingestion Works

## Step 1: Request envelope validation

Before queueing, `IngestionService` validates:

- request object exists
- API key exists
- events array exists
- events array is not empty
- batch size is within `INGESTION_MAX_BATCH_SIZE`

Typical error outcomes:

- `INVALID_REQUEST`
- `EMPTY_BATCH`
- `BATCH_TOO_LARGE`

## Step 2: API key resolution

`PostgresWriter.resolveApiKey()`:

- extracts the public key prefix
- hashes the provided API key
- selects candidate rows from `project_api_keys`
- performs constant-time hash comparison
- resolves project, org, environment, permissions, endpoint restrictions, event-type restrictions, SDK config, and plan tier

Important detail:

- the request path does not trust API keys by string equality alone
- it compares SHA-256 secret hashes in constant time

## Step 3: Project and key state enforcement

The service rejects ingestion if:

- project is inactive
- API key is invalid
- API key permissions do not allow ingestion
- endpoint is explicitly blocked
- endpoint is not in the allowlist when an allowlist exists

Representative service errors:

- `INVALID_API_KEY`
- `PROJECT_INACTIVE`
- `API_KEY_PERMISSION_DENIED`
- `API_KEY_ENDPOINT_DENIED`

## Step 4: Event-type gating

The service checks each event type against:

- supported SDK event types
- API key allowed event types, if configured

Unsupported or disallowed types are rejected before queueing.

## Step 5: Rate limiting

The gateway uses `IngestionRateLimiter`, an in-process synchronous token-bucket style limiter.

Key properties:

- process-local only
- atomic check-and-increment within the Node event loop
- per-second and per-minute counters
- stale bucket sweeping
- max-entry cap with oldest-bucket eviction

Rate limiting is applied at least at:

- project scope
- org scope

Important architectural point:

- this is intentionally not a globally exact distributed limiter
- it is designed to cheaply shed obvious overload on the hottest path

## Step 6: Quota pre-check

The service performs an org quota pre-check against `organization_usage_current_period`.

Behavior:

- cached
- fail-open on lookup problems
- returns `QUOTA_EXCEEDED` when org usage is already above allowance

HTTP behavior:

- mapped to `429`
- sets `Retry-After: 60`

## Step 7: Queue backpressure and shedding

The service checks ingestion queue depth using `ingestQueueDepth()`.

When queue depth exceeds configured thresholds, `shouldShed()` may reject requests based on:

- plan tier
- event urgency

Observed policy:

- under critical pressure, higher tiers and urgent event types get priority
- `error`, `message`, and `cron_checkin` are treated as the highest urgency
- lower-tier, lower-urgency traffic is shed first

This is a deliberate quality-of-service policy, not a bug.

## Step 8: Light per-event validation in gateway

Before queueing, the gateway performs only basic checks:

- each item is an object
- each item has a known event type
- event payload size is within a cap

Important design detail:

- full schema validation is intentionally deferred to the worker
- the API path optimizes for fast acceptance and queueing

## Step 9: Grouping and enqueueing

Accepted events are grouped by event type, then chunked by `INGESTION_JOB_CHUNK_SIZE`.

Each chunk is sent as one queue job to a type-specific queue:

- `ingest.error`
- `ingest.message`
- `ingest.request`
- `ingest.span`
- `ingest.trace`
- `ingest.metric`
- `ingest.log`
- `ingest.profile`
- `ingest.cron_checkin`
- `ingest.replay`

Jobs carry project/org context and replay/fairness metadata needed by workers.

## Step 10: Request-side usage accounting

After enqueue, the gateway increments buffered usage counters such as:

- `requests`
- `bytes_ingested`
- `errors`
- `rate_limited`

This is not the final event-billing truth. Final inserted-event accounting happens in the worker after persistence.

## How Different Event Types Are Handled

## Canonical event types

The real supported event type set comes from `pipeline/event-normalizer.ts`, not from the narrower legacy TypeScript union in `types.ts`.

Canonical supported event types:

- `error`
- `message`
- `request`
- `span`
- `trace`
- `metric`
- `log`
- `profile`
- `cron_checkin`
- `replay`

Important finding:

- `types.ts` still presents a narrower `SDKEvent` union centered on `request`, `error`, `log`, and `metric`
- that does not reflect the full runtime capability of the ingestion pipeline

This is a documentation/type-drift issue worth fixing.

## Event normalization and validation

`normalizeEvent(raw)` in `event-normalizer.ts` is the real event validation boundary.

It:

- rejects non-objects
- normalizes metric payload naming such as `metric.name -> metricName`
- rejects unknown types
- validates using a discriminated union of Zod schemas
- resolves/clamps timestamps

Future timestamps are clamped to near-now tolerance instead of being blindly trusted.

## Per-type handling summary

### `error`

Validated fields include:

- message
- name
- stack
- fingerprint
- severity
- context
- breadcrumbs

Persistence:

- written to `events_errors`
- error name and fingerprint are derived when needed
- successful inserted errors also update `analytics_error_groups`

### `message`

Validated fields include:

- message
- severity
- context
- breadcrumbs

Persistence:

- written to `events_messages`

### `request`

Validated fields include:

- requestId
- url
- method
- statusCode
- latency
- headers
- query
- body
- bodySize
- userId

Persistence:

- written to `events_requests`
- generated columns such as request error/slow flags are intentionally not manually inserted

### `span`

Validated fields include:

- spanId
- traceId
- parentSpanId
- name
- kind
- startTime
- endTime
- duration
- exclusiveDuration
- status
- attributes
- events
- links

Persistence:

- written to `events_spans`

### `trace`

Validated fields include:

- traceId
- rootSpan
- spanCount
- totalDuration
- isPartial

Persistence:

- written to `events_traces`

### `metric`

Validated fields include:

- metricName
- metricType
- value
- unit
- count
- sum
- min
- max
- avg
- buckets
- tags

Persistence:

- written to `events_metrics`

### `log`

Validated fields include:

- level
- message
- args

Persistence:

- written to `events_logs`

### `profile`

Validated fields include:

- profileType
- startTime
- endTime
- duration
- profile

Persistence:

- written to `events_profiles`

### `cron_checkin`

Validated fields include:

- monitorSlug
- status
- duration
- environment

Persistence:

- written to `events_cron_checkins`

### `replay`

Validated fields include:

- sessionId
- segmentId
- events

Persistence:

- written to `events_replays`

## Queueing, Prioritization, and Fairness

`ingest-queues.ts` defines plan-aware queue priority.

Plan weights:

- `enterprise`: 1000
- `business`: 800
- `growth`: 600
- `starter`: 400
- `free`: 200

Urgency weights:

- `error`, `message`, `cron_checkin`: 100
- `request`, `span`, `trace`: 50
- `log`: 30
- `metric`: 20
- `profile`, `replay`: 10

Final priority also includes a fairness age boost based on defer count.

`worker-registry.ts` adds tenant fairness at execution time:

- each org has a plan-based in-flight cap
- if an org exceeds that cap, the job is re-enqueued with `deferCount + 1`
- the deferred copy gets a delay and higher priority
- the original job is completed without processing

Observed plan-based org in-flight limits:

- `enterprise`: 24
- `business`: 16
- `growth`: 8
- `starter`: 4
- `free`: 2

This prevents one tenant from monopolizing workers.

## Dead-Letter Handling

There are two dead-letter paths:

1. Validation dead-letter:
   - event failed worker normalization/validation
   - wrapped as `DlqIntakePayload`
   - sent to `ingest.dlq-intake`

2. Queue exhaustion dead-letter:
   - `pg-boss` job exceeded retries or expired
   - raw `IngestJobPayload` ends up in DLQ intake flow

The DLQ intake worker persists records into `ingestion_dead_letter_jobs`.

Admin routes can:

- list DLQ jobs
- reprocess one job
- reprocess all jobs

The service is able to reconstruct and requeue both payload shapes.

## Replay Handling

`POST /v1/replay` is an admin-only re-ingestion path.

Flow:

- reads historical events via `PostgresWriter` and `TelemetryReader`
- enforces max replay event limits
- groups by event type
- re-enqueues to the same per-type ingestion queues
- attaches replay metadata

Replay is queue-based, not direct DB reinsertion.

## Storage Model

The worker writes to typed tables, not a single generic events table.

Observed targets:

- `events_errors`
- `events_messages`
- `events_requests`
- `events_spans`
- `events_traces`
- `events_metrics`
- `events_logs`
- `events_profiles`
- `events_cron_checkins`
- `events_replays`

This is a stronger design than generic JSON-only persistence because it supports:

- typed querying
- better indexing
- analytics features
- event-specific schema evolution

## Idempotency and Duplicate Safety

When an event arrives without `eventId`, the worker generates one using deterministic hashing of:

- project ID
- event type
- stable-stringified event payload

This matters because:

- retries do not create uncontrolled duplication
- queue reprocessing remains safe
- uniqueness constraints can suppress duplicates

The design assumes worker writes are idempotent.

## Health and Operational Visibility

### Public health

`GET /v1/health` verifies:

- DB connectivity
- `pg-boss` job table access

### Ingestion operational health

`GET /v1/ingest/health` exposes:

- queue depth
- per-queue stats
- dead-letter count
- limiter sizes
- quota cache size
- backpressure thresholds

This is useful for diagnosing overload, queue buildup, and fairness behavior.

## Error Mapping

The controller maps service errors to HTTP responses:

- `INVALID_REQUEST` -> `400`
- `INVALID_API_KEY` -> `401`
- `PROJECT_INACTIVE` -> `403`
- `API_KEY_PERMISSION_DENIED` -> `403`
- `API_KEY_ENDPOINT_DENIED` -> `403`
- `RATE_LIMIT_EXCEEDED` -> `429`
- `QUOTA_EXCEEDED` -> `429`
- `EMPTY_BATCH` -> `400`
- `BATCH_TOO_LARGE` -> `413`
- `CIRCUIT_OPEN` -> `503`
- `INVALID_EVENT_TYPE` -> `400`
- `INVALID_DATE_RANGE` -> `400`
- `JOB_NOT_FOUND` -> `404`

`QUOTA_EXCEEDED` also sets `Retry-After: 60`.

## Security and Control Observations

The ingestion module has several meaningful control layers:

- constant-time API key validation
- project active-state enforcement
- endpoint allow/block lists
- event-type allowlists
- plan-aware backpressure
- org/project rate limiting
- payload decompression size guard
- worker-side strict schema validation
- deterministic idempotency
- admin-only DLQ and replay controls

This is materially stronger than a basic "accept JSON and insert into DB" ingestion endpoint.

## Gaps and Risks

### 1. Type drift between `types.ts` and runtime support

The runtime clearly supports ten event types, but `types.ts` still models a smaller legacy union.

Impact:

- developer confusion
- inaccurate documentation
- potential SDK/server type mismatch

### 2. Full validation is worker-only

This is intentional and likely correct for performance, but it has an operational implication:

- some malformed events still consume queue capacity before being rejected

This is a tradeoff, not necessarily a flaw.

### 3. Rate limiting is process-local

The limiter is intentionally in-memory and local to each process.

Impact:

- limits are approximate across clustered workers
- exact distributed enforcement must come from downstream quota/billing controls

Again, this appears to be a deliberate design choice for performance.

### 4. Test coverage is effectively absent

Both reviewed ingestion tests are skipped placeholders:

- `test/integration/ingestion.test.ts`
- `test/unit/modules/ingestion.service.test.ts`

Impact:

- critical ingestion behavior is not protected by automated tests
- regressions in rate limiting, queueing, DLQ reprocessing, or per-type handling may ship unnoticed

This is the clearest engineering weakness in the current implementation.

## Bottom Line

The ingestion module is a queue-first telemetry ingestion system with a clean separation between:

- lightweight HTTP acceptance and protection logic
- heavier worker-side normalization, persistence, and rollup

It supports more event types than the public type layer suggests, routes events into dedicated per-type queues, prioritizes high-value tenants and urgent telemetry during pressure, and preserves invalid/exhausted jobs through a DLQ path.

Operationally, the design is strong. The main issues are:

- stale/underspecified type definitions
- lack of real automated test coverage

## Recommended Next Actions

1. Align `types.ts` with the actual canonical event set from `event-normalizer.ts`.
2. Add integration tests for:
   - generic mixed-event ingestion
   - each typed route
   - invalid event rejection into DLQ
   - replay flow
   - backpressure and rate-limit behavior
3. Add unit coverage around:
   - API key permission checks
   - allowed/blocked endpoint logic
   - event-type allowlist logic
   - `shouldShed()` behavior by plan tier and event urgency
4. Decide whether SDK/public docs should expose all ten supported event types or keep some internal-only.

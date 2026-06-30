# Ingestion Module — Complete Analysis Report

## Overview

The **Ingestion Module** is the high-throughput intake gateway for the Pulse
platform. It accepts telemetry from the Pulse SDK (10 signal types), validates
and rate-limits it on the request path, then durably enqueues it into a
**PostgreSQL-native job queue**. A separate **worker process** drains that queue
and persists events into partitioned, tenant-isolated telemetry tables.

Key architectural facts:

- **No Redis, no BullMQ.** The queue is a Postgres table claimed with
  `FOR UPDATE SKIP LOCKED`. Durability, backups, and transactions are shared
  with the data it produces.
- **No in-memory buffering on the API path.** Once `enqueueBulk()` commits, the
  event survives a crash.
- **Two-phase pipeline.** The API process only validates + enqueues (fast). The
  worker process normalizes + persists (heavy), decoupled by the queue.
- **API-key resolution** is served from an in-process LRU cache (30-min TTL,
  `config/lrucashe.ts`) with a Postgres fallback. project_id/org_id always come
  from the authenticated key, never the payload.

---

## 1. File Structure

```
pulse/src/modules/ingestion/
├── ingestion.module.ts          # Fastify plugin: decorates PostgresWriter, mounts routes under /api
├── routes.ts                    # HTTP routes (/v1/*), schema validation, auth/admin guards
├── controller.ts                # Thin HTTP layer: maps requests <-> service, error-code -> HTTP
├── service.ts                   # Business logic: resolve project, rate-limit, normalize, enqueue
├── postgress.writter.ts         # API-key auth lookup + telemetry reads (delegates to reader)
├── rate-limiter.ts              # In-process token-bucket limiter (per-project, swept, bounded)
├── types.ts                     # SDK event types, request/response DTOs, Fastify JSON schemas
├── pipeline/
│   ├── event-normalizer.ts      # Zod validation + DoS bounds; the security boundary
│   ├── ingestion-job-handler.ts # Bridges queue jobs -> TelemetryWriter (re-validates)
│   ├── telemetry-writer.ts      # Multi-row inserts into the 10 typed telemetry tables
│   └── telemetry-reader.ts      # Reads errors/requests/etc.; replay extraction
├── queue/
│   ├── pg-queue.ts              # PgQueue: enqueue/claim/complete/fail/heartbeat/recover/prune/DLQ
│   └── pg-queue-worker.ts       # PgQueueWorker: polling consumer with bounded concurrency
└── utils/
    └── api-key.ts               # Header-first API-key extraction (X-API-Key / Authorization)
```

Worker process wiring (outside the module dir):

```
pulse/src/workers/
├── main.ts                      # Worker bootstrap: opens pool, starts all workers
├── index.ts                     # initializeWorkers(): builds PgQueue + N PgQueueWorkers
└── telemetry-maintenance.processor.ts  # Partition automation + retention (timer-driven)
```

---

## 2. Database Tables (from migrations)

All ingestion DDL lives in the legacy `migrations/` lineage (012–015). The
telemetry tables are **native RANGE-partitioned by `timestamp`** (monthly), with
a `*_default` catch-all partition. Partition naming convention: `<table>_yYYYY_mMM`.

### 2.1 Queue tables — `migrations/012_ingestion_queue.sql` (+ `015_ingestion_hardening.sql`)

#### `ingestion_jobs` — the live work queue

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `queue` | VARCHAR(64) | logical queue, default `'ingestion'` |
| `job_type` | VARCHAR(64) | event type: request/error/log/metric/span/... |
| `priority` | SMALLINT | **LOWER = higher priority**; default 100; CHECK 0–1000 |
| `org_id` | UUID | tenancy (fair-share/isolation) |
| `project_id` | UUID | tenancy |
| `payload` | JSONB | tenant-scoped normalized event envelope |
| `dedupe_key` | VARCHAR(200) | idempotency for in-flight jobs |
| `state` | `ingestion_job_state` enum | pending/active/completed/failed/cancelled |
| `run_at` | TIMESTAMPTZ | scheduling; future = delayed job |
| `attempts` / `max_attempts` | SMALLINT | retry budget (CHECK max 1–50) |
| `locked_until` | TIMESTAMPTZ | visibility-timeout lease expiry |
| `locked_by` | VARCHAR(128) | worker id holding the lease |
| `heartbeat_at` | TIMESTAMPTZ | last heartbeat for long jobs |
| `last_error` | TEXT | diagnostics |
| `created_at` / `updated_at` / `completed_at` | TIMESTAMPTZ | lifecycle (trigger keeps `updated_at`) |

**Enum** `ingestion_job_state`: `pending | active | completed | failed | cancelled`

**Indexes:**
- `idx_ingestion_jobs_claim` on `(queue, priority, run_at) WHERE state='pending'` — **the claim index**
- `idx_ingestion_jobs_lease` on `(locked_until) WHERE state='active'` — stuck-job recovery
- `idx_ingestion_jobs_dedupe` UNIQUE on `(dedupe_key) WHERE dedupe_key IS NOT NULL AND state IN ('pending','active')`
- `idx_ingestion_jobs_project` on `(project_id, state)`
- `idx_ingestion_jobs_completed` on `(completed_at) WHERE state='completed'` — pruning
- `idx_ingestion_jobs_org_state` on `(org_id, state)` (015)

#### `ingestion_dead_letter_jobs` — terminal failures (DLQ)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `original_job_id` | UUID | traceability to the dead job |
| `queue`, `job_type` | VARCHAR | |
| `org_id`, `project_id` | UUID | tenancy |
| `payload` | JSONB | |
| `dedupe_key` | VARCHAR(200) | |
| `attempts` | SMALLINT | |
| `last_error` | TEXT | |
| `failed_at` | TIMESTAMPTZ | |
| `replayed_at` | TIMESTAMPTZ | set when an operator requeues it |

**Indexes:** `idx_dlq_queue_time`, `idx_dlq_project`, `idx_dlq_unreplayed (WHERE replayed_at IS NULL)`, `idx_dlq_original_job` (015).

#### `ingestion_queue_snapshot` — VIEW (015)
Operator snapshot: per `(queue, state)` job counts, retried counts, oldest age in seconds.

### 2.2 Telemetry tables — `migrations/013_telemetry_storage.sql`

All partitioned by `timestamp` (monthly), PK `(id, timestamp)`, with a `*_default` partition.

| Table | SDK type | Hot columns | Key indexes |
|-------|----------|-------------|-------------|
| `spans` | `span` | trace_id, span_id, parent_span_id, name, kind, status, start/end_time, duration_ms, attributes(JSONB) | trace reconstruction `(project_id, trace_id, ts)`, parent, project+time, GIN(attributes) |
| `traces` | `trace` | trace_id, root_span(JSONB), span_count, total_duration_ms, has_error | UNIQUE `(project_id, trace_id, timestamp)` (upsert target), project+time, errors-only |
| `metrics` | `metric` | metric_name, metric_type, value, count/sum/min/max/avg, buckets(JSONB), tags(JSONB) | `(project_id, metric_name, ts)`, GIN(tags) |
| `logs` | `log` | level, message, args(JSONB), request/trace/span_id | project+time, level, trace |
| `profiles` | `profile` | profile_type (cpu/heap), start/end_time, duration_ms, profile(JSONB) | project+time, trace |
| `cron_checkins` | `cron_checkin` | monitor_slug, status, duration_ms, environment | `(project_id, monitor_slug, ts)` |
| `replays` | `replay` | session_id, segment_id, events(JSONB) | `(project_id, session_id, segment_id)` |
| `messages` | `message` | message, severity, context, breadcrumbs | `(project_id, severity, ts)` |
| `sdk_sessions` | (derived) | session_id, started/last_activity_at, event_count, error_count, crashed, status | UNIQUE `(project_id, session_id, timestamp)` |
| `ingestion_failures` | (forensics) | event_type, reason, detail, raw_excerpt(JSONB) | **non-partitioned**; project+time, reason+time |

### 2.3 Error/request tables — `migrations/014_errors_requests_storage.sql`

| Table | SDK type | Hot columns | Key indexes |
|-------|----------|-------------|-------------|
| `errors` | `error` | message, error_type, fingerprint, severity, stack/context/breadcrumbs(JSONB), resolved_at/by | project+time, fingerprint, unresolved-only, trace |
| `requests` | `request` | url, method, status_code, latency_ms, body/response_size, user/tenant/session, client_ip(INET), route, headers/query(JSONB) | project+time, status>=400, latency, route, trace |
| `error_groups` | (rollup) | fingerprint, first/last_seen, occurrences, last_message, error_type, is_resolved, priority(1–5) | **non-partitioned**; UNIQUE `(project_id, fingerprint)`, active-only |

### 2.4 Tables only **read** by ingestion (owned by the Projects module)

- `project_api_keys` — API-key auth: lookup by `key_hash` where active + not expired; `last_used_at` touch.
- `projects` — join for `org_id`, `name`, `status` (must be `active`).

---

## 3. Routes (prefix `/api`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/init` | API key | SDK bootstrap handshake; returns runtime config |
| POST | `/v1/ingest` | API key | Generic mixed-type batch ingest → 202 |
| POST | `/v1/ingest/requests` | API key | Typed request events (rejects mismatched types) |
| POST | `/v1/ingest/errors` | API key | Typed error events |
| POST | `/v1/ingest/logs` | API key | Typed log events |
| POST | `/v1/ingest/metrics` | API key | Typed metric events |
| GET | `/v1/health` | None | Public health: Postgres + queue (redis always reported `false`) |
| GET | `/v1/ingest/health` | authenticate | Queue/buffer operational metrics |
| GET | `/v1/limits` | API key (header) | Per-project rate limits; key read from header, **never query string** |
| GET | `/v1/errors` | authenticate + project membership (query) | List persisted error events |
| GET | `/v1/errors/:errorId` | authenticate + project membership | One error event |
| GET | `/v1/dlq` | authenticate + **requireAdmin** | List dead-letter jobs (offset/limit) |
| POST | `/v1/dlq/reprocess/:jobId` | authenticate + **requireAdmin** | Requeue one DLQ job |
| POST | `/v1/dlq/reprocess-all` | authenticate + **requireAdmin** | Bulk requeue (bounded batch) |
| POST | `/v1/replay` | authenticate + **requireAdmin** + project membership (body) | Replay historical events |
| GET | `/v1/debug/events/:id` | authenticate + project membership | Raw event + child-table details |

Hardening: every ingest endpoint applies strict JSON-Schema validation
(`IngestSchema`, `InitSchema`, `ReplaySchema`, `ErrorListSchema`, `ErrorByIdSchema`);
DLQ/replay require platform admin; the API key for `/v1/limits` is header-only to
keep secrets out of access logs.

---

## 4. Request-Path Flow (API process)

```
SDK → POST /api/v1/ingest
  │
  1. resolveApiKey()  — header-first (X-API-Key / Authorization), then body
  2. Fastify JSON-Schema validation (IngestSchema)
  3. IngestionController.ingest() → IngestionService.ingestBatch()
  4. IngestionService.processIngest():
       a. resolveProject(apiKey): LRU cache → PostgresWriter.getProjectByApiKeyHash()
          - rejects INVALID_API_KEY / PROJECT_INACTIVE
       b. rateLimiter.tryConsume(projectId, perSec, perMin, batchLen)
          - rejects RATE_LIMIT_EXCEEDED
       c. batch caps: EMPTY_BATCH / BATCH_TOO_LARGE
       d. pendingDepth() probe → backpressure decision (shed by priority)
       e. per event: normalizeEvent() (Zod + DoS bounds); enforce expected type
       f. build tenant-scoped jobs with dedupeKey = evt:{projectId}:{eventId}
       g. queue.enqueueBulk(jobs)  ← DURABLE COMMIT (ON CONFLICT DO NOTHING dedup)
  5. Return 202 { accepted, rejected, batchId, limits }
```

Persistence does **not** happen here. It is fully decoupled via the queue.

---

## 5. Worker-Path Flow (worker process)

```
PgQueueWorker.loop() (polling)
  │
  1. queue.claim(workerId, batchSize)
       WITH claimable AS (... FOR UPDATE SKIP LOCKED ...) UPDATE → 'active', lease, attempts++
  2. runBounded(jobs, handlerConcurrency=8)  — cap in-flight handlers (protect pool)
  3. createIngestionJobHandler():
       - re-validate payload via normalizeEvent() (queue payloads untrusted at rest)
       - TelemetryWriter.writeBatch(scoped events)  — group by type, one multi-row insert/type
  4. success → queue.complete(jobId)
     failure → queue.fail(job): retry w/ exponential backoff+jitter, or → DLQ at max attempts
  │
  background maintenance timer (every 15s):
     - queue.recoverStuck(500)   — return expired-lease jobs to pending (at-least-once)
     - queue.pruneCompleted(retention, 5000)
```

Adaptive idle backoff: `busyPollMs=25` when work was found, `idlePollMs=500` when empty.

---

## 6. Workers & Process / Forking Model

There are **two distinct process tiers**, plus in-process worker objects:

### 6.1 API tier — PM2 cluster (`ecosystem.config.cjs`)
- App `api-backend`, `script: dist/main.js`, **`exec_mode: 'cluster'`, `instances: 'max'`**
  → PM2 **forks one Fastify worker per logical CPU core**; the OS round-robins
  connections for near-linear scaling.
- Per-worker `--max-old-space-size=512`; `max_memory_restart: 600M`; `wait_ready`
  (main.ts emits `process.send('ready')`); `kill_timeout: 10s` graceful drain.
- The API process registers the ingestion module (routes + PostgresWriter) but
  **does not run queue consumers**.

### 6.2 Worker tier — dedicated process (`src/workers/main.ts`)
Bootstraps a dedicated Postgres pool (`max: 20`, `application_name: 'ingestion_workers'`)
and starts:

- **Ingestion consumers** via `initializeWorkers()` (`src/workers/index.ts`):
  - builds one shared `PgQueue` + `TelemetryWriter` + job handler
  - spawns **N `PgQueueWorker`s** where `N = INGESTION_WORKER_CONCURRENCY` (default **4**)
  - each worker id: `ingest-{pid}-{i}-{rand}`; `batchSize: 50`, bounded `handlerConcurrency: 8`
- **TelemetryMaintenanceWorker** — timer-driven (every 6h): partition automation + retention
- **Auth cleanup**, **auth-email**, **org-email** workers
- **pg-boss** based workers: alerting, event-analytics, organization cleanup cron
- **connector monitor**

Horizontal scaling: run multiple copies of the worker process. `FOR UPDATE SKIP
LOCKED` guarantees each job is handed to **exactly one** worker at a time, so
adding processes/nodes scales the consumer side safely.

### 6.3 In-process "workers" (objects, not OS processes)
- `PgQueueWorker` — polling consumer loop with bounded-concurrency lanes.
- `TelemetryMaintenanceWorker` — `setInterval` housekeeping (`.unref()`’d).
- `IngestionRateLimiter` — `setInterval` sweep timer (`.unref()`’d) to prune idle buckets.

### 6.4 Graceful shutdown
`initializeWorkers()` installs `SIGTERM`/`SIGINT` handlers → `stop()` drains all
`PgQueueWorker`s (waits for in-flight jobs up to 15s), runs the provided
`shutdown()` (stops maintenance/email/pg-boss workers, ends the pool), then exits.

---

## 7. PgQueue Mechanics (delivery semantics)

- **Delivery:** at-least-once. Consumers MUST be idempotent. Storage dedups by
  event id and `dedupe_key` prevents duplicate enqueues while in flight.
- **`enqueueBulk`** — single multi-row insert, `ON CONFLICT DO NOTHING` against
  the partial unique dedupe index; returns inserted ids (deduped rows skipped).
- **`claim`** — CTE selects claimable rows `FOR UPDATE SKIP LOCKED`, then in the
  same statement flips them to `active`, stamps `locked_until`/`locked_by`, and
  increments `attempts` (no select-then-lease window).
- **`fail`** — if `attempts >= max_attempts`: transactionally insert into
  `ingestion_dead_letter_jobs` + mark job `failed`. Else reschedule `pending`
  with exponential backoff (`base * 2^(attempts-1)`, capped) plus jitter.
- **`heartbeat`** — extends the lease for long-running jobs.
- **`recoverStuck`** — returns expired-lease `active` jobs to `pending`.
- **`pruneCompleted`** — deletes old completed rows in bounded batches.
- **`replayDeadLetter`** — transactionally re-inserts a DLQ row onto the live
  queue and stamps `replayed_at`.
- **`metrics` / `pendingDepth`** — observability + backpressure probe.

---

## 8. Event Normalization (security boundary)

`pipeline/event-normalizer.ts` is where **all untrusted SDK input** is validated:

- Strict Zod **discriminated union on `type`** across the 10 SDK event types:
  `error, message, request, span, trace, metric, log, profile, cron_checkin, replay`.
- **DoS bounds** (`LIMITS`): max string 8192, message 4096, array items 1000,
  tag keys 100, attribute keys 200, stack frames 200, breadcrumbs 100, trace
  span count 10000, replay events 5000.
- `normalizeEvent()` never throws — returns a tagged ok/err result so one poison
  event is rejected per-event (partial-success ingestion) instead of failing the
  batch.
- `resolveTimestamp()` clamps future timestamps to `now+1m` (defends
  partition-key abuse).
- Threats handled: giant-payload DoS, telemetry poisoning, cardinality
  explosion, infinite trace chains, malformed SDK output.

---

## 9. Rate Limiting (in-process, no Redis)

`rate-limiter.ts` — per-project **token bucket** with per-second + per-minute
windows:

- **Atomic** synchronous check-and-increment (no await between read and write →
  no race in Node's single-threaded loop).
- **Bounded memory**: idle buckets swept on a timer (`ttlMs`); hard `maxEntries`
  cap (default 100k) with oldest-touched eviction.
- Process-local: the platform limit is the sum across PM2 cluster workers. This
  is the "shed obvious abuse" tier; exact billing limits are enforced separately.

---

## 10. Error Handling & Codes

Service throws stable `Error(message=CODE)`; `controller.ERROR_MAP` translates to HTTP:

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_REQUEST` | 400 | Malformed body |
| `INVALID_API_KEY` | 401 | Unknown/invalid key |
| `PROJECT_INACTIVE` | 403 | Project not active |
| `RATE_LIMIT_EXCEEDED` | 429 | Per-project bucket exhausted |
| `EMPTY_BATCH` | 400 | No events |
| `BATCH_TOO_LARGE` | 413 | Exceeds `INGESTION_MAX_BATCH_SIZE` |
| `CIRCUIT_OPEN` | 503 | Dependency unavailable |
| `INVALID_EVENT_TYPE` | 400 | Event type mismatched typed route |
| `INVALID_DATE_RANGE` | 400 | Bad replay/list range |
| `JOB_NOT_FOUND` | 404 | DLQ job missing |

Unknown errors → 500 (logged with `reqId`).

---

## 11. Configuration (env)

| Env var | Used for |
|---------|----------|
| `INGESTION_MAX_BATCH_SIZE` | Max events per batch |
| `INGESTION_DEFAULT_RATE_PER_SECOND` / `_PER_MINUTE` | Default per-project limits |
| `INGESTION_BACKPRESSURE_HIGH_WATER` / `_CRITICAL_WATER` | Queue-depth shed thresholds |
| `INGESTION_RATE_BUCKET_TTL_MS` / `_SWEEP_MS` | Rate limiter sweep tuning |
| `INGESTION_REPLAY_MAX_EVENTS` | Replay cap |
| `INGESTION_ENDPOINT` | Endpoint advertised in SDK init |
| `INGESTION_WORKER_CONCURRENCY` | Number of `PgQueueWorker`s per worker process (default 4) |
| `ORG_CRON_ENABLED` | Toggle org cleanup cron ownership in the worker process |

---

## 12. Backpressure & Priority

Per-type **priority** (LOWER = higher): error/message/cron_checkin = 10;
request/span/trace = 50; log = 60; metric = 80; profile/replay = 90.

Shedding (in `processIngest`):
- depth ≥ `criticalWater` → shed everything with priority > 10 (only
  errors/messages/crons survive).
- depth ≥ `highWater` → shed priority ≥ 80 (metrics/profiles/replays first).

Pending depth is probed at most every 2s and cached to avoid hitting the DB per
request.

---

## 13. Summary

The Ingestion module is a **Postgres-only, two-tier pipeline**:

1. **API tier (PM2 cluster, one process per core):** authenticates the API key
   from cache, validates + rate-limits + bounds the batch, sheds under
   backpressure, and durably enqueues tenant-scoped jobs. Returns 202 instantly.
2. **Worker tier (dedicated, horizontally scalable process):** N `PgQueueWorker`s
   claim jobs with `SKIP LOCKED`, re-validate, and persist into partitioned,
   tenant-isolated telemetry tables; a maintenance worker rolls partitions
   forward and drops expired ones.

Durability and isolation come from Postgres (queue rows + partitioned tables +
per-row `project_id`/`org_id`), and the security boundary is the Zod-based
normalizer that bounds every untrusted SDK payload before it is queued or stored.

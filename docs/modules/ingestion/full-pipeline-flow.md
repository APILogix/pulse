# Ingestion Pipeline — Complete End-to-End Flow

**Scope:** every step a telemetry event passes through, from the SDK's HTTP request to durable
persistence and the alerting handoff — including auth, admission control, validation, queueing,
worker execution, the transaction boundary, acknowledgement, retry, and dead-lettering.

**Companion documents:**
[Event Pipeline & Batching](./event-pipeline-and-batching.md) answers "one-by-one or batched" in
depth · [Performance Forensics](../../ingestion-performance-forensics.md) explains *why* the
concurrency and pooling design is what it is.

> **Accuracy note.** Everything below was verified against the code. Where a documented feature is
> declared but **not wired in**, this document says so explicitly rather than describing intent as
> behaviour. Those places are marked ⚠️ and collected in [§13](#13-declared-but-not-active).

---

## Table of contents

1. [Two-tier architecture](#1-two-tier-architecture)
2. [The complete flow diagram](#2-the-complete-flow-diagram)
3. [Phase A — HTTP arrival](#3-phase-a--http-arrival)
4. [Phase B — Gateway admission (9 steps)](#4-phase-b--gateway-admission-9-steps)
5. [Phase C — Durability boundary](#5-phase-c--durability-boundary)
6. [Phase D — Queue and delivery](#6-phase-d--queue-and-delivery)
7. [Phase E — Worker admission gates](#7-phase-e--worker-admission-gates)
8. [Phase F — Normalization and identity](#8-phase-f--normalization-and-identity)
9. [Phase G — The transaction](#9-phase-g--the-transaction)
10. [Phase H — Acknowledgement](#10-phase-h--acknowledgement)
11. [Failure paths](#11-failure-paths)
12. [Endpoint inventory](#12-endpoint-inventory)
13. [Declared but not active](#13-declared-but-not-active)
14. [Latency budget and observability](#14-latency-budget-and-observability)

---

## 1. Two-tier architecture

The pipeline is split across **two OS processes** that share nothing but PostgreSQL:

| Tier | Process | Job |
|---|---|---|
| **Gateway** | `api-backend` (PM2 cluster) | Authenticate, admit, validate cheaply, make durable, return 202 |
| **Worker** | `ingestion-workers` (PM2 fork) | Normalize fully, persist telemetry, hand off to alerting |

The split exists so heavy persistence can never steal CPU from request acceptance. The contract
between them is the `pgboss.job` table.

**The gateway never writes telemetry.** Its only hard write is the job insert. Everything expensive
— full Zod normalization, enrichment, fingerprinting, the typed `INSERT` — happens worker-side.

---

## 2. The complete flow diagram

```
                          ┌──────────────┐
                          │   SDK/Agent  │
                          └──────┬───────┘
                                 │ POST /api/v1/{errors|requests|traces|...}
                                 │ Authorization: Bearer pv_live_… | X-API-Key
                                 │ body: { events: [...], metadata: {...} }
╔════════════════════════════════▼════════════════════════════════════════════╗
║ GATEWAY  (api-backend)                                                      ║
║                                                                             ║
║  A1  Fastify   bodyLimit 10 MB                                              ║
║  A2  under-pressure  ── event-loop / heap / RSS over threshold? ──► 503     ║
║  A3  AJV schema      ── events[] 1..1000, type ∈ enum ──────────► 400      ║
║  A4  empty-JSON body parser (SDK bootstrap sends 0 bytes)                   ║
║                                                                             ║
║  ┌── IngestionService.processIngest() ────────────────────────────────────┐ ║
║  │ 1 envelope        EMPTY_BATCH 400 · BATCH_TOO_LARGE 413                │ ║
║  │ 2 API key         LRU(5000, 30 min) → Postgres  INVALID_API_KEY 401    │ ║
║  │ 3 permissions     API_KEY_*_DENIED 403                                 │ ║
║  │ 4 rate limit      ⚠️ DISABLED (see §13)                                │ ║
║  │ 5 quota           cached, fail-open   QUOTA_EXCEEDED 429 + Retry-After │ ║
║  │ 6 backpressure    cached queue depth → per-event shed decision         │ ║
║  │ 7 validation      shape · type · size 256 KiB · shed → errors[]        │ ║
║  │ 8 chunk + enqueue group by type, cut on 200 events OR 1 MiB            │ ║
║  │ 9 usage counters  in-memory buffer, non-blocking                       │ ║
║  └────────────────────────────┬───────────────────────────────────────────┘ ║
║                               │ boss.insert(queue, items[])  ONE round trip ║
╚═══════════════════════════════▼═════════════════════════════════════════════╝
                    ═══ DURABILITY BOUNDARY ═══   then reply 202
                                │
                  pgboss.job  (PRIMARY DB, partitioned by queue name)
                                │
╔═══════════════════════════════▼═════════════════════════════════════════════╗
║ WORKER  (ingestion-workers)                                                 ║
║                                                                             ║
║  10 queues × localConcurrency(2) × batchSize(4) → array of ≤4 jobs          ║
║        │                                                                    ║
║        ├─ Tenant fairness gate ──── over budget? ──► re-enqueue deferCount+1║
║        ├─ Write admission (FIFO semaphore, 16 permits)                      ║
║        │                                                                    ║
║        ├─ normalizeEvent() per event ── invalid ──► DLQ intake queue        ║
║        ├─ deterministic eventId for events lacking one                      ║
║        │                                                                    ║
║        │  BEGIN                                                             ║
║        │  SET LOCAL sync_commit / lock_timeout / stmt_timeout / idle_tx     ║
║        │  ONE multi-row INSERT per type  (+ span tree for traces)           ║
║        │  error grouping, set-based       (errors only)                     ║
║        │  ONE UNNEST INSERT → telemetry_outbox                              ║
║        │  COMMIT                                                            ║
║        │                                                                    ║
║        └─ post-commit: domain events (in-process), usage buffer             ║
╚═══════════════════════════════╤═════════════════════════════════════════════╝
                                │
                     LOG DB (partitioned events_*)  +  telemetry_outbox
                                │
                    alerting worker reads the outbox asynchronously
```

---

## 3. Phase A — HTTP arrival

`src/app.ts`, `src/modules/ingestion/routes.ts`

| Step | Mechanism | Reject |
|---|---|---|
| A1 | Fastify `bodyLimit: 10485760` (10 MB global), `connectionTimeout` 30 s, `keepAliveTimeout` 65 s | 413 |
| A2 | `@fastify/under-pressure` | **503** + `Retry-After: 10` |
| A3 | Encapsulated AJV validator | 400 |
| A4 | Empty-JSON body parser | — |

### A2 — Admission control layer 1

This runs **before the handler**, protecting the event loop from collapse:

```ts
await app.register(underPressure, {
  maxEventLoopDelay:          env.PRESSURE_MAX_EVENT_LOOP_DELAY_MS,        // 1000 ms
  maxHeapUsedBytes:           env.PRESSURE_MAX_HEAP_MB * 1024 * 1024,      // 420 MB
  maxRssBytes:                env.PRESSURE_MAX_RSS_MB  * 1024 * 1024,      // 768 MB
  maxEventLoopUtilization:    env.PRESSURE_MAX_EVENT_LOOP_UTILIZATION,     // 0.95
  retryAfter: 10,
  pressureHandler: (_req, reply, type, value) => { /* throttled warn */
    reply.header('Retry-After', '10').status(503)
      .send({ error: 'Server busy', retryAfter: 10, reason: type });
  },
});
```

`reason` is one of `eventLoopDelay`, `heapUsedBytes`, `rssBytes`, `eventLoopUtilization`. Pressure
logging is throttled to one warn per `PRESSURE_LOG_INTERVAL_MS` (10 s) with a
`suppressedSinceLastLog` counter — logging every rejection would itself prolong the overload.

### A3 — Schema validation

Ingestion installs its **own** AJV instance because the rest of the app uses the Zod compiler:

```ts
const ajv = new AjvCtor({ coerceTypes: true, useDefaults: true, removeAdditional: false, allErrors: true });
```

`removeAdditional: false` is deliberate — unknown SDK fields survive to the worker, where they land
in `attributes`/`payload` rather than being silently dropped at the edge.

Schema caps: `events` `minItems: 1, maxItems: 1000`; `stack` `maxItems: 200`; `apiKey`
`minLength: 32, maxLength: 128`.

---

## 4. Phase B — Gateway admission (9 steps)

`IngestionService.processIngest(req, expectedType, apiKey)`. All entrypoints funnel here, so there is
exactly **one policy boundary**. Every step is timed into the `ingestion_admission_profile` log line.

### Step 1 — Envelope

```ts
if (!req || typeof req !== 'object')                 throw new Error('INVALID_REQUEST');
if (typeof apiKey !== 'string' || !apiKey.length)    throw new Error('INVALID_API_KEY');
if (!Array.isArray(events) || events.length === 0)   throw new Error('EMPTY_BATCH');
if (events.length > this.maxBatchSize)               throw new Error('BATCH_TOO_LARGE');
```

`maxBatchSize` = `INGESTION_MAX_BATCH_SIZE` (1000), matching the AJV cap. Oversized batches are
**rejected, not truncated** — silent truncation would lose telemetry without telling the SDK.

### Step 2 — API key resolution

LRU first, Postgres on miss:

```ts
const keyHash = hashApiKey(apiKey);                  // sha256 hex — plaintext never becomes a key
const cached  = apiKeyCache.get(keyHash);
if (cached) return mapped;
const auth = await this.writer.resolveApiKey(apiKey);
```

Cache: `max: 5000`, `ttl: 30 min`, `updateAgeOnGet: true`.

On miss, `PostgresWriter.resolveApiKey()`:
1. Extract the public prefix (`pv_live_…`) → indexed lookup on `project_api_keys`.
2. Join `projects`, `organizations`, `project_environments`, plus `LEFT JOIN LATERAL` for `plans.tier`
   via the newest subscription in `('trialing','active','past_due')`.
3. Accept `status='active'` **or** `status='rotated'` with a live grace-period rotation row.
4. Compare candidates with **`constantTimeEqualHex`** — timing-attack safe.
5. `project_status !== 'active'` → `null`.

`last_used` is updated **fire-and-forget**: never block ingestion on a bookkeeping write.

Environment resolution: absent `metadata.environment` falls back to the key's environment slug. Not
an error.

> **Two properties worth knowing.** `updateAgeOnGet: true` means a continuously-used key stays
> cached indefinitely, so a **revoked key keeps working** until 30 min idle or explicit eviction.
> And `resolveApiKey` returns permissive **constants** for the scoping arrays rather than stored
> columns (`permissions: ['ingest:write']`, `allowedEndpoints: ['*']`, `allowedEventTypes: ['*']`,
> all rate-limit fields `null`) — the code comment is explicit that "a credential only proves
> identity". Consequence: **`planTier` is the only DB-derived policy input**, and
> `allowedOrigins`/`allowedIps`/`allowedDomains`/`allowedSdks` are carried but never enforced.

### Step 3 — Permissions

```ts
if (!project.permissions.includes('ingest:write')) throw new Error('API_KEY_PERMISSION_DENIED');
const endpoint = expectedType ? `ingest:${expectedType}` : 'ingest:batch';
// allowed unless explicitly blocked; '*' wildcard supported
if (!allowed || blocked) throw new Error('API_KEY_ENDPOINT_DENIED');
```

Given the constants above, every authenticated key currently passes this step.

### Step 4 — Rate limiting ⚠️ DISABLED

```ts
// 4. Route-level rate limiting is currently disabled for ingestion.
timings.rateLimitMs = 0;
```

See [§13](#13-declared-but-not-active).

### Step 5 — Quota pre-check (cached, fail-open)

`assertQuotaAvailable()` is **synchronous — it never awaits the database**:

```ts
const entry = this.quotaCache.get(orgId);
if (!entry) { this.refreshQuotaCache(orgId); return; }              // cold cache → ACCEPT
if (now - entry.at > this.quotaCacheTtlMs) this.refreshQuotaCache(orgId);  // stale value still used
if (entry.eventLimit >= 0 && entry.eventsUsed >= entry.eventLimit
    && (entry.usageBehavior === 'hard_limit' || entry.usageBehavior === 'throttle')) {
  throw new Error('QUOTA_EXCEEDED');
}
```

`refreshQuotaCache` is single-flight per org and reads the entitlement plus
`organization_usage_current_period` in parallel. Cache TTL `INGESTION_QUOTA_CACHE_TTL_MS` (60 s),
bounded at 10 000 orgs, invalidated event-driven via `entitlementsService.onOrgInvalidate`.

**Deliberately fail-open.** Cold cache, a refresh failure, or a missing usage row all **accept** —
the code logs "allowing batches under fail-open policy". Enforcement therefore lags real usage by up
to the TTL. Rejecting paying customers' telemetry because a quota lookup failed is judged worse than
briefly over-serving.

### Step 6 — Backpressure snapshot

Never awaits the probe:

```ts
if (now - this.cachedDepthAt > env.INGESTION_QUEUE_DEPTH_CACHE_MS) this.refreshQueueDepth();
return this.cachedDepth;   // returns immediately, refresh happens in background
```

On probe failure the **stale snapshot is kept**, not zeroed — zeroing would disable shedding exactly
when the DB is unhealthy.

### Step 7 — Per-event validation and shedding

Per event, in order. The first six produce a **per-event** reject; only #3 fails the whole batch:

| # | Check | Outcome |
|---|---|---|
| 1 | not an object | reject `event_not_object` |
| 2 | `type` unknown | reject `unknown event type: X` |
| 3 | type ≠ endpoint's type | **throws `INVALID_EVENT_TYPE`** → 400, whole batch |
| 4 | `JSON.stringify` throws | reject `event_not_serializable` |
| 5 | `> MAX_EVENT_BYTES` (256 KiB) | reject `event_too_large` |
| 6 | `shouldShed(pending, planTier, type)` | reject `shed_backpressure` |
| 7 | type not in `allowedEventTypes` | reject `event_type_not_allowed` |

`eventId` for the reject report comes from `extractEventId()`: `eventId` → `requestId` →
`randomUUID()`, capped at 128 chars.

#### Admission control layer 2 — plan-aware shedding

```ts
if (depth >= criticalWater) {                            // 250 000
  const topTier = planTier === 'business' || planTier === 'enterprise';
  return !(topTier && TYPE_URGENCY[type] === 100);
}
if (depth >= highWater) {                                // 100 000
  return PLAN_WEIGHT[planTier] + TYPE_URGENCY[type] < PLAN_WEIGHT.business + 100;   // < 900
}
return false;
```

`PLAN_WEIGHT`: enterprise 1000 · business 800 · growth 600 · starter 400 · free 200
`TYPE_URGENCY`: error/message/cron_checkin 100 · request/span/trace 50 · log 30 · metric 20 ·
profile/replay 10

| Pending depth | Behaviour |
|---|---|
| < 100 000 | nothing shed |
| ≥ 100 000 | everything scoring < 900 sheds: all free/starter/growth (max 700), plus business non-urgent (850). Survivors: business errors/messages/checkins (900) and all enterprise (≥ 1010) |
| ≥ 250 000 | only business/enterprise **and** urgency 100 survive — enterprise requests/traces/logs/metrics shed too |

Shedding is **per event, not per batch**: the request still returns 202 with survivors accepted and
shed events listed in `errors[]`. One warn per batch, and `shed` feeds the `rate_limited` counter.

The same weights drive queue priority — `PLAN_WEIGHT + TYPE_URGENCY + deferCount × 25` — so
shedding and scheduling agree on what matters.

### Step 8 — Chunk and enqueue

Group by type, then cut a chunk on **either** bound:

```ts
if (chunk.length >= this.jobChunkSize || chunkBytes + item.bytes > this.jobMaxBytes) { /* cut */ }
```

`jobChunkSize` = 200 events · `jobMaxBytes` = `max(256 KiB, 1 MiB)`. The byte bound matters as much
as the count bound: 200 replay events dwarf 200 metric events, and an oversized job means an
oversized worker transaction holding a connection longer.

One-shot provisioning retry guards a cold start:

```ts
try { result = await enqueueIngestJobs(jobs); }
catch (err) {
  if (queuesProvisioned) throw err;
  await ensureIngestQueuesProvisioned();
  result = await enqueueIngestJobs(jobs);
}
```

### Step 9 — Usage accounting

`UsageCounter.increment()` into an in-memory buffer for `requests`, `bytes_ingested`, `errors`,
`rate_limited`. Flushed on a timer to `usage_counter_staging` — **never on the request path**.
Accepted-event billing happens worker-side after idempotent storage, so retries aren't double-billed.

---

## 5. Phase C — Durability boundary

```ts
const ids = await boss.insert(queue, items);   // ONE round trip per queue
```

Falls back to per-job `pgboss.send()` on throw, recording `{ bulk: false, fallback: true }` so the
degradation is visible rather than silent.

**Once this resolves, the events survive a crash of any process.** This is the only hard work the
gateway is permitted to do, and it is the point at which the 202 becomes honest.

### Response — HTTP 202 Accepted

```ts
{
  success: true,
  accepted,                 // events enqueued into pg-boss
  rejected: errors.length,  // shed + malformed + oversized + type-not-allowed
  batchId,                  // randomUUID per request
  limits: { remaining: Number.MAX_SAFE_INTEGER, resetAt: 0 },   // ⚠️ placeholder, see §13
  errors: [{ eventId, reason }]                                 // only when non-empty
}
```

**202, not 200** — deliberate and honest: persistence is asynchronous. A 200 would imply the
telemetry is queryable, which it is not yet.

---

## 6. Phase D — Queue and delivery

### Queue configuration

```ts
{
  partition: true,
  notify: true,
  retryLimit:      env.INGESTION_JOB_RETRY_LIMIT,          // 3
  retryDelay:      env.INGESTION_JOB_RETRY_DELAY_SECONDS,  // 5 s
  retryBackoff:    true,
  expireInSeconds: env.INGESTION_JOB_EXPIRE_SECONDS,       // 300
  deadLetter:      INGEST_DLQ_INTAKE_QUEUE,
}
```

Ten typed queues (`ingest.error`, `ingest.request`, …) plus `ingest.dlq-intake` and
`ingest.usage-rollup`. One queue per type means a slow profile upload cannot block error ingestion.

### Delivery

```ts
await pgboss.work(queue, {
  localConcurrency: env.INGESTION_TYPE_WORKER_CONCURRENCY,  // 2
  batchSize:        env.INGESTION_TYPE_WORKER_BATCH_SIZE,   // 4
  perJobResults: true,
  includeMetadata: true,
}, handler);
```

The handler receives an **array** of up to 4 jobs and fans out with `Promise.all`. Each job still
gets its own transaction: `perJobResults: true` lets pg-boss settle jobs individually, so one
poisoned job is retried alone rather than dragging three healthy batchmates with it.

Max in-flight = 10 × 2 × 4 = **80 jobs**, bounding resident memory at ~80 MB against a 512 MB heap.

---

## 7. Phase E — Worker admission gates

Both gates run **before** any DB connection is acquired.

### Tenant fairness

```ts
const limit = TENANT_INFLIGHT_LIMIT[planTier];   // ent 24 · biz 16 · growth 8 · starter 4 · free 2
if (current >= limit && deferCount < env.INGESTION_FAIRNESS_MAX_DEFERS) {   // 5
  await pgboss.send(queue, { ...payload, metadata: { ...meta, deferCount: deferCount + 1 } }, {
    startAfter: env.INGESTION_FAIRNESS_DEFER_DELAY_SECONDS,   // 2 s
    priority: jobPriority(planTier, type, deferCount + 1),    // +25 aging boost
  });
  return { deferred: true };     // original COMPLETES — the copy carries the work
}
if (current >= limit) this.metrics.recordFairnessStarvationAdmission(...);  // aging override
```

A deferral costs one `pgboss.job` insert and **zero** telemetry connections. If the `send` throws,
the original job fails and retries — events are never lost. After 5 defers the job is admitted
regardless, which is the starvation guard.

> **Scaling caveat.** `inFlight` is a process-local `Map`, so with *K* ingestion processes one
> tenant's effective concurrency is `limit × K`. Fairness degrades linearly with instance count.
> See the [scaling runbook](../../deployment/scaling-and-plan-upgrade-runbook.md) §5.1.

### Write admission

A FIFO semaphore bounds concurrent ingest transactions to the telemetry pool's real capacity
(`INGESTION_WRITE_CONCURRENCY` = 16, clamped to `pool.max − reserve`). Waiting happens in memory,
FIFO, with **no timeout** — deliberately, because a timeout here would recreate the
connection-timeout failure mode it exists to remove. Overload is signalled by gateway backpressure,
not by failing already-accepted work. Full rationale in the
[forensics doc](../../ingestion-performance-forensics.md).

---

## 8. Phase F — Normalization and identity

`EventProcessor.process()`, before `BEGIN`. All CPU, no DB.

1. **Full Zod normalization** — `normalizeEvent()` is *the* security boundary. Hard DoS caps from
   `LIMITS`: `maxStringLen` 8192 · `maxMessageLen` 4096 · `maxStackFrames` 200 · `maxBreadcrumbs`
   100 · `maxTraceSpanCount` 10 000 · `maxReplayEvents` 5000, plus tag/attribute count caps against
   cardinality explosion.
2. **Rejects route to the DLQ**, they do not fail the job:
   ```ts
   const dlq: DlqIntakePayload = {
     sourceQueue: queue, eventType, organizationId: orgId, projectId,
     error: `validation_failed: ${rejected.length} event(s) rejected; first: ${rejected[0]?.detail}`,
   };
   await pgboss.send(INGEST_DLQ_INTAKE_QUEUE, dlq, {} as never);
   ```
   Valid events in the same job still persist. One malformed event cannot poison its batch.
3. **Deterministic identity** — events without an `eventId` get
   `sha256(projectId + ':' + type + ':' + stableStringify(event))`. Deterministic, so a redelivered
   event produces the *same* id and is caught by `ON CONFLICT DO NOTHING`. A random id would
   duplicate on every retry.
4. **Enrichment** — GeoIP, UA parsing, IP hashing (never raw IPs), fingerprinting for errors.

---

## 9. Phase G — The transaction

```
BEGIN
SET LOCAL synchronous_commit = on;
  SET LOCAL lock_timeout = '2000ms';
  SET LOCAL statement_timeout = '60000ms';
  SET LOCAL idle_in_transaction_session_timeout = '30000ms'     ← ONE round trip
<one multi-row INSERT per event type>          (+ chunked span insert for traces)
<error grouping, set-based>                    (errors only)
<one UNNEST INSERT into telemetry_outbox>
COMMIT
```

Statement counts — **independent of event count**:

| Job type | Statements |
|---|---|
| 1→1 types (log, metric, request, span, message, profile, replay, cron_checkin) | **5** |
| Trace | **6** |
| Error | **9** typical, 14 max |
| All-duplicate batch | **4** |

`statement_timeout` (60 s) is **strictly below** `expireInSeconds` (300 s), enforced by a boot guard.
pg-boss re-delivers an expired job *without cancelling the running transaction*, so violating that
ordering would mean two workers writing the same batch while the original holds a connection hostage.

`synchronous_commit = on` — durability is not traded for throughput.

Full per-type insert reference: [Event Pipeline & Batching](./event-pipeline-and-batching.md) §6.

### What is deliberately outside the transaction

| Work | Where | Why |
|---|---|---|
| Usage/billing | in-memory buffer, 30 s timer | never blocks ingestion |
| Domain events | after `COMMIT`, in-process emitter | none emitted for a rolled-back batch |
| Alert evaluation | separate worker reading `telemetry_outbox` | the outbox row *is* the handoff |
| Analytics rollups | event-analytics worker | never on the ingest path |
| Normalization, enrichment, fingerprinting | before `BEGIN` | nothing that can be done outside a transaction happens inside one |

**Inside**: the typed INSERT, error grouping, and the outbox insert. The outbox must be
transactional — an event persisted but never producing an alert would be a correctness bug.

---

## 10. Phase H — Acknowledgement

**The ACK ordering is the durability contract, and it is correct:**

```
handler resolves  ⟵  after COMMIT  ⟵  after all writes
        │
        └─► pg-boss marks the job completed
```

Nothing is acknowledged before the durable persistence boundary. Verified properties:

- **Crash before COMMIT** → transaction rolls back, job stays active, expires after 300 s, redelivered.
- **Crash after COMMIT, before ACK** → job redelivered; idempotent inserts make the replay a no-op.
- **Partial batch failure** → `perJobResults` settles each job independently.
- **All jobs failed** → the handler throws instead, so the whole batch retries (identical outcome,
  matching the plain-throw idiom used elsewhere).

---

## 11. Failure paths

### Retry ladder

```
attempt 1 ──fail──► retry ×3, 5 s base, exponential backoff
                       └──exhausted──► ingest.dlq-intake
                                          └─► ingestion_dead_letter_jobs
                                                 └─► admin replay via POST /api/v1/dlq/reprocess/:jobId
```

`ingest.dlq-intake` itself retries 5× at 30 s with a 3600 s expiry and **no** `deadLetter` — it is
terminal by design, so a DLQ failure cannot loop forever.

### Failure classification

`failureReason()` maps errors to a stable label so retries are attributable:

| SQLSTATE / pattern | Label |
|---|---|
| `55P03` | `db_lock_timeout` |
| `57014` | `db_statement_timeout` |
| `53300`, `08000`, `08003`, `08006` | `db_connection` |
| `23xxx` | `idempotency` |
| "invalid" / "validation" / `no_persistable_events` | `validation` |
| quota / rate_limit | `admission_control` |

### Two kinds of rejection, deliberately different

| | Gateway reject | Worker reject |
|---|---|---|
| When | before the 202 | after the 202 |
| Reported | in the `errors[]` array of the response | to `ingest.dlq-intake` |
| Visible to SDK | yes, immediately | no — already ACKed as accepted |
| Cause | shape, size, unknown type, shed | full Zod normalization failure |

Cheap checks run at the edge so the SDK gets synchronous feedback; expensive validation runs
worker-side and lands in the DLQ where an operator can inspect and replay it.

### Duplicate handling

`ON CONFLICT DO NOTHING` against the `(organization_id, event_id, occurred_at)` identity index.
That unique index **is** the deduplication mechanism — required for correctness, not just reads.
Duplicates are detected from `rowCount` with **no extra query**. Only inserted rows are billed.

---

## 12. Endpoint inventory

All paths prefixed `/api` (`ingestionRoutes` registered with `{ prefix: '/api' }`).

### Typed write endpoints — data-driven from `route-table.ts`

| Path | Type | Path | Type |
|---|---|---|---|
| `POST /v1/errors` | `error` | `POST /v1/logs` | `log` |
| `POST /v1/requests` | `request` | `POST /v1/profiles` | `profile` |
| `POST /v1/traces` | `trace` | `POST /v1/events` | `message` |
| `POST /v1/spans` | `span` | `POST /v1/checkins` | `cron_checkin` |
| `POST /v1/metrics` | `metric` | `POST /v1/replays` | `replay` |

`route-table.ts` is the single source of truth mapping path → `SdkEventType` → SDK-config transport
key, so the SDK can only advertise routes that exist. It imports `SdkEventType` as a **type only**,
making it dependency-free and unit-testable.

### Other endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /v1/ingest` | API key | mixed-type batch (only endpoint accepting multiple types) |
| `POST /v1/ingest/{requests,errors,logs,metrics}` | API key | legacy typed paths |
| `POST /v1/init`, `/v1/sdk-config` | API key in handler | SDK bootstrap / remote config |
| `GET /v1/health` | none | liveness |
| `GET /v1/ingest/health` | authenticate | queue depth, DLQ count, cache sizes |
| `GET /v1/limits` | headers only | effective limits |
| `GET /v1/usage` | authenticate + project membership | usage counters |
| `GET /v1/errors`, `/v1/errors/:errorId` | authenticate + project membership | error reads |
| `GET /v1/dlq` | authenticate + **admin** | list dead letters |
| `POST /v1/dlq/reprocess/:jobId` | authenticate + **admin** | replay one |
| `POST /v1/dlq/reprocess-all` | authenticate + **admin** | batch replay |
| `POST /v1/replay` | admin + project membership | replay telemetry |
| `GET /v1/debug/events/:id` | authenticate + project membership | single-event lookup |

`GET /v1/limits` reads the API key from **headers only, never the query string** — the code documents
why: access logs, browser history, and CDN/proxy logs would otherwise capture credentials.

### Boot-time guards

`requireFastifyDecorator(fastify, 'postgresWriter')` and `assertControllerMethods()` throw during
registration rather than 500-ing at runtime, so a renamed controller method fails the deploy.

### Error code → HTTP status

| Code | Status | Code | Status |
|---|---|---|---|
| `INVALID_REQUEST` | 400 | `BATCH_TOO_LARGE` | 413 |
| `INVALID_ENVIRONMENT` | 400 | `RATE_LIMIT_EXCEEDED` | 429 |
| `INVALID_EVENT_TYPE` | 400 | `QUOTA_EXCEEDED` | 429 + `Retry-After: 60` |
| `EMPTY_BATCH` | 400 | `CIRCUIT_OPEN` | 503 |
| `INVALID_API_KEY` | 401 | `CONFIG_UNAVAILABLE` | 503 |
| `PROJECT_INACTIVE` | 403 | *unmapped* | 500 `INTERNAL_ERROR` |
| `API_KEY_*_DENIED` | 403 | | |

`QUOTA_EXCEEDED` is the only code carrying `Retry-After`.

---

## 13. Declared but not active

Documented so nobody plans around behaviour that isn't there.

### ⚠️ Route-level rate limiting is disabled

`src/modules/ingestion/service.ts`:

```ts
// 4. Route-level rate limiting is currently disabled for ingestion.
timings.rateLimitMs = 0;
```

`IngestionRateLimiter` exists in `rate-limiter.ts` but is **not imported by the service** — the only
references are the module itself, the stale `dist/` build, and docs. Corroborating evidence:
`getIngestionHealth()` hardcodes `rateLimiterEntries: 0, orgRateLimiterEntries: 0`; `getLimits()`
returns `enabled: false` with null limits; the 202 body's `limits` block is a placeholder
(`Number.MAX_SAFE_INTEGER` / `0`); and `shutdown()` never disposes a limiter.

**What still protects the pipeline:** `under-pressure` (layer 1), plan-aware backpressure shedding
(layer 2), quota enforcement, `MAX_EVENT_BYTES`, `maxBatchSize`, and the worker-side fairness gate
and write-admission semaphore.

Also note the dormant module is **fixed-window, not token-bucket** despite its docstring — two
counters (1 s, 1 m) reset abruptly, so up to 2× the nominal limit can pass across a boundary. And
it is process-local, so under PM2 cluster the effective platform limit would be `workers × limit`.

### ⚠️ `INGESTION_GZIP_MAX_BYTES` is dead config

Declared with a 20 MB default and the comment "zip-bomb guard", but the identifier appears **nowhere
else in `src/`**. There is no request-body decompression code in the ingestion path at all;
`metadata.compression: 'gzip' | 'none'` is a declared hint the gateway does not act on.

`@fastify/compress` is registered with **response-side options only**
(`threshold: 1024`, `encodings: ['br','gzip','deflate']`), so whatever inbound-decompression defaults
that plugin ships apply unmodified — this codebase neither configures nor caps them.

**Size limits that ARE enforced:** global `bodyLimit` 10 MB · AJV `events maxItems: 1000` /
`stack maxItems: 200` · service `maxBatchSize` 1000 · per-event `MAX_EVENT_BYTES` 256 KiB · per-job
`jobChunkSize` 200 / `jobMaxBytes` 1 MiB.

### ⚠️ Dead worker-tier env vars

No runtime consumer — leftovers from the v2 `PgQueue` tier. Tuning them has no effect:

```
INGESTION_GENERAL_WORKERS       INGESTION_SPECIALIZED_WORKERS
INGESTION_GENERAL_CONCURRENCY   INGESTION_SPECIALIZED_CONCURRENCY
INGESTION_GENERAL_BATCH_SIZE    INGESTION_SPECIALIZED_BATCH_SIZE
INGESTION_POLL_MS               INGESTION_VISIBILITY_TIMEOUT_MS
INGESTION_IDLE_POLL_MS          INGESTION_SPECIALIZED_VISIBILITY_TIMEOUT_MS
```

The real knobs are `INGESTION_TYPE_WORKER_CONCURRENCY`, `INGESTION_TYPE_WORKER_BATCH_SIZE`,
`INGESTION_WRITE_CONCURRENCY`, `INGESTION_WRITE_POOL_SIZE`.

---

## 14. Latency budget and observability

### Two profile log lines

**Gateway** — `ingestion_admission_profile`: `envelopeMs`, `authMs`, `authzMs`, `rateLimitMs` (always
0), `quotaMs`, `backpressureMs`, `validationMs`, `enqueueMs`.

**Worker** — `ingestion batch profile`: `queueWaitMs`, `writeAdmissionWaitMs`, `dbConnectionWaitMs`,
`normalizationMs`, `beginMs`, `insertMs`, `outboxMs`, `commitMs`, `transactionMs`, `rollbackMs`,
`domainEventMs`, `dlqEnqueueMs`, `totalProcessingMs`, `dbQueries`, `dbQueryMs`,
`outboxRowsSkippedDuplicate`.

### Diagnostic decision table

| Symptom | Likely cause | Check |
|---|---|---|
| High `authMs` | API key LRU thrashing | cache hit rate, key cardinality |
| High `enqueueMs` | primary DB pressure | `pgboss.job` insert latency |
| High `queueWaitMs` | not enough worker throughput | `ingest_write_admission_queued` |
| High `writeAdmissionWaitMs` | insufficient write capacity | raise permits **and** pool together |
| High `dbConnectionWaitMs` | pool unhealthy — should be ≈ 0 | pool stats, `pg_stat_activity` |
| High `commitMs` | WAL flush / storage latency | Neon compute size, checkpoints |
| Rising `deferred` | tenant fairness saturation | per-org in-flight metrics |
| `db_connection` failures | connection starvation | should be impossible post-admission |

Interpretation shortcut: **`queued > 0` sustained** = not enough write capacity ·
**`in_flight == permits, queued == 0`** = perfectly saturated, the goal ·
**`in_flight < permits` but slow** = the database is the bottleneck, not admission.

### Verify it yourself

```bash
npx vitest run src/modules/ingestion src/modules/errors   # correctness
npm run bench:ingestion:matrix                            # 10 / 100 / 500 / 1k / 10k events
npm run explain:ingestion                                 # EXPLAIN the write path
npm run ingestion:db:runtime                              # live pool / lock / WAL diagnostics
```

```sql
-- Confirm inserts are still set-based: rows should greatly exceed calls.
SELECT query, calls, rows, mean_exec_time
  FROM pg_stat_statements
 WHERE query LIKE 'INSERT INTO events_%'
 ORDER BY calls DESC;
```

---

## Summary — the flow in one table

| Phase | Where | Key property |
|---|---|---|
| A. HTTP arrival | gateway | 10 MB body cap, `under-pressure` 503, AJV schema |
| B. Admission | gateway | 9 ordered steps, one policy boundary, plan-aware shedding |
| C. Durability | gateway | `boss.insert` — one round trip, then 202 |
| D. Queue | pg-boss | 10 typed queues, retry ×3, 300 s expiry, DLQ |
| E. Worker gates | worker | fairness gate + FIFO write admission, both pre-connection |
| F. Normalization | worker | Zod security boundary, deterministic ids, rejects → DLQ |
| G. Transaction | worker | one INSERT per type, outbox inside, 5 statements typical |
| H. ACK | worker | strictly after COMMIT — never before |

**Three invariants that hold end to end:** nothing is acknowledged before durable persistence;
every insert is idempotent so at-least-once delivery is safe; and no stage performs a per-event
database round trip.

---

## Related documents

- [Event Pipeline & Batching](./event-pipeline-and-batching.md) — per-type insert reference,
  statement counts, bind-parameter limits
- [Ingestion Performance Forensics](../../ingestion-performance-forensics.md) — root causes,
  write-admission design, bottleneck ranking
- [Scaling & Neon Plan Upgrade Runbook](../../deployment/scaling-and-plan-upgrade-runbook.md)
- [Ingestion Module Architecture](./architecture.md) · [Working](./working.md) ·
  [Benchmark](./benchmark.md)

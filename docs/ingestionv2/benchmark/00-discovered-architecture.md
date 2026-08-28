# Discovered ingestion architecture (Stage A, read-only audit)

Audit date: 2026-08-27. Every claim below cites source. Nothing is assumed.

## 1. Real end-to-end path

```text
SDK / HTTP client
  → POST /api/v1/<type>  (or legacy /v1/ingest, /v1/ingest/<type>)
      [src/modules/ingestion/routes.ts:236-269]
  → AJV JSON-Schema validation (IngestSchema) at the route boundary
      [routes.ts:242, types.ts]
  → IngestionController.ingestTyped(type) / .ingest / .ingestRequests etc.
      [controller.ts:145-155, 178-192]
  → resolveApiKey(request, body): X-API-Key header, Authorization: Bearer/ApiKey, or body.apiKey
      [utils/api-key.ts:1-29]
  → IngestionService.processIngest()
      [service.ts:614-844]
      1. envelope checks (object / non-empty events / batch cap)      [service.ts:620-626]
      2. resolveProject(apiKey): LRU cache -> PostgresWriter.resolveApiKey() SQL
         [service.ts:263-368, postgress.writter.ts:77-140]
      3. project.isActive / environment normalization                [service.ts:628-634]
      4. assertKeyCanUseEndpoint (permissions/allowed endpoints/types) [service.ts:636-638]
      5. route-level rate limiting: DISABLED on this path              [service.ts:640-641]
      6. assertQuotaAvailable(orgId): cached, fail-open                [service.ts:643-645]
      7. queue provisioning warm-up (idempotent createQueue)           [service.ts:647-652]
      8. cached queue-depth probe (backpressure snapshot)              [service.ts:654-656]
      9. per-event validation: object shape, known SdkEventType, ≤256 KiB/event,
         shed decision (shouldShed), allowed-type check                [service.ts:667-706]
     10. buildJobs(): chunk accepted events per type into pg-boss jobs, bounded
         by INGESTION_JOB_CHUNK_SIZE (200) events OR INGESTION_JOB_MAX_BYTES (1 MiB)
         [service.ts:835-869, env.ts:309,313]
     11. enqueueIngestJobs(): bulk pg-boss insert per queue, one job per (type, chunk)
         [queue/ingest-queues.ts:230-260]
     12. usage accounting (requests/bytes/errors/rate_limited) via UsageCounter
         [service.ts:797-808]
     13. HTTP 202 response {success, accepted, rejected, batchId, errors?}
         [service.ts:844-869, controller.ts:150,182]
  → durable pg-boss ingest.<type> job row (Primary DB)
  → dedicated ingestion worker process (WorkerRegistry)
      [src/modules/ingestion/workers/worker-registry.ts]
  → per-org fairness gate -> cancellation-aware write-admission (16 permits)
      [write-admission.ts]
  → EventProcessor.process(): normalize -> BEGIN -> typed INSERT(s) + outbox -> COMMIT
      [workers/event-processor.ts]
  → post-COMMIT domain event + inserted-only usage accounting
  → pg-boss job completion
```

## 2. Exact configured limits (source of truth: `src/config/env.ts`)

| Setting | Default | Line | Meaning |
| --- | ---: | --- | --- |
| `INGESTION_MAX_BATCH_SIZE` | **1000** | env.ts:216 | Max events accepted in one HTTP request body. |
| `INGESTION_JOB_CHUNK_SIZE` | **200** | env.ts:309 | Max events per pg-boss job after gateway chunking (per type). |
| `INGESTION_JOB_MAX_BYTES` | 1 MiB | env.ts:313 | Max serialized bytes per pg-boss job chunk (chunk splits early if exceeded). |
| Per-event byte cap | 256 KiB | service.ts:73 (`MAX_EVENT_BYTES`) | Any single event above this is rejected, not shed. |
| `INGESTION_BACKPRESSURE_HIGH_WATER` | 100,000 | env.ts:219 | Queue depth (pending jobs) at which low-tier/low-urgency events start shedding. |
| `INGESTION_BACKPRESSURE_CRITICAL_WATER` | 250,000 | env.ts:220 | Queue depth at which only top-urgency business/enterprise events survive. |
| `INGESTION_QUEUE_DEPTH_CACHE_MS` | 3,000 | env.ts:348 | Staleness window of the cached depth probe driving shedding decisions. |
| `INGESTION_JOB_RETRY_LIMIT` | 3 | env.ts:315 | pg-boss retries per job. |
| `INGESTION_JOB_RETRY_DELAY_SECONDS` | 5 | env.ts:316 | Base retry backoff. |
| `INGESTION_JOB_EXPIRE_SECONDS` | 300 | env.ts:314 | pg-boss job expiry / redelivery window. |
| `INGESTION_TYPE_WORKER_CONCURRENCY` | 2 | env.ts:341 | pg-boss `localConcurrency` per typed queue, per worker process. |
| `INGESTION_TYPE_WORKER_BATCH_SIZE` | 4 | env.ts:342 | Jobs delivered per callback batch, per typed queue. |
| `INGESTION_WRITE_POOL_SIZE` | 20 | env.ts:279 | Dedicated Log DB write pool max clients. |
| `INGESTION_WRITE_CONCURRENCY` | 16 | env.ts:283 | Configured DB-transaction admission permits (bounded further by pool - reserve). |
| `INGESTION_DB_POOL_SIZE` | 8 | env.ts:258 | Primary ingestion control pool (auth/queue/usage). |
| `INGESTION_FAIRNESS_MAX_DEFERS` | 5 | env.ts:326 | Fairness starvation-guard defer count before forced admission. |
| `INGESTION_ORG_RATE_LIMIT_PER_SECOND` | 5,000 | env.ts:320 | Per-org rate ceiling (not actively enforced on this path per service.ts:640). |
| `INGESTION_GZIP_MAX_BYTES` | 20 MiB | env.ts:318 | Declared; **unused** by active enforcement (prior audit finding, unchanged). |
| `INGESTION_FAST_REQUEST_MIN_DURATION_MS` | 1000 | env.ts:284 | Request-event outbox fast-path threshold. |

**Correction to prior audit language:** earlier `ingestionv2/` documentation described "normal jobs are capped at 200 events." That is the pg-boss **job chunk size**, not the HTTP batch limit. The actual HTTP-level ceiling per request is **1000 events** (`INGESTION_MAX_BATCH_SIZE`), which the gateway then splits into ≤200-event job chunks per type. The benchmark's batch-size sweep must test both the HTTP batch dimension (up to 1000) and observe resulting job chunk counts, not conflate the two.

## 3. Ten typed endpoints + one legacy mixed endpoint

Source of truth: `src/modules/ingestion/route-table.ts:47-57`.

| Path | Event type | Queue |
| --- | --- | --- |
| `POST /api/v1/errors` | `error` | `ingest.error` |
| `POST /api/v1/requests` | `request` | `ingest.request` |
| `POST /api/v1/traces` | `trace` | `ingest.trace` |
| `POST /api/v1/spans` | `span` | `ingest.span` |
| `POST /api/v1/metrics` | `metric` | `ingest.metric` |
| `POST /api/v1/logs` | `log` | `ingest.log` |
| `POST /api/v1/profiles` | `profile` | `ingest.profile` |
| `POST /api/v1/events` | `message` | `ingest.message` |
| `POST /api/v1/checkins` | `cron_checkin` | `ingest.cron_checkin` |
| `POST /api/v1/replays` | `replay` | `ingest.replay` |
| `POST /api/v1/ingest` (legacy, mixed types) | any | routed per event |

Typed routes reject any event whose `type` does not match the endpoint (`INVALID_EVENT_TYPE`, 400) — confirmed at `service.ts:641-648`.

## 4. Authentication contract the generator must replicate

`src/modules/ingestion/utils/api-key.ts:1-29`:

- `X-API-Key: <key>` header, **or**
- `Authorization: Bearer <key>` / `Authorization: ApiKey <key>`, **or**
- `apiKey` field in the JSON body (header takes precedence).

No `authenticate`/session middleware guards these write routes (confirmed absent from `routes.ts:236-269` `preHandler` arrays) — auth is entirely via API-key resolution inside the service. `resolveProject()` hits an LRU cache first, then falls back to `PostgresWriter.resolveApiKey()` SQL against `project_api_keys` joined to plan/rotation tables (`postgress.writter.ts:77-140`).

## 5. Response contract

`202` body: `{ success: true, accepted: number, rejected: number, batchId: string, errors?: Array<{eventId, reason}> }` (`service.ts:844-869`, `types.ts` `IngestResponse`). The generator must record **offered** (sent), **accepted** (from response), and **rejected/shed** (from response `errors[].reason`) as distinct counters — this is required by spec §9 and is directly available without additional instrumentation.

`accepted` in the response reflects **successful pg-boss enqueue**, not durable DB insertion. Durable insertion/COMMIT happens later, asynchronously, in the worker. This is the critical distinction spec §9 requires the benchmark to track across five different rate definitions (offered → accepted/enqueued → inserted → durable/committed → failed).

## 6. Idempotency / duplicate handling on this path

The gateway does **no** duplicate detection — events are carried raw and unvalidated beyond envelope checks (`service.ts:835-838` comment: "un-normalized... normalization is worker-side"). Deduplication happens worker-side via `ON CONFLICT DO NOTHING` against each typed table's unique index, confirmed present for all types **except** `events_logs` (see `ingestionv2/database/index-forensics.md` and `ingestionv2/ingestion/log-ingestion.md` — migration 030 not deployed). This is a **live blocker for duplicate-heavy/billing-sensitive benchmark profiles** against `log` events specifically; see §21 of the master prompt and the safety check this framework must implement.

## 7. Public-ID mechanism (verified, not re-derived)

Prior audit (unchanged, re-confirmed present): every typed table has a `NOT NULL` sequence-backed `DEFAULT nextval(...)` on `public_id`, plus a `BEFORE INSERT OR UPDATE` trigger (`trg_sync_typed_event_contract`) that only fires a second allocation when the ID is explicitly NULL/empty. This benchmark **observes** this mechanism (e.g., via generated public IDs in benchmark rows) and does **not** modify, disable, or A/B the trigger in any environment that shares production schema history. Trigger A/B testing (spec §17) is only valid in a schema clone that starts from an identical migration history to a Neon branch — never a hand-rolled schema.

## 8. Fairness and admission (unchanged from prior audit, re-confirmed)

- Fairness limits are **per worker process**, not fleet-wide: `TENANT_INFLIGHT_LIMIT` per plan tier (`queue/ingest-queues.ts:99-106`).
- Write admission is a 16-permit (default) FIFO semaphore bounded by `min(INGESTION_WRITE_CONCURRENCY, poolMax - reserve)`.
- Backpressure shedding at the gateway is **advisory and plan-aware**, not a hard queue cap — confirmed at `service.ts:415-430` (`shouldShed`).

## 9. What this benchmark must NOT do (non-negotiable, re-stated)

- No changes to `src/modules/ingestion/**` production behavior, `env.ts` defaults, queue options, pool sizes, indexes, or triggers.
- No auth bypass — the generator must obtain and use real API keys via the real resolution path.
- No direct-DB-insert path presented as "ingestion capacity" (spec §30). Any direct-DB microbenchmark (the existing `bench-ingestion-worker.ts`) is explicitly relabeled below.
- No destructive/high-volume run against a production-labelled target without an explicit environment override that defaults closed.

## Related

- [Existing tooling classification](02-existing-tooling-classification.md)

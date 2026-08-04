# Distributed Ingestion Routing Master Prompt

Use this prompt when converting the current mixed ingestion gateway into fully distributed SDK event routing.

## Context

The current backend has a mixed HTTP ingress model:

- Generic route: `POST /api/v1/ingest`
- Typed routes: `POST /api/v1/ingest/requests`, `/errors`, `/logs`, `/metrics`
- Internal routing: `IngestionService.processIngest()` groups events by `event.type` and enqueues one pg-boss job per `(type, chunk)` into `ingest.<type>`.
- Worker routing is already distributed: `WorkerRegistry` registers one worker pool per `SdkEventType` queue from `INGEST_QUEUES`.
- SDK config currently advertises route paths like `/v1/traces`, `/v1/requests`, `/v1/errors`, `/v1/metrics`, `/v1/logs`, `/v1/profiles`, `/v1/events`, `/v1/checkins`, `/v1/replays`, but the ingestion module does not expose all of those as public write routes.

## Goal

Refactor HTTP ingestion so each SDK event family has its own public write endpoint, while keeping queue names, priorities, billing behavior, and storage idempotency centralized.

## Required Route Contract

Expose these POST routes under the same prefix used by `ingestionModule`:

- `POST /v1/errors` -> `SdkEventType: error`
- `POST /v1/requests` -> `SdkEventType: request`
- `POST /v1/traces` -> `SdkEventType: trace`
- `POST /v1/spans` -> `SdkEventType: span`
- `POST /v1/metrics` -> `SdkEventType: metric`
- `POST /v1/logs` -> `SdkEventType: log`
- `POST /v1/profiles` -> `SdkEventType: profile`
- `POST /v1/events` -> general custom/message events. Decide whether this maps to `message`, accepts mixed non-specialized events, or remains a compatibility batch endpoint.
- `POST /v1/checkins` -> `SdkEventType: cron_checkin`
- `POST /v1/replays` -> `SdkEventType: replay`

Keep `POST /v1/ingest` only as a backwards-compatible legacy batch endpoint. Mark it in code comments as compatibility, not the primary SDK transport.

## Implementation Rules

1. Update `src/modules/ingestion/routes.ts` so route registration is data-driven from a route table instead of one hand-written method per event type.
2. Update `src/modules/ingestion/controller.ts` to expose one typed handler helper, for example `ingestTyped(type)`, or add methods for all event types if that matches the local style better.
3. Keep the service as the single policy boundary. Do not duplicate API-key validation, quota checks, rate limits, backpressure, event type checks, or queue priority logic in the controller.
4. Add a public service method such as `ingestTyped(req, apiKey, type)` that calls the existing central `processIngest(req, type, apiKey)`.
5. Keep internal queue dispatch using `ingestQueueFor(type)`, `jobPriority(planTier, type)`, and `enqueueIngestJobs()`.
6. Update SDK config route generation so advertised URLs exactly match live backend routes.
7. Preserve compatibility aliases only when they cannot conflict with read routes. For example, if `GET /v1/errors` already lists errors, `POST /v1/errors` can coexist safely by method.
8. Add tests that assert every route in `ROUTE_INGEST_PATHS` has a matching backend POST route and that wrong event types are rejected on typed routes.

## Billing And Plan Lookup Architecture

Primary DB remains source of truth for organizations, subscriptions, plans, entitlements, API keys, projects, and environments.

Request path:

1. API receives an SDK event request.
2. API key is resolved against primary DB with a short TTL cache.
3. Resolution returns project, org, environment id/name/slug, API key id, active status, and current billing plan tier.
4. The gateway enforces project and org rate limits plus a cached quota pre-check.
5. The gateway enqueues jobs with a billing snapshot in metadata: `planTier`, `apiKeyId`, `environment`, `receivedAt`, `batchId`.

Worker path:

1. Per-type workers consume `ingest.<type>` queues.
2. Worker fairness uses `metadata.planTier` and `TENANT_INFLIGHT_LIMIT`.
3. Worker persists telemetry into Log DB.
4. Worker increments billing staging counters only after idempotent inserts, so retries and duplicates are not billed twice.
5. `UsageRollup` drains `usage_counter_staging`, calls `increment_event_usage()` in primary DB, and updates durable usage counters.

Log DB lookup snapshot:

1. Keep `organization_lookup`, `project_lookup`, `environment_lookup`, and `api_key_lookup` in Log DB as denormalized snapshots only. Do not create foreign keys from Log DB to primary DB.
2. Extend `organization_lookup` if needed with plan snapshot fields such as `plan_id`, `plan_key`, `plan_name`, `plan_tier`, `subscription_status`, `billing_period_start`, `billing_period_end`, `synced_at`.
3. Sync lookup tables from primary DB using one of these patterns:
   - Best: CDC/outbox event from billing/project/environment changes.
   - Good: scheduled sync job that upserts changed rows by `updated_at`.
   - Fallback: lazy upsert during API-key resolution, never blocking ingestion.
4. Treat Log DB plan fields as analytics/read snapshots. Queue priority should use the plan tier resolved from primary DB or a recent cache entry, not a stale analytical lookup.
5. If plan resolution fails, fall back to `free` for queue priority and allow the request only if API-key identity is valid.

## Acceptance Criteria

- SDK config advertises only routes that exist on the backend.
- Each event type has a dedicated POST route.
- Mixed `/v1/ingest` remains backward compatible.
- A typed route rejects mismatched event types with `INVALID_EVENT_TYPE`.
- Queue dispatch still creates one job per `(event type, chunk)`.
- Plan tier is resolved from primary DB, carried in job metadata, and mirrored to Log DB lookup snapshots for analytics.
- No Log DB migration introduces cross-database foreign keys.

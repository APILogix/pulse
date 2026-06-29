# Alerting Module

Enterprise alerting: rule CRUD, event ingestion with deduplication, dynamic
routing to org-configured connectors, and high-throughput background delivery
via pg-boss batches of 100 processed with `Promise.allSettled` (no sequential
async loops, no N+1 writes).

Built on top of migration `migrations2/003_add_alerting_module` and reuses the
**connectors** module for delivery (`NotificationDispatcher`, `ConnectorRepository`,
and the shared circuit-breaker / rate-limiter in `connectors/runtime.ts`).

## File layout (`src/modules/alerting/`)

| File | Responsibility |
|---|---|
| `types.ts` | Zod schemas, DB row types, DTO shapes, error classes |
| `fingerprint.ts` | Deterministic fingerprint + dedup-key rendering (pure) |
| `evaluator.ts` | Condition evaluation engine with AND/OR grouping (pure) |
| `template.ts` | `{{var}}` rendering with HTML/control-char sanitization (pure) |
| `routing.ts` | Priority-ordered routing resolution with fallback (pure) |
| `repository.ts` | All SQL incl. **bulk** UNNEST operations + `getBatchWithEvents` |
| `batch-processor.ts` | The concurrent batch worker (Promise.allSettled) |
| `queue.ts` | pg-boss job names, worker registration, schedules |
| `service.ts` | Business logic + audit |
| `routes.ts` | Org-scoped REST endpoints |
| `alerting.module.ts` | Fastify plugin wiring |

## Performance contract (non-negotiable items)

- **Batch size 100.** `repository.createBatchFromPending` claims up to 100
  pending events (`FOR UPDATE SKIP LOCKED`) into one `alert_event_batches` row.
- **Concurrency, never sequential.** `batch-processor.ts` processes every event
  with `Promise.allSettled(events.map(...))`, and fans out per-connector with a
  nested `Promise.allSettled`. There are no `for`/`forEach` async loops over
  batch items.
- **Single fetches.** `getBatchWithEvents` loads the batch + all its events in
  one query; `connectorRepo.getByIds` loads every referenced connector in one
  query (`= ANY($1::uuid[])`).
- **Bulk writes.** Status updates use `UPDATE … FROM UNNEST(...)`; delivery logs
  use `INSERT … SELECT FROM UNNEST(...)`. No per-row writes in the worker.
- **Bulkhead + circuit breaker.** Each connector has its own circuit breaker
  (shared with the connectors feature), so one failing/slow connector only
  affects its own deliveries, not the batch.

## pg-boss jobs

Registered in the **worker process** (`workers/main.ts` →
`registerAlertingWorkers`). pg-boss is already started there.

| Job | Trigger | Purpose |
|---|---|---|
| `alert.form-batches` | cron `* * * * *` | Claim pending events → create batches → enqueue `alert.process-batch` |
| `alert.process-batch` | enqueued by form-batches | Deliver one batch of ≤100 events |
| `alert.auto-resolve` | cron `* * * * *` | Resolve stale `firing` events past `auto_resolve_at` |

Worker config (v12 option names): `localConcurrency: 5` (the spec's
teamSize/teamConcurrency — 5 independent workers), `retryLimit: 3`,
`retryDelay: 60`, `retryBackoff: true`, `expireInSeconds: 7200` (2h).

> The API process stays thin: ingesting an event only inserts a `pending` row.
> The scheduled `alert.form-batches` job (≈ every minute) turns pending events
> into `process-batch` jobs. This avoids requiring pg-boss in the API process,
> matching how the rest of the codebase splits API vs worker responsibilities.

## Alert lifecycle

1. **Ingest** (`POST .../alerting/events`): compute fingerprint → dedup check
   (fold into an active event within the rule's window, incrementing
   `duplicate_count`) → silence check (suppress at ingest if a matcher hits) →
   persist as `pending` (or `silenced`) + write history.
2. **Form batch** (worker): claim pending → `alert_event_batches`.
3. **Process batch** (worker): resolve routing per event → deliver to connectors
   concurrently → bulk-update event statuses → bulk-insert
   `alert_delivery_attempts` → complete the batch (`completed`/`partial`/`failed`).
4. **Acknowledge / Resolve / Silence**: user actions write to the event and an
   `alert_event_history` audit row.
5. **Auto-resolve** (worker): events past `auto_resolve_at` are resolved.

## API (org-scoped: `/organizations/:orgId/alerting`)

| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/rules`, `/rules/:id` | Rule CRUD (+ conditions/actions) |
| PATCH/DELETE | `/rules/:id` | Update / soft-delete |
| POST | `/rules/:id/enable` `/disable` `/test` `/clone` | Rule ops |
| POST | `/events` | Ingest an event (202; async pipeline) |
| GET | `/events`, `/events/:id`, `/events/:id/deliveries`, `/events/stats` | Read |
| POST | `/events/:id/acknowledge` `/resolve` `/silence` | Lifecycle |
| POST/GET/DELETE | `/silences` | Silence management |
| CRUD | `/escalation-policies`, `PUT /escalation-policies/:id/steps` | Escalation |
| CRUD | `/templates`, `POST /templates/:id/preview` | Templates |
| CRUD | `/routing-rules`, `POST /routing-rules/test` | Routing |
| GET | `/metrics` | Pre-aggregated metrics |

> Note: the spec lists `/api/v1/...` paths. This backend mounts feature modules
> under org-scoped prefixes (no `/api/v1`); alerting follows that convention so
> multi-tenancy (`:orgId` + `requireOrgAccess`) is enforced uniformly.

## Security

- Every route requires `authenticate` + `requireOrgAccess`; all queries are
  scoped by `organization_id` (service-layer isolation — RLS is left commented
  in the migration, consistent with the rest of the schema).
- Template values are **sanitized** (control chars stripped, HTML escaped)
  before rendering to prevent injection into Slack/Discord/email messages.
- Every state change (rule edits, ack, resolve, silence) writes an audit record
  via the shared `logAudit` plus an `alert_event_history` row.

## Tests

`test/unit/modules/alerting.test.ts` covers the pure logic — fingerprint/dedup,
the evaluation engine (operators + AND/OR grouping), template rendering +
sanitization, and routing resolution incl. fallback:

```bash
npx vitest run test/unit/modules/alerting.test.ts
```

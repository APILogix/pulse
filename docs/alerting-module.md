# Alerting Module

Enterprise alerting: rule CRUD, event ingestion with deduplication, dynamic
routing to org-configured connectors, and high-throughput background fan-out
via pg-boss batches of 100 processed with `Promise.allSettled` (no sequential
async loops, no N+1 writes). Alerting resolves recipients and enqueues
`connector-send`; provider delivery is performed by the connectors workers.

Built on top of migration `migrations2/003_alerting_create_core_schema` and reuses the
**connectors** module for delivery (`connector-send`, `ConnectorRepository`,
and the connector worker retry/circuit-breaker/rate-limiter path).

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
- **Bulk writes.** Status updates use `UPDATE â€¦ FROM UNNEST(...)`; delivery logs
  use `INSERT â€¦ SELECT FROM UNNEST(...)`. No per-row writes in the worker.
- **Queued connector delivery.** The batch worker records alert delivery
  attempts as `queued` after durable `connector-send` enqueue. Connector
  workers own provider I/O, circuit breakers, retries, and delivery history.
- **Connector route targets.** Alert routing rules can target connector routes
  through `target_route_ids`. The batch worker resolves enabled
  `connector_routes` by organization ownership and matches project,
  environment, event type, and severity before enqueueing `connector-send`.

## pg-boss jobs

Registered in the **worker process** (`workers/main.ts` â†’
`registerAlertingWorkers`). pg-boss is already started there.

| Job | Trigger | Purpose |
|---|---|---|
| `alert.form-batches` | cron `* * * * *` | Claim pending events â†’ create batches â†’ enqueue `alert.process-batch` |
| `alert.process-batch` | enqueued by form-batches | Deliver one batch of â‰¤100 events |
| `alert.auto-resolve` | cron `* * * * *` | Resolve stale `firing` events past `auto_resolve_at` |

Worker config (v12 option names): `localConcurrency: 5` (the spec's
teamSize/teamConcurrency â€” 5 independent workers), `retryLimit: 3`,
`retryDelay: 60`, `retryBackoff: true`, `expireInSeconds: 7200` (2h).

> The API process stays thin: ingesting an event only inserts a `pending` row.
> The scheduled `alert.form-batches` job (â‰ˆ every minute) turns pending events
> into `process-batch` jobs. This avoids requiring pg-boss in the API process,
> matching how the rest of the codebase splits API vs worker responsibilities.

## Alert lifecycle

1. **Ingest** (`POST .../alerting/events`): compute fingerprint â†’ dedup check
   (fold into an active event within the rule's window, incrementing
   `duplicate_count`) â†’ silence check (suppress at ingest if a matcher hits) â†’
   persist as `pending` (or `silenced`) + write history.
2. **Form batch** (worker): claim pending â†’ `alert_event_batches`.
3. **Process batch** (worker): resolve routing per event â†’ enqueue
   `connector-send` jobs concurrently â†’ bulk-update event statuses â†’
   bulk-insert queued `alert_delivery_attempts` â†’ complete the batch
   (`completed`/`partial`/`failed`).
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
  scoped by `organization_id` (service-layer isolation â€” RLS is left commented
  in the migration, consistent with the rest of the schema).
- Template values are **sanitized** (control chars stripped, HTML escaped)
  before rendering to prevent injection into Slack/Discord/email messages.
- Every state change (rule edits, ack, resolve, silence) writes an audit record
  via the shared `logAudit` plus an `alert_event_history` row.

## Tests

`test/unit/modules/alerting.test.ts` covers the pure logic â€” fingerprint/dedup,
the evaluation engine (operators + AND/OR grouping), template rendering +
sanitization, and routing resolution incl. fallback.
`test/unit/modules/alerting-batch-processor.test.ts` covers connector job
enqueueing from the batch worker:

```bash
npx vitest run test/unit/modules/alerting.test.ts test/unit/modules/alerting-batch-processor.test.ts
```


# 04 — Trigger and Scheduler Flow

## Event-driven automation trigger

1. Producer: `POST /organizations/:orgId/automation/events` → `AutomationController.ingestEvent` → `AutomationService.ingestEvent` (service.ts:538-583). Checks read access, entitlement, `LIMITS.MAX_PAYLOAD_SIZE_BYTES` (via `Buffer.byteLength`), project ownership if `projectId` supplied.
2. `repo.insertInboxEvent`: `INSERT INTO automation_events_inbox ... ON CONFLICT (organization_id, dedupe_key) DO NOTHING RETURNING *`. Dedup lookup uses `organization_id IS NOT DISTINCT FROM $2::uuid` so NULL-org (system-wide) rows dedupe correctly too.
3. On success (not a dedupe hit), audits `trigger.received` and enqueues `automation.inbox.process` → `pgboss.send('automation-inbox', ...)`.
4. `processInbox()` worker claims a batch via `claimInboxEvents` — real `FOR UPDATE SKIP LOCKED`, self-healing stuck `processing` rows older than 5 minutes.
5. NULL-org events are immediately completed without matching any workflow (defensive: prevents any possibility of an org-less event executing a tenant's workflow).
6. `findMatchingWorkflows(orgId, sourceModule, eventType)` joins enabled workflows to enabled triggers on `source_module`/`source_event`. Project-scoped workflows require an **exact** `event.projectId === wf.projectId` match — `null` never matches a project-scoped workflow.

**Who actually produces events into this pipeline today:** the explicit external `/events` API, and internally, the schedule sweep (step below). No other module in the repo (alerting, ingestion, billing) was found calling this API or `insertInboxEvent` directly. See `02-current-architecture.md`. If the product intends "an alert firing triggers an automation," that wiring does not currently exist — **MISSING**, not broken.

## Schedule-driven (cron) automation trigger

`runScheduleSweep()` in `workers.ts`, on pg-boss native cron `* * * * *` (every minute), registered via `pgboss.schedule(AUTOMATION_QUEUES.schedule, ...)`.

Due-workflow query (own transaction, `pool.connect()` + `BEGIN`):
```sql
SELECT w.id AS workflow_id, w.organization_id, w.project_id, t.id AS trigger_id,
       t.schedule_cron, t.trigger_type, t.source_module, t.cooldown_seconds,
       t.timezone AS trigger_timezone, w.next_run_at
FROM automation_workflows w
JOIN automation_triggers t ON t.workflow_id = w.id AND t.deleted_at IS NULL
WHERE w.is_enabled = TRUE
  AND w.deleted_at IS NULL
  AND t.trigger_kind = 'schedule'
  AND t.schedule_cron IS NOT NULL
  AND t.is_enabled = TRUE
  AND (w.next_run_at IS NULL OR w.next_run_at <= NOW())
ORDER BY w.next_run_at ASC NULLS FIRST
LIMIT 50
FOR UPDATE OF w SKIP LOCKED
```

For each due row: `nextCronOccurrence(cron, now, timezone)` (custom parser, `cron.ts`, no external dependency, supports lists/ranges/steps/names, timezone-aware via `Intl.DateTimeFormat`, bounded to 1-year lookahead). If the cron expression is invalid, the workflow is disabled in the same transaction (`is_enabled=FALSE, status='disabled'`, audited `workflow.disabled` reason `invalid_cron`) — this is a real safety net against a malformed cron silently never firing or firing every tick. Otherwise `next_run_at` is advanced and (unless this is first-ever initialization) an inbox row is inserted with `event_type='schedule.cron'`, `dedupe_key = 'schedule:{orgId}:{workflowId}:{dueTimestamp-to-minute}'`, `ON CONFLICT ... DO NOTHING`. Entire batch commits or rolls back atomically.

## Restart / missed-schedule behavior

Because "due" is computed from `next_run_at <= NOW()` rather than a fixed fire-once timestamp, a scheduled workflow that was due while the worker process was down will fire exactly once, on the next sweep tick after restart — it does not fire multiple times to "catch up," and it is not silently lost, because `next_run_at` is a durable column, not an in-memory timer. This is a real, evidence-based behavior (not inferred): the query has no upper bound on staleness (`next_run_at <= NOW()` matches arbitrarily-old due timestamps), and the advance-and-insert happens together in the same transaction as the claim, so there is no window where a second sweep tick (e.g. from a second worker replica racing at the same minute) could double-fire — `FOR UPDATE OF w SKIP LOCKED` prevents that.

**One gap**: DST and timezone edge cases in `nextCronOccurrence` were not independently tested in this audit (no fixture-based DST test was found in `automation-workers.test.ts` at the depth this audit went to) — status **NOT VERIFIED** for DST correctness specifically, though the timezone-awareness itself is real code, not a stub.

## Concurrency across schedule + event triggers for the same workflow

The per-workflow advisory lock used in `processInbox()`'s cooldown/rate-limit gate (see `09-transaction-and-concurrency.md`) is keyed only by workflow ID, so a workflow that has both a schedule trigger and (hypothetically) an event trigger sharing the same workflow would still be serialized correctly against itself — the lock isn't trigger-specific, it's workflow-specific.

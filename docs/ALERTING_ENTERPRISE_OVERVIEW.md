# Enterprise Alerting Module — Mandatory Agent Overview

> **Read this file first** before editing any code in `pulse/src/modules/alerting/`, `pulse/src/modules/connectors/`, or alerting-related migrations.
> This document describes the current architecture, the PostgreSQL schema, the end-to-end alert flow, the enterprise reliability machinery (pg-boss queues, dead-letter queue, escalation engine, throttling, retention), and the gaps that remain.
>
> **Status: ENTERPRISE CORE IMPLEMENTED** (migration `08_alerting/017_enterprise_readiness.up.sql`, applied 2026-07-18). Escalation execution, rule-action delivery, throttling, DLQ, orphan recovery, and retention cleanup are live — see §7 for per-item status.

---

## 1. What This Module Is

The alerting module is a multi-tenant, event-driven notification system. It is responsible for:

1. **Ingesting alert events** from internal monitors (API latency spikes, error-rate thresholds, custom triggers) via an org-scoped REST API.
2. **Evaluating alert rules** with conditions (threshold / change / anomaly / static / composite, AND/OR groups).
3. **Routing notifications** to connectors (Slack, email, webhook, etc.) using priority-ordered routing rules **plus** per-rule actions.
4. **Delivering notifications** through the connector module, which owns provider I/O, retries, circuit breakers, and rate limits.
5. **Tracking state** across the lifecycle: `pending → processing → firing → acknowledged → resolved` (plus `silenced` / `suppressed` / `error`).
6. **Escalating** unacknowledged alerts through multi-step escalation policies.
7. **Throttling** notification storms per rule action.
8. **Recovering** from crashes: dead-letter queue, orphan requeue, retention purge.

Module boundary (do not blur it):

- **Alerting module** decides *what* to send and *who* should receive it.
- **Connector module** (`pulse/src/modules/connectors/`) decides *how* to send it and *whether* delivery succeeded.

---

## 2. Queue Infrastructure — pg-boss (NOT BullMQ)

All alerting and connector queues run on **pg-boss v12** backed by Postgres. The singleton is `pulse/src/lib/pgboss.ts` (`export const pgboss`). BullMQ is still in `package.json` but is **not** used by alerting/connectors — do not add new BullMQ code.

Concurrency guarantees (enterprise requirements — preserve them):

- pg-boss fetches jobs internally with `FOR UPDATE SKIP LOCKED` — two workers never receive the same job.
- Every DB-side claim query (pending events, due escalations, expired acks, stuck processing, retryable dead letters) also uses `FOR UPDATE SKIP LOCKED`.
- Scheduled jobs are created with `singletonKey` so multiple worker processes never double-run a schedule.
- `alert.process-batch` is created with `{ retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 7200, deadLetter: 'alert-dead-letter' }`.

Workers are registered by `registerAlertingWorkers(...)` in `pulse/src/modules/alerting/queue.ts`, started from `pulse/src/shared/workers/main.ts` (`npm run dev:workers`). The API process stays thin: it only inserts `pending` events.

### Job inventory

| Job | Schedule | Purpose |
|-----|----------|---------|
| `alert.form-batches` | `* * * * *` | Claim pending events (SKIP LOCKED), create `alert_event_batches`, enqueue one `alert.process-batch` per batch. Batch id + pg-boss job id are cross-recorded (`pg_boss_job_id`). |
| `alert.process-batch` | on demand | Route + deliver one batch (see §3). Retries 3× with backoff, then dead-letters. |
| `alert.escalation-sweep` | `* * * * *` | Resume expired acknowledgments; advance due escalation steps (`next_escalation_at <= now()`). |
| `alert.auto-resolve` | `* * * * *` | Auto-resolve firing events past `auto_resolve_at`. |
| `alert.orphan-sweep` | `*/5 * * * *` | Requeue events stuck in `processing` > 15 min (crash recovery); fail stale `processing` batches. |
| `alert.dead-letter-retry` | `*/5 * * * *` | Re-drive retryable rows in `alert_dead_letter_events` (only while the batch is still `processing`). |
| `alert.cleanup` | `17 3 * * *` (daily) | Retention purge: terminal events, batches, delivery attempts, dead letters, stale throttle windows. |
| `alert-dead-letter` | on failure | pg-boss dead-letter queue for `alert.process-batch`; persisted to `alert_dead_letter_events` + history `dead_lettered`. |

---

## 3. End-to-End Alert Flow

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. INGEST (POST /organizations/:orgId/alerting/events)                     │
│    - fingerprint computed/provided; dedup folds repeats into the active    │
│      event (duplicate_count++) within the rule's dedup window              │
│    - active silence match → status 'silenced'                              │
│    - else status 'pending' + history 'triggered'                           │
└────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 2. BATCHING (alert.form-batches, every minute)                             │
│    - claimPendingEvents: SELECT ... FOR UPDATE SKIP LOCKED (batch claim)   │
│    - INSERT alert_event_batches (status 'processing', event_ids[],         │
│      pg_boss_job_id)                                                       │
│    - enqueue alert.process-batch { batchId, organizationId }               │
└────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 3. PROCESSING (alert.process-batch) — AlertBatchProcessor                  │
│    a. Idempotency guard: skip unless batch.status = 'processing'           │
│    b. Load batch + events in ONE query                                     │
│    c. Bulk-load rule actions, escalation steps, throttle states            │
│    d. Merge rule-action targets with routing targets                       │
│       (dedup by connector:route; rule-action targets win)                  │
│    e. THROTTLE check per rule action (throttle_duration_seconds +          │
│       max_notifications_per_hour, backed by alert_throttle_windows);       │
│       throttled targets are logged as delivery attempts                    │
│       status='cancelled', error_category='throttled'                       │
│    f. Enqueue connector-send-<type> jobs per target                        │
│    g. Record throttle usage for delivered actions                          │
│    h. Initialize escalation for firing events: first escalate-action       │
│       policy → next_escalation_at = now + first step wait                  │
│    i. Bulk-update event statuses (UNNEST) + batch counters                 │
└────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 4. CONNECTOR DELIVERY (connector-send-<type> jobs)                         │
│    Connector workers resolve credentials/routes, call the provider API     │
│    with retry/circuit-breaker/rate-limit, and write                        │
│    connector delivery attempts + audit logs.                               │
└────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 5. LIFECYCLE + ESCALATION (alert.escalation-sweep, every minute)           │
│    - resumeExpiredAcknowledgments: ack expired → back to firing,           │
│      escalation clock restarted                                            │
│    - claimEscalationDue (FOR UPDATE SKIP LOCKED): events with              │
│      next_escalation_at <= now() and status firing/acknowledged            │
│    - advanceEscalation: next step = first step_number > current; notify    │
│      its targets via connector-send jobs with [ESCALATION step N];         │
│      schedule following step wait; wrap-around repeat honors               │
│      repeat_interval_minutes / max_repeats (0 = unlimited)                 │
│    - exhausted → next_escalation_at = NULL + history 'escalated'           │
└────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 6. FAILURE RECOVERY                                                        │
│    - process-batch fails 3× → pg-boss dead-letters → row in                │
│      alert_dead_letter_events + history 'dead_lettered'                    │
│    - alert.dead-letter-retry re-drives retryable rows                      │
│    - alert.orphan-sweep requeues events stuck in 'processing'              │
│    - Admin API: list / manual retry / discard (§6.3)                       │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. PostgreSQL Schema (source of truth)

Migrations: `pulse/src/db/postgres/canonical_migrations_draft/08_alerting/001..017`. Runner: `npm run db:migrate:draft` (ledger: `schema_migrations`, each file in BEGIN/COMMIT).

### 4.1 Enums (exact values)

| Enum | Values |
|------|--------|
| `alert_severity` | `info`, `warning`, `error`, `critical` |
| `alert_event_status` | `pending`, `processing`, `firing`, `resolved`, `acknowledged`, `suppressed`, `silenced`, `error` |
| `alert_status` (rules) | `firing`, `resolved`, `acknowledged`, `suppressed`, `silenced`, `pending` |
| `alert_condition_type` | `threshold`, `change`, `anomaly`, `static`, `composite` |
| `alert_action_type` | `notify`, `webhook`, `suppress`, `escalate`, `group` |
| `delivery_attempt_status` | `pending`, `queued`, `sent`, `delivered`, `failed`, `retrying`, `cancelled` |
| `batch_status` | `pending`, `processing`, `completed`, `failed`, `partial` |
| `history_action` | `triggered`, `acknowledged`, `resolved`, `escalated`, `suppressed`, `notified`, `silenced`, `grouped`, `auto_resolved`, `rule_modified` **+ (017)** `escalation_step`, `throttled`, `dead_lettered`, `requeued` |
| `metric_granularity` | `hour`, `day`, `week`, `month` |
| `alert_dead_letter_status` **(017)** | `pending_retry`, `retried`, `exhausted`, `discarded` |

### 4.2 Tables

| Table | Purpose |
|-------|---------|
| `alert_rules` | Configurable rules: org, enabled, severity, evaluation window, dedup window, auto-resolve minutes. |
| `alert_rule_conditions` | Normalized conditions per rule (field, operator, threshold, grouping, order). |
| `alert_rule_actions` | Normalized actions per rule: `action_type`, connector/route/template refs, **`throttle_duration_seconds`, `max_notifications_per_hour`, `escalation_policy_id`**, priority/order. |
| `alert_events` | Ingested events: org, rule, status, fingerprint, severity, source, labels, payload, dedup count, ack/resolve metadata, **(017)** `escalation_policy_id`, `escalation_step_number`, `escalation_repeat_count`, `next_escalation_at`. |
| `alert_event_history` | Immutable state-transition audit (`history_action` enum). |
| `alert_silences` | Time-boxed silences by rule + label matchers. |
| `alert_acknowledgments` | Who acknowledged what, optional expiry. |
| `alert_escalation_policies` | Named policies with `repeat_interval_minutes`, `max_repeats`. |
| `alert_escalation_steps` | Ordered steps per policy: wait time, connector/route targets, template. |
| `alert_event_batches` | Batch bucket: status, event count, **(017)** `event_ids[]`, `skipped_count`, `pg_boss_job_id`. |
| `alert_delivery_attempts` | Per-event, per-target delivery log (status, error, category). |
| `alert_templates` | Reusable subject/body templates with `{{variables}}`. |
| `alert_routing_rules` | Priority-ordered routing: severity/source/label match → connector/route. |
| `alert_rule_executions` | Rule evaluation runs. |
| `alert_metrics` | Aggregated alerting metrics by granularity. |
| `alert_throttle_windows` **(017)** | Throttle state per rule action: `UNIQUE(rule_action_id, window_start)`, `notification_count`, `last_notified_at`. |
| `alert_dead_letter_events` **(017)** | Failed batch jobs: source queue, pg-boss job id, batch id, `event_ids[]`, job payload, error, `status` (`alert_dead_letter_status`), retry budget, discard audit. |

### 4.3 Enterprise indexes (017)

| Index | Purpose |
|-------|---------|
| `idx_alert_events_pending_claim` on `(organization_id, created_at) WHERE status='pending'` | Fast batch claim. |
| `idx_alert_events_stuck_processing` on `(updated_at) WHERE status='processing'` | Orphan sweep. |
| `idx_alert_events_expired_ack` | Expired-acknowledgment resume. |
| `idx_alert_events_next_escalation` | Escalation sweep claim. |
| `idx_alert_events_escalation_policy` | Policy lookups. |
| `idx_alert_event_batches_stuck` | Stale batch detection. |
| delivery attempts `(organization_id, created_at)` | Org-scoped delivery listing. |

---

## 5. Key Code Files

### Alerting (`pulse/src/modules/alerting/`)

| File | Purpose |
|------|---------|
| `alerting.module.ts` | Fastify module wiring (`fastify.alerting.service`). |
| `service.ts` | `AlertingService` facade delegating to sub-services. |
| `routes.ts` + `<sub>/<sub>.routes.ts` | Org-scoped REST (authenticate + requireOrgAccess, Zod-validated). |
| `queue.ts` | **pg-boss** queue creation (retry/DLQ options), all 8 workers, schedules. |
| `batch-processor.ts` | `AlertBatchProcessor`: routing merge, throttling, escalation init, connector-send enqueue. |
| `escalation.ts` | `AlertEscalationSweep`: expired acks + step advancement + repeat logic. |
| `evaluator.ts` | Rule-condition evaluation. |
| `routing.ts` | Routing-rule resolution to connector/route targets. |
| `fingerprint.ts` | Event fingerprinting (dedup + silence key — do not change casually). |
| `template.ts` | Template rendering / variable extraction. |
| `repository.ts` | `AlertingRepository` facade over sub-repositories. |
| `types.ts` | Barrel re-export of all submodule types. |
| `events/` | Event ingestion, lifecycle, batches, **dead-letter admin**, purges. |
| `rules/` | Rule CRUD (+ `getRuleActionsByRuleIds` bulk loader). |
| `policies/` | Escalation policy CRUD (+ `listEscalationStepsByPolicyIds`). |
| `silences/` | Silence CRUD + matching. |
| `templates/` | Template CRUD + preview. |
| `routing/` | Routing rule CRUD + test. |
| `metrics/` | Metrics + realtime stats. |

### Connector (`pulse/src/modules/connectors/`)

Provider registry, encrypted credentials, routes, `connector-send-<type>` delivery workers, health checks, audit logs. Alerting only ever enqueues connector jobs — it never calls provider APIs directly.

---

## 6. Enterprise Reliability

### 6.1 Failure model

1. `alert.process-batch` throws → pg-boss retries 3× (60s backoff).
2. Still failing → pg-boss moves the job to `alert-dead-letter` → worker persists a row in `alert_dead_letter_events` (`pending_retry`) + history `dead_lettered`.
3. `alert.dead-letter-retry` (every 5 min) re-sends the job **only if the batch is still `processing`**; otherwise the orphan sweeper's recovery owns the events (no double delivery).
4. Retry budget exhausted → `exhausted`. Operator discards → `discarded` (audited).
5. Worker crash mid-batch → events stay `processing`; `alert.orphan-sweep` requeues them to `pending` after 15 min and fails the stale batch. The batch processor's idempotency guard (`batch.status != 'processing' → skip`) makes re-drive safe.

### 6.2 Retention (daily `alert.cleanup`, configurable via `AlertingWorkerConfig`)

| Data | Default retention |
|------|-------------------|
| Terminal events (resolved/silenced…) | `retentionResolvedEventsDays` |
| Batches | `retentionBatchesDays` |
| Delivery attempts | `retentionDeliveryAttemptsDays` |
| Dead letters | `retentionDeadLettersDays` |
| Stale throttle windows | purged when no longer referenced |

### 6.3 Dead-letter admin API (org-scoped, authenticated)

| Endpoint | Purpose |
|----------|---------|
| `GET /organizations/:orgId/alerting/dead-letters?status=&limit=&offset=` | List dead letters (filter by `alert_dead_letter_status`). |
| `POST /organizations/:orgId/alerting/dead-letters/:id/retry` | Manual re-drive. Only allowed while the batch is still `processing` (409 otherwise — automatic recovery owns it). |
| `DELETE /organizations/:orgId/alerting/dead-letters/:id` | Discard (idempotent, audited). |

### 6.4 Throttling

Per rule action, enforced in the batch processor against `alert_throttle_windows`:

- `throttle_duration_seconds` — minimum gap between notifications for the action.
- `max_notifications_per_hour` — hourly cap within the current window.

Throttled targets are **not** silently dropped: a delivery attempt with `status='cancelled'`, `error_category='throttled'` is written, and history `throttled` is available for audit.

### 6.5 Escalation engine

- Armed at batch time: a firing event with an `escalate` rule action gets `escalation_policy_id`, `escalation_step_number = 0`, `next_escalation_at = now + first step wait`.
- Sweep advances steps (`escalation_step` history per hop), notifies step targets with `[ESCALATION step N]` payloads.
- After the last step: wrap-around repeat while `escalation_repeat_count < max_repeats` (`0` = unlimited), spacing repeats by `repeat_interval_minutes`.
- Expired acknowledgments are resumed first, so an ack that lapses re-enters escalation instead of going quiet.
- Acknowledge or resolve the event to stop escalation (`next_escalation_at = NULL`).

---

## 7. Enterprise Gap Status

| # | Item | Status |
|---|------|--------|
| 7.1 | Escalation execution | **IMPLEMENTED** — `escalation.ts` sweep, event escalation columns, step advancement, repeat/exhaust. |
| 7.2 | Guided custom-rule builder (no-JSON) | Open — API takes structured conditions; a friendlier builder DTO is still wanted. |
| 7.3 | Alert grouping / correlation ("X is flapping") | Open — `group` action type exists in the enum but no correlation window/grouping key yet. |
| 7.4 | Scheduled metric-based rule evaluation (SLO queries on a cron emitting synthetic events) | Open — rules evaluate on ingest only. |
| 7.5 | On-call rotation integration (PagerDuty/Opsgenie schedule-aware routing) | Open. |
| 7.6 | Multi-channel notification policies | **IMPLEMENTED** — multiple actions per rule (connector/route/template each) + escalation policies for tiered notify. |
| 7.7 | Alert-fatigue throttling | **IMPLEMENTED** — per-action duration + hourly cap (`alert_throttle_windows`). |
| 7.8 | Bi-directional ack from channels (Slack button → ack) | Open — acks are API-only today. |
| 7.9 | API-first customer self-service | Mostly done — org-scoped CRUD for rules, routing, templates, silences, policies, dead letters exists with auth + audit. RBAC granularity review still open. |
| 7.10 | HA / reliability / DLQ | **IMPLEMENTED** — pg-boss retry+backoff, `alert-dead-letter` queue, `alert_dead_letter_events`, dead-letter retry sweep, orphan requeue, idempotent processing, retention cleanup, SKIP-LOCKED claims everywhere. |

---

## 8. What an Agent Must Verify Before Changing Code

1. **Read the migrations first.** Schema is the source of truth: `pulse/src/db/postgres/canonical_migrations_draft/08_alerting/` (001–017) and `06_connectors/`.
2. **pg-boss, not BullMQ.** Use the singleton from `pulse/src/lib/pgboss.ts`. Workers receive an **array** of jobs (`pgboss.work(name, opts, handler)`).
3. **Trace the real job flow:** `alert.form-batches` → `alert.process-batch` → `connector-send-<type>`, plus the sweeps in §2. Do not rely on old placeholders (`notifier.ts`, `shared/workers/alerting.processor.ts`).
4. **Respect the module boundary.** Alerting enqueues; connectors execute. No provider API calls inside alerting.
5. **Keep claims race-safe.** Any new "claim rows to work on" query must use `FOR UPDATE SKIP LOCKED` (or the batch-claim pattern already present). Scheduled jobs need `singletonKey`.
6. **Keep writes batched.** Bulk `UNNEST` updates + `Promise.allSettled`/bounded maps. No N+1 loops.
7. **Failures must dead-letter, not vanish.** Any new risky job type gets retry options + a dead-letter target, and a persistence path into `alert_dead_letter_events` if it carries alert payloads.
8. **Silences suppress, not delete.** Silenced events transition state; they are never dropped without a history row.
9. **Fingerprinting is load-bearing.** Changing it breaks dedup, silencing, and grouping.
10. **Connector credentials are encrypted.** Never log or return raw credentials.
11. **Every delivery writes audit records** — `alert_delivery_attempts` (alerting) and connector attempts/logs (connectors). Throttled/skipped targets are logged, not silently ignored.
12. **Register workers in one place.** New workers go through `registerAlertingWorkers` (`queue.ts`) started from `pulse/src/shared/workers/main.ts`; verify the job-name constant in `ALERT_JOBS`.
13. **New schema → new migration file only.** Never edit applied migrations; add `0NN_*.up.sql` and run `npm run db:migrate:draft`. Verify with `npx tsc --noEmit` afterwards.

---

## 9. Quick Reference: Adding a New Enterprise Alert Rule Type

1. Add the rule type to the alerting enum (new migration) + Zod schema in `rules/rules.types.ts`.
2. Extend `evaluator.ts` for the new condition logic.
3. Update rule DTOs/service (`rules/`).
4. Ensure the batch processor routes and templates the new type correctly.
5. Cover with tests: rule creation → ingest evaluation → routing → connector enqueue → delivery-attempt logging.
6. If evaluation is periodic (metrics-based), that is gap 7.4 — design a scheduler worker instead of bolting cron logic into ingest.

---

## 10. Contact / Next Steps

- Bug in delivery? Start at `batch-processor.ts` and the `alert.process-batch` worker; check `alert_dead_letter_events` and `alert_delivery_attempts` before touching code.
- New feature? Confirm schema support first (escalation/throttle/DLQ already exist — reuse them).
- New connector provider? Implement under `pulse/src/modules/connectors/` and register it; alerting code should not change.

---

*Last updated: 2026-07-18 — enterprise readiness release (migration 017 + queue/escalation/DLQ implementation).*
*Scope: `pulse/src/modules/alerting/`, `pulse/src/modules/connectors/`, and related migrations.*

# 02 — Current Architecture (as discovered, not idealized)

## Two independent subsystems, one queue backend

```
                         src/lib/pgboss.ts (singleton PgBoss instance)
                                     |
                 -----------------------------------------
                 |                                         |
   src/modules/automation/**                  src/modules/alerting/**
   (no-code workflow engine)                   (rule-based alert/notification engine)
```

FACT: both modules import the same `pgboss` singleton exported from `src/lib/pgboss.ts`. They are differentiated purely by queue-name prefix (`automation-*` vs `alert.*`/bare names like `escalate`, `cleanup`). There is no automation-vs-alerting resource isolation at the queue-backend level — both share the same Postgres-backed pg-boss job tables and the same worker process's concurrency budget if run together.

`src/lib/pgboss.ts` wraps a custom `ResilientPgBossDb` adapter (extends `EventEmitter`) around a `pg.Pool`, purpose-built to survive serverless Postgres (Neon) cold starts / idle disconnects. Process role is inferred from entrypoint path: files under `src/shared/workers/` are workers (full pg-boss runtime: `schedule: true`, `supervise: true`), everything else is `producerOnly` (API processes only call `pgboss.send`, never run cron/maintenance). This deliberately avoids duplicate cron ticks across horizontally-scaled API replicas.

## Process topology

- `src/main.ts` — API process (HTTP only, producer-only pg-boss role)
- `src/shared/workers/alert-workers-main.ts` — starts `registerAlertingWorkers()` from `src/modules/alerting/queue.ts`
- `src/shared/workers/ingestion-worker-main.ts` — telemetry ingestion + outbox writer (feeds alerting's fast tier; no automation involvement)
- `src/shared/workers/main.ts` — general worker process; automation's `registerAutomationWorkers()` is wired in here (no dedicated `automation-workers-main.ts` file exists)
- `src/shared/workers/cron.ts` — worker-side scaffolding for non-alerting cron jobs

## Automation module — actual architecture

```
Client → POST /organizations/:orgId/automation/workflows  (routes.ts → controller.ts → service.ts)
              ↓ validation, entitlement, quota, project-ownership check
       INSERT automation_workflows (draft, is_enabled=FALSE) + versions/triggers/conditions/actions
              ↓ (separate call)
       POST /workflows/:id/publish  (requires published version to enable)
       POST /workflows/:id/enable   → UPDATE automation_workflows SET is_enabled=TRUE, status='active'
              ↓
  Trigger source (one of two, both funnel into insertInboxEvent → automation_events_inbox):
    (a) POST /organizations/:orgId/automation/events  (explicit external event API)
    (b) runScheduleSweep() cron sweep (workers.ts) for schedule_cron-configured triggers
              ↓ pgboss.send('automation-inbox', ...)
       processInbox() worker: claimInboxEvents (FOR UPDATE SKIP LOCKED) → findMatchingWorkflows
       → evaluateConditions() (evaluator.ts) → atomic cooldown+rate-limit gate (advisory lock)
       → createRunWithSteps() → INSERT automation_runs + automation_run_steps
              ↓ pgboss.send('automation-run-execute', { singletonKey: run:<id> })
       executeRun() worker: claimNextStep (sequential, FOR UPDATE SKIP LOCKED)
       → approval gate (automation_approvals) if high/critical risk
       → ActionRunnerRegistry.execute() (action-runner.ts)
       → aggregateRunCompletion()
              ↓
       AutomationAuditRepository.insertAuditLog() → automation_audit_logs (every lifecycle transition)
```

IMPORTANT CAVEAT (see `08-database-schema-and-query-audit.md`): the columns this pipeline depends on for claiming/locking/retrying (`next_retry_at`, `locked_at`, `locked_by`, `attempts`, `sort_order`, `timeout_at`, `idempotency_key`) were not found in any committed migration for these four tables. This diagram describes the code's intended behavior; whether it matches the real deployed schema is **NOT VERIFIED**.

There is **no automatic bridge from telemetry ingestion or the alerting engine into automation**. The only inbound event producers found in `src/modules/automation/**` are the explicit `/events` API and the internal cron sweep — this is a FACT based on searching for cross-module callers of `insertInboxEvent`/`enqueueAutomationJob`; none were found outside the automation module itself. If a customer expects "alert fires → automation runs," that integration does not exist today unless something outside this module calls the automation `/events` endpoint (not found in this pass).

## Alerting module — actual architecture

Per `docs/ALERTING_END_TO_END_FLOW.md` (treated as the current ground truth for "how it works," re-verified spot checks in this audit): 3-process (API / ingestion worker / alert worker) × 3-datastore (PRIMARY DB / Log DB / Redis) design.

```
SDK/API ingestion → events_requests (Log DB, outbox pattern) → TelemetryOutboxRelay (1s poll)
      ↓
AlertRuntimeEngines.evaluateFast/evaluateTier() (4 tiers: fast ~1s, window ~5s, operational ~30s, ai ~300s)
      ↓ evaluator.ts (shared condition matcher, both tiers)
AlertDecisionEngine.decide() → lockState (FOR UPDATE per alert_key) → alert_events_v2 (append) + alert_event_state (projection) + alert_event_history_v2 (audit)
      ↓
NotificationRoutingService → AlertChannelRepository/AlertConfigRepository (routing + entitlement)
      ↓
insertNotificationJobs → alert_notification_jobs
      ↓ AlertNotificationRouter.dispatchById() (claimDueNotificationJobs, FOR UPDATE SKIP LOCKED)
connectors/* (webhook/Slack/Discord/Teams/PagerDuty/email/SMS) → httpRequest() (SSRF-checked)
      ↓
IncidentsRepository (PRIMARY DB alert_incidents/alert_incident_events) — best-effort, try/catch, never blocks delivery
Escalation: AlertEscalationSweep / SnapshotEscalationWorker (escalation.ts is the only one with live call sites; SnapshotEscalationWorker is dead code per hardening report §J2)
Auto-resolve: AlertAutoResolveSweep.run() → claimAutoResolvableAlerts (FOR UPDATE SKIP LOCKED)
```

Scheduling for the sweep-based tiers uses **in-process `setInterval` timers** (`startRuntimeDispatchTimers()` in `queue.ts`), not pg-boss cron, for the window/operational/AI tiers and notification/outbox polling — these are `.unref()`'d and query `activeRuntimeOrganizations()` to only dispatch jobs for recently-active orgs. `escalationSweep`, `autoResolveSweep`, and `cleanup` DO use pg-boss's native `.schedule()` cron with `singletonKey` to prevent duplicate execution across replicas.

## Automation vs. ingestion isolation

FACT (confirmed by `ENTERPRISE_INCIDENTS_REPORT.md`, independently re-checked at a high level in this pass): the ingestion critical path (`SDK → API → ingestion → Log DB`) does not import from either `src/modules/alerting/` or `src/modules/automation/` directly; alerting is fed asynchronously via the outbox relay, and automation has no ingestion touchpoint at all (see above — it only reacts to its own `/events` API or its own cron sweep). Automation cannot currently slow ingestion because it isn't wired to receive ingestion events. This also means automation's promise of "react to platform events" is architecturally unfulfilled unless some other, unfound caller invokes its API.

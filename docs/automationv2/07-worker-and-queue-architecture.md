# 07 — Worker and Queue Architecture

## Queue backend

Single shared `pg-boss` instance (`src/lib/pgboss.ts`), Postgres-backed job table, wrapped in a custom `ResilientPgBossDb` adapter for Neon serverless cold-start/idle-disconnect resilience (`isExpectedServerlessDisconnect`, `isTransientPostgresError`, exponential-backoff `executeSql` retrying). Process role (`producerOnly` vs full worker) is derived from `PROCESS_ROLE` env var or inferred from entrypoint path.

**No Redis/Kafka/SQS is used for job queuing** — flagging explicitly since rule #30-2 forbids introducing such infra without evidence, and confirming there's no existing infra of that kind for automation/alerting jobs to migrate onto. Redis IS used elsewhere in alerting (fast-path cooldown filter, demoted to non-authoritative per hardening report), but not as the queue backend.

## Automation queues (`AUTOMATION_QUEUES`, workers.ts)

| Queue | Producer | Consumer | Cron schedule |
|---|---|---|---|
| `automation-inbox` | `enqueueAutomationJob` (from `ingestEvent`, schedule sweep indirectly via inbox insert) | `processInbox()` via `pgboss.work` | `*/1 * * * *` |
| `automation-run-execute` | `enqueueAutomationJob` after run creation; `handleStepFailure` retry enqueue; maintenance re-enqueue | `executeRun()` via `pgboss.work` | none (send-only, event-driven) |
| `automation-maintenance` | internal | maintenance worker via `pgboss.work` | `*/2 * * * *` |
| `automation-dead-letter` | pg-boss automatic routing on exhausted retries | dead-letter worker via `pgboss.work` | none |
| `automation-schedule` | internal | `runScheduleSweep()` via `pgboss.work` | `* * * * *` |

Classification: **VERIFIED WORKING** — every queue with a producer has a matching consumer and vice versa, confirmed by direct grep of `pgboss.work(...)` registrations against the queue name list. No orphaned producer/consumer found in this module.

## Alerting queues (`ALERT_JOBS`, queue.ts)

`cleanup, escalate, escalationSweep, autoResolveSweep, evaluateFast, evaluateWindow, evaluateOperational, evaluateAi, notificationRouter, telemetryOutboxRelay, errorGroupRegressed` — all registered with `pgboss.work()`, confirmed consumers exist for each (per `registerAlertingWorkers()` trace). Two worker groups: `all` and `alert-delivery` (subset, `ALERT_DELIVERY_WORKER_JOBS`), used for the isolated `npm run dev:alert:workers` dev command per `alertseperation.md`.

**Confirmed dead queues (new finding, re-verified in this audit):** `alert.correlate` and `notification.digest` are produced via `pgboss.send()` from `escalation.worker.ts` (`runCorrelationSweep`, `runDigestSweep`) but have **zero** `pgboss.work()` registrations anywhere in `src/**` (full-tree grep performed). Classification: **DEAD CODE / UNREACHABLE** for the consumer side; the producer functions themselves (`runCorrelationSweep`, `runDigestSweep`) are also effectively **UNREACHABLE** unless something calls them — grep found no call sites for either function outside their own definitions in this pass; this should be re-verified with a full call-site search before removing them, but current evidence points to both ends of this pipeline being dead.

## Scheduling mechanisms — two different systems in the same codebase

1. **pg-boss native cron** (`pgboss.schedule(queue, cronExpr, data, {singletonKey})`) — used for `escalationSweep`, `autoResolveSweep`, `cleanup` (alerting) and `inbox`, `maintenance`, `schedule` (automation). `singletonKey` prevents duplicate firing across horizontally-scaled worker replicas — this is pg-boss's own guarantee, not something this codebase reimplements.
2. **In-process `setInterval` timers**, `.unref()`'d (`startRuntimeDispatchTimers()` in alerting's `queue.ts`) — for `evaluateWindow` (5s), `evaluateOperational` (30s), `evaluateAi` (300s), `notificationRouter` (10s poll), `telemetryOutboxRelay` (1s poll). Each dispatch queries `activeRuntimeOrganizations()` and sends one pg-boss job per active org with a time-bucketed `singletonKey`.
3. **Automation's own custom cron parser** (`cron.ts`) — used only to determine due *workflows* (application-level scheduling), layered on top of mechanism #1's `automation-schedule` queue tick.

This is architecturally reasonable (mechanism 1 is for true cron cadence; mechanism 2 is for adaptive/short-interval dispatch scoped to active orgs, avoiding a fixed per-org cron registration explosion) but is worth being explicit that a future engineer debugging "why didn't this run" needs to know which of the three mechanisms is in play for a given job type.

## Worker concurrency / backpressure

Concurrency is configured per-queue at the pg-boss worker-registration level (e.g. `localConcurrency`, `batchSize` in `connectors/queue.ts` and `automation/workers.ts`), but this is a **global** cap per worker process, not per-tenant. See `13-rate-limiting-and-backpressure.md` for the full analysis — summary: **NOT FOUND**, no per-tenant concurrency isolation exists in either subsystem.

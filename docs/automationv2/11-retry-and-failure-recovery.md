# 11 — Retry and Failure Recovery

## Automation

- Inbox event retry: exponential backoff, `min(1000 * 2^attempt, 300_000)` ms, capped at `MAX_INBOX_RETRY_ATTEMPTS = 5`. After exhaustion: NOT VERIFIED exactly what terminal state the event lands in (not traced to that level of specificity in this pass) — flag as a gap to confirm before relying on "failed events are visible."
- Step retry: exponential backoff capped at 1 hour, `maxAttempts` per step (configurable). On exhaustion, step becomes terminal-failed, which `aggregateRunCompletion` rolls up into a failed run status.
- Double-retry-path risk: see `09-transaction-and-concurrency.md` — a single `STEP_ERROR` throw can result in both an application-scheduled delayed retry (`startAfter`) AND a pg-boss-level retry (because the error is re-thrown), with two distinct `singletonKey`s that won't dedupe against each other. **Flagged as a real retry-storm/duplicate-execution risk (P1)**, not fully confirmed harmful without a live trace, but the code path as read supports this outcome.
- Dead-letter: `automation-dead-letter` queue receives jobs whose pg-boss-level retries are exhausted (`deadLetter: AUTOMATION_QUEUES.deadLetter` option on `enqueueAutomationJob`). A consumer exists (per `07`). Whether the dead-letter consumer does anything beyond logging (e.g. alerting a human, marking the run permanently failed) was **NOT independently verified** in this pass — the context-gatherer noted a dead-letter worker exists but did not quote its body.
- Poison-job risk: a step that always throws the same error will retry up to `maxAttempts`, then land as failed — no evidence of an unbounded retry loop was found (all retry loops found have an explicit cap).

## Alerting

- `alert_delivery_attempts`: `retry_count`, `next_retry_at`, `max_retries INTEGER NOT NULL DEFAULT 3` (per DDL at `src/db/postgres/primary_db_draft/09_alerting/001_create_alert_delivery_attempts.sql`). Bounded retry, confirmed by schema default.
- Auto-resolve sweep and escalation sweep both run on fixed 1-minute pg-boss cron with `singletonKey`, so a stuck sweep doesn't accumulate duplicate scheduled instances.
- Incident persistence: wrapped in try/catch (`ALERTING_DB_DEPLOYMENT_RUNBOOK.md`, re-cited not re-derived) — failure to write an incident never blocks or retries alert delivery; it's a fire-and-forget best-effort write. This is a deliberate design choice (correctly prioritizing delivery over incident bookkeeping), not a bug.

## Failure/recovery scenarios (conceptual, from code reading — no live fault injection was performed; explicitly NOT VERIFIED LIVE for all of the below)

| Scenario | Automation | Alerting |
|---|---|---|
| DB unavailable mid-run | Query throws, pg-boss retries the job later per its own backoff; no evidence of data loss since state lives in Postgres, not memory | Same pattern; `ResilientPgBossDb` adds transient-error retry at the driver level |
| Queue (pg-boss table) unavailable | Both producer (`pgboss.send`) and worker (`pgboss.work`) calls would throw/stall; no evidence of a fallback path (e.g. writing to a local buffer) — NOT FOUND, meaning a pg-boss outage stalls both subsystems entirely until Postgres recovers | same |
| Worker crash mid-step | Step remains `running` with a `timeout_at`; `claimNextStep` reclaims it once `timeout_at` has passed (per the CTE's `OR (status='running' AND timeout_at expired)` clause) | Job requeues via pg-boss's own crash-recovery (unacked jobs become claimable again) |
| Provider (webhook/email) timeout | Not applicable to automation today (stubbed actions have no real network call); would depend on the eventual integration's own timeout handling | `httpRequest()` has timeout handling (not independently re-quoted in this pass); delivery attempt marked failed, retried per `alert_delivery_attempts` |
| App restart with pending scheduled jobs | `next_run_at`/`schedule_cron` are durable columns — restart does not lose the schedule, next sweep tick picks it up | pg-boss's own cron re-registers on `schedule: true` restart; `singletonKey` avoids duplicate registration |
| Network partition (action sent, response lost, retried) | Would double-execute against a real integration today because idempotency key isn't forwarded (see doc 10) — this is the most concrete durability risk identified | Delivery attempt tracking (`alert_delivery_attempts`) at least records the ambiguity, though whether the specific connector's retry is itself idempotent depends on the provider (e.g. resending the same Slack message could create a duplicate visible message) — **NOT VERIFIED** per-connector idempotency |

# 09 — Transaction and Concurrency Audit

## Automation: cooldown/rate-limit gate — atomic, but with a lock-key caveat

`processInbox()` (workers.ts ~225-260), inside `repo.withTransaction`:
1. `pg_advisory_xact_lock($1)` where `$1` is derived from `Buffer.from(wf.id.replace(/-/g,'').slice(0,16),'hex').readBigInt64BE(0)` — the first 8 bytes of the workflow UUID interpreted as a signed bigint.
2. Cooldown check: `SELECT 1 FROM automation_runs WHERE workflow_id=$1 AND organization_id=$2 AND created_at > NOW() - ($3||' seconds')::interval LIMIT 1`.
3. Hourly rate check: `SELECT COUNT(*) FROM automation_runs WHERE workflow_id=$1 AND organization_id=$2 AND created_at > NOW() - INTERVAL '1 hour'` against `maxRunsPerHour`.
4. `createRunWithSteps(..., client)` on the **same transaction/client**.

**Finding (new, not previously documented):** the surrounding code comment claims the lock is "scoped by org+workflow," but the actual key-derivation only encodes the workflow UUID — the organization ID does not feed the advisory lock key at all. Practically this is very unlikely to cause a real bug (workflow IDs are already globally unique, so scoping the lock by org+workflow vs. just workflow produces the same serialization behavior for any given workflow), but it means the comment is inaccurate, and if a future refactor introduces some scheme where the same UUID value could theoretically apply across two different orgs (it currently can't, since `id` is a UUID PK), the lock would not distinguish them. Classification: **WORKING WITH CONDITIONS** — functionally correct today, comment is misleading.

Because the advisory lock, both gate checks, and the run/step insert all happen in one client/transaction, there is **no TOCTOU window** between checking cooldown/rate-limit and creating the run — this is a genuinely atomic check-and-act pattern, correctly implemented. Classification: **VERIFIED WORKING** for the atomicity property specifically (contingent on the schema-mismatch caveat in `08` — if the underlying tables/columns don't exist as committed, this logic can't run at all, but the logic itself as written is correct).

## Automation: can two workers execute the same automation run simultaneously?

`createRunWithSteps` gives the run an idempotency key `automation:{orgId}:{workflowId}:{eventType}:{sourceEventId||dedupeKey}` with a unique constraint (violation → `AutomationConflictError`, caught and logged as "duplicate run skipped"). Once a run exists, execution is claimed via `claimNextStep`'s `FOR UPDATE OF s SKIP LOCKED` with an explicit constraint that no lower-`sort_order` step may be in a non-terminal-success state — i.e., steps within a run are strictly sequential, and `SKIP LOCKED` prevents two workers from claiming the same step row. **Two different runs of the same workflow** could execute concurrently if they arise from two distinct trigger events close together and both pass the rate-limit check before either's `automation_runs` row is visible to the other — but since the rate-limit check happens inside the same advisory-locked transaction as the insert, and the lock is per-workflow, this is actually prevented: the second inbox event's gate check would see the first run's row (assuming the first transaction committed) or block on the advisory lock until it does. Classification for "same workflow double-execution": **VERIFIED WORKING (no race found)**, given the schema exists.

Guarantee level: **effectively-once** for automation runs, via the combination of the DB-level unique idempotency key AND the advisory-lock-serialized rate gate — not "exactly once" in the distributed-systems sense (a network partition between the worker and Postgres during commit could still, in principle, cause an ambiguous outcome that the client-side code would retry into), but duplicate *rows* are prevented by the DB constraint regardless.

## Automation: step-level retry safety

On `STEP_ERROR` (thrown, not a handler failure result), `handleStepFailure` resets the step to `queued` with `nextRetryAt` (exponential backoff, capped at 1 hour) and enqueues a delayed `pgboss.send('automation-run-execute', ..., {startAfter: nextRetryAt, singletonKey: 'run:'+runId+':retry:'+stepId})`. If `attempt < maxAttempts`, the original error is **re-thrown**, so pg-boss's own job-level retry also applies on top of this application-level retry. This is a **double retry mechanism** — the job will be retried both by pg-boss (because the handler threw) and by the application's own delayed re-enqueue (because `handleStepFailure` already scheduled a `startAfter` job with a distinct `singletonKey`). Classification: **flagged as a potential retry-storm risk, not confirmed harmful** — because the two `singletonKey`s differ (`run:<id>` for the pg-boss-driven retry vs `run:<id>:retry:<stepId>` for the explicit re-enqueue), pg-boss will not dedupe them against each other, meaning a single step failure could result in **two independent execution attempts** scheduled for around the same time. This should be verified against `automation-workers.test.ts` or a live trace before being treated as fully safe. See `18-root-cause-matrix.md`.

## Alerting: per-alert-key serialization

`AlertDecisionEngine.decide()` calls `lockState(client, alertKey)` — blocking `SELECT * FROM alert_event_state WHERE alert_key=$1 FOR UPDATE` — before `appendEvent`, inside `runtime.withTransaction`. This serializes all decisions for a given alert key (ADR-0007 per the in-code comment), which is the correct primitive for preventing two concurrent evaluations of the same alert from producing conflicting state transitions. Classification: **VERIFIED WORKING**.

`claimDueNotificationJobs` and `claimAutoResolvableAlerts` both use real `FOR UPDATE SKIP LOCKED` — confirmed by direct code read (not inherited from prior docs) in this audit pass. Classification: **VERIFIED WORKING**, "two sweep workers/replicas never claim the same row" claim in the surrounding code comment is accurate for these two functions specifically.

`recordNotificationDelivery` uses `pg_advisory_xact_lock(hashtextextended('alert-notification-delivery:'+jobId, 0))` plus a `FOR UPDATE` on the job row — belt-and-suspenders locking (the advisory lock is somewhat redundant given the row-level `FOR UPDATE` immediately follows, but redundant safety is not a bug).

## Escalation sweep — different (weaker) mechanism than the rest

`SnapshotEscalationWorker.run()` (escalation.worker.ts) — per context-gatherer's direct read — does **not** use `FOR UPDATE SKIP LOCKED` for job selection; it locks a single alert's state row via `lockState` and relies on pg-boss's own `singletonKey: alert-escalate:${alertKey}:${step}` for dedup across replicas, not a SQL-level claim. This is a different concurrency-control strategy than every other sweep in the codebase. It is not necessarily broken (pg-boss's `singletonKey` is a real dedup mechanism at the queue level), but it is inconsistent, and per hardening report §J2, `SnapshotEscalationWorker` reportedly has zero call sites today anyway — so this may be moot dead code. **NOT VERIFIED** whether it's actually invoked anywhere in production; treat as dead until proven otherwise (consistent with the hardening report's own finding).

## Summary: at-most-once / at-least-once / effectively-once

| Path | Guarantee | Evidence |
|---|---|---|
| Automation run creation | Effectively-once | DB unique idempotency key + advisory-locked atomic gate |
| Automation step execution | At-least-once (by design, retries) with effectively-once persistence | `ON CONFLICT (idempotency_key) DO NOTHING` on step insert; but see the double-retry-path flag above |
| Automation action side-effects | NOT VERIFIED / N/A | 17+ action types have no real side effect to duplicate; idempotency key not forwarded to the 9 conditionally-real handlers |
| Alerting decision/state transition | Effectively-once per alert key | `lockState` FOR UPDATE serialization |
| Alerting notification delivery | At-least-once, with delivery-attempt tracking | `claimDueNotificationJobs` SKIP LOCKED + `alert_delivery_attempts` retry table |

No claim of "exactly once" is made anywhere in this document, per the audit's non-negotiable rule.

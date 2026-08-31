# 06 — Action Engine Audit

See `03-automation-rule-inventory.md` for the full per-action classification table. This document covers the execution mechanics around actions, not the inventory itself.

## Automation action execution pipeline (`action-runner.ts`, `workers.ts`)

```
Input (ctx: AutomationActionContext)
  ↓
Timeout enforcement (per-action configurable timeout)
  ↓
Risk validation: DANGEROUS_ACTIONS list checked against approval state
  → throws AutomationApprovalRequiredError if high/critical risk lacks prior approval
  ↓
Registered handler lookup by ActionType (ActionRunnerRegistry, handler-registry pattern)
  ↓
Handler executes (real integration call, or notImplementedResult stub — see 03)
  ↓
Result: { success, skipped, output } or thrown error
  ↓
workers.ts: success→step succeeded; skipped→step skipped; error→handleStepFailure
```

Timeout: enforced per action (exact default/config values not independently re-derived in this pass beyond confirming the mechanism exists — **NOT VERIFIED** exact timeout values per action type without reading `action-runner.ts` in full line-by-line, which the context-gatherer pass summarized but did not quote verbatim for every action).

## Alerting action/notification dispatch pipeline (connectors)

```
Input (NotificationJobRow, claimed via claimDueNotificationJobs, FOR UPDATE SKIP LOCKED)
  ↓
AlertNotificationRouter.dispatchById() → routes to connector-specific pg-boss queue
  ↓
connectors/* handler (webhook/Slack/Discord/Teams/PagerDuty/email/SMS)
  ↓
httpRequest() (connectors/shared/http.ts) — SSRF-checked (validateWebhookUrl, unless skipSsrfCheck)
  ↓
Response handling, retry via alert_delivery_attempts (next_retry_at, max_retries=3 default)
  ↓
recordNotificationDelivery — advisory lock (pg_advisory_xact_lock(hashtextextended(jobId,0))) + FOR UPDATE on job row
```

Classification: **VERIFIED WORKING** for the SSRF check and the delivery-attempt retry scaffolding (both confirmed by direct code read in this pass, not inherited from prior docs). **NOT VERIFIED** whether actual external providers (SMTP servers, real Slack/PagerDuty endpoints) were exercised in any test — `alertseperation.md` explicitly states credentials/SMTP were not exercised in its validation pass, and no evidence of a live external send was found in this audit either.

## Idempotency at the action boundary

`buildIdempotencyKey()` (action-runner.ts) computes `automation:{orgId}:{workflowId}:{runId}:{stepId}` — deliberately omits attempt number so retries reuse the same key. This key is carried in `ctx.idempotencyKey` but **none of the currently-registered handler bodies forward it into the downstream integration call signature** (e.g. `notificationSender.send({organizationId, channel, message, metadata})` has no `idempotencyKey` field). It is honored at the persistence layer only (`ON CONFLICT (idempotency_key) ... DO NOTHING` on `automation_run_steps` insert), which prevents duplicate *step rows*, not duplicate *external side effects* if the same step were somehow executed twice by two different handler invocations reaching a real integration. Since 17/26 action types have no real integration at all today, this gap is currently moot in practice — but it means idempotency is **NOT enforced end-to-end**, only at the DB row level. Classification: **PARTIALLY IMPLEMENTED**.

## Dangerous-action / approval gating

`DANGEROUS_ACTIONS` risk classification (`low/medium/high/critical`) gates high/critical actions behind an `automation_approvals` row before execution. This is real, verified code (traced in `workers.ts` `executeRun()`): a duplicate-approval-request race is explicitly guarded by catching Postgres unique-violation `23505` on a partial unique index, and only `status==='approved'` allows the step to proceed (`rejected/expired/cancelled` cancels the step; any other state re-pauses execution). Classification: **VERIFIED WORKING** as an orchestration mechanism — but note that because most high/critical actions (`status_page.update`, `release.guard.pause`, `retention.purge_request`) are simultaneously gated by approval AND stubbed to `notImplementedResult`, the approval gate currently protects nothing real. This is not a flaw in the approval mechanism itself, just a consequence of the stub coverage.

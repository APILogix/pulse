# 03 — Automation Rule / Action Inventory

Source: `src/modules/automation/action-runner.ts` (`registerDefaults()`), cross-checked against `automation.module.ts` construction (`createActionRunner()` called with no `AutomationIntegrations` object passed in the currently wired production module).

## Action types with a real (integration-backed) path — but currently unreachable in production wiring

| Action type | Handler behavior | Status |
|---|---|---|
| `notification.send` | Calls `integrations.notificationSender.send(...)` if injected | IMPLEMENTED BUT UNVERIFIED — no integration injected in `automation.module.ts` today, so falls through to stub |
| `quota.notify` | Same pattern | IMPLEMENTED BUT UNVERIFIED (same reason) |
| `security.notify` | Same pattern | IMPLEMENTED BUT UNVERIFIED (same reason) |
| `approval.request` | Calls `integrations.approvalRequester.requestApproval(...)` if injected | IMPLEMENTED BUT UNVERIFIED |
| `connector.delivery.retry` | Calls `integrations.connectorRetrier.retry(...)`, validates required `deliveryId` | IMPLEMENTED BUT UNVERIFIED |
| `alert.silence.create` | Calls `integrations.alertSilenceCreator.createSilence(...)` | IMPLEMENTED BUT UNVERIFIED |
| `ai.summary.generate` / `ai.root_cause.generate` | Calls `integrations.aiSummaryGenerator.generateSummary(...)` | IMPLEMENTED BUT UNVERIFIED |
| `report.export` | Calls `integrations.reportExporter.export(...)` | IMPLEMENTED BUT UNVERIFIED |
| `rollback.recommend` | Always returns a fixed "recommendation only" success — no integration needed, this is intentionally advisory-only | VERIFIED WORKING (as an advisory no-op, by design) |
| `noop` | Always succeeds, does nothing | VERIFIED WORKING (trivially) |

**Root cause of "unreachable":** `createActionRunner()` is instantiated in `automation.module.ts` without any `AutomationIntegrations` object. Every one of the 9 handlers above has an integration-check branch that falls through to `notImplementedResult(type)` when the integration is absent — which is exactly what happens today. Until a wiring change injects real `notificationSender`, `approvalRequester`, etc., these are functionally identical to the hardcoded-stub list below, just with better-looking source code.

## Action types with NO implementation at all — hardcoded stubs (`notImplementedActions` array, action-runner.ts)

| Action type | Risk level | Behavior |
|---|---|---|
| `incident.create` | medium | `notImplementedResult` |
| `incident.assign_owner` | medium | `notImplementedResult` |
| `incident.timeline.append` | low | `notImplementedResult` |
| `incident.postmortem.generate_draft` | low | `notImplementedResult` |
| `ticket.github.create` | medium | `notImplementedResult` |
| `ticket.jira.create` | medium | `notImplementedResult` |
| `pagerduty.trigger` | medium | `notImplementedResult` |
| `runbook.open` | low | `notImplementedResult` |
| `runbook.step.create` | low | `notImplementedResult` |
| `status_page.update` | high | `notImplementedResult` |
| `alert.severity.change` | medium | `notImplementedResult` |
| `release.guard.warn` | low | `notImplementedResult` |
| `release.guard.pause` | high | `notImplementedResult` |
| `quota.throttle_recommend` | high | `notImplementedResult` |
| `retention.archive` | medium | `notImplementedResult` |
| `retention.purge_request` | **critical** | `notImplementedResult` |
| `webhook.call` | high | `notImplementedResult` |

Status for all 17: **PLACEHOLDER / MOCK**. `notImplementedResult()` returns `{ success: true, skipped: true, output: { status: 'not_implemented', ... } }` — the run records these steps as successful, not failed. A workflow built entirely from these action types will always report "succeeded" while doing nothing observable outside the automation database.

This is the most consequential finding for anyone evaluating whether "automation actually works": **19 of 26 total action types (17 hardcoded + effectively 9 unwired real handlers, minus the 2 genuinely functional ones — `rollback.recommend`, `noop`) currently perform no external side effect in the production wiring as found.**

## Rule (workflow) inventory template — per the field table requested

Automation does not have a fixed catalog of "rule types" the way alerting does (alerting has named presets like `service_inactivity`, `request_inactivity`, threshold rules, etc. — see `docs/alert-rules-catalog.md`, not re-derived here). Automation instead has a generic workflow schema:

| Field | Present in schema? | Evidence |
|---|---|---|
| Trigger | Yes | `automation_triggers` table: `trigger_kind` (`event`/`schedule`), `source_module`/`source_event`, `schedule_cron`, `cooldown_seconds`, `timezone` |
| Conditions | Yes | `automation_conditions` table, evaluated by `evaluator.ts` (`eq, neq, gt, gte, lt, lte, in, not_in, contains, not_contains, matches, exists, not_exists, between`) |
| Action | Yes | `automation_actions` table, 26 action types (above) |
| Schedule | Yes/No — depends on trigger_kind | cron-based workflows use `schedule_cron`; event-based do not |
| Queue | Yes | `automation-inbox` → `automation-run-execute` |
| Worker | Yes | `registerAutomationWorkers()` in `workers.ts` |
| Persistence | Yes | `automation_workflows`, `automation_runs`, `automation_run_steps` |
| Retry | Yes | per-step `maxAttempts`, exponential backoff capped at 1h; inbox events retry up to `MAX_INBOX_RETRY_ATTEMPTS=5` |
| Idempotency | Partial | run-level idempotency key prevents duplicate runs for the same event; action-level idempotency key computed but not passed to any downstream integration call (see `10-idempotency-and-deduplication.md`) |
| Cooldown | Yes | `cooldown_seconds` on trigger, enforced atomically |
| Rate limit | Yes | `maxRunsPerHour` (default 100, per workflow, per org) |
| Tenant scope | Yes | `organization_id` filter on nearly all queries; project-scoped workflows require exact `projectId` match |
| Execution history | Yes | `automation_runs`/`automation_run_steps` (status columns) + `automation_audit_logs` |
| Failure handling | Yes | `handleStepFailure`, run/step status transitions, dead-letter queue |
| Test coverage | Partial | 8 test files exist (`automation-*.test.ts`) — see `15-test-and-verification-matrix.md` for what they actually cover |
| Production verification | No | NOT VERIFIED LIVE — no evidence of a live end-to-end run against a real deployed database was found or performed in this audit (see `22-final-forensic-verdict.md`) |
| Status | — | **PARTIALLY IMPLEMENTED** overall — orchestration layer is solid; action layer is mostly stubbed; schema/code mismatch (see `08`) casts doubt on whether it runs at all against the committed migrations |

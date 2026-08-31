# 00 — Automation Execution Catalog (canonical reference)

Per the audit brief's request for a single definitive catalog. This is generated from the action-type list in `action-runner.ts` and the trigger/queue/worker mapping traced in docs 03/04/07. Treat this as the reference table for future automation development until the P0 schema issue (doc 08) is resolved and re-audited.

| Automation (action type) | Trigger | Condition | Queue | Worker | Action | Retry | Idempotency | Status |
|---|---|---|---|---|---|---|---|---|
| Any workflow (generic) | event (`/events` API) or schedule (`schedule_cron`) | `evaluator.ts`, group OR / cross-group AND | `automation-inbox` → `automation-run-execute` | `processInbox`/`executeRun` (`workers.ts`) | (see per-action rows below) | exponential backoff, capped, `MAX_INBOX_RETRY_ATTEMPTS=5` (inbox), 1h cap (steps) | run: unique key on `(orgId,workflowId,eventType,sourceEventId)`; step: unique `idempotency_key` | **BROKEN** — claim SQL fails against live schema (doc 08) |
| `notification.send` | — | — | — | `ActionRunnerRegistry` | calls `notificationSender.send()` if injected | per-step config | key computed, not forwarded | IMPLEMENTED BUT UNVERIFIED (unwired) |
| `quota.notify` | — | — | — | same | same pattern | same | same | IMPLEMENTED BUT UNVERIFIED (unwired) |
| `security.notify` | — | — | — | same | same pattern | same | same | IMPLEMENTED BUT UNVERIFIED (unwired) |
| `approval.request` | — | — | — | same | calls `approvalRequester.requestApproval()` if injected | same | same | IMPLEMENTED BUT UNVERIFIED (unwired) |
| `connector.delivery.retry` | — | — | — | same | calls `connectorRetrier.retry()` if injected | same | same | IMPLEMENTED BUT UNVERIFIED (unwired) |
| `alert.silence.create` | — | — | — | same | calls `alertSilenceCreator.createSilence()` if injected | same | same | IMPLEMENTED BUT UNVERIFIED (unwired) |
| `ai.summary.generate` | — | — | — | same | calls `aiSummaryGenerator.generateSummary()` if injected | same | same | IMPLEMENTED BUT UNVERIFIED (unwired) |
| `ai.root_cause.generate` | — | — | — | same | same as above | same | same | IMPLEMENTED BUT UNVERIFIED (unwired) |
| `report.export` | — | — | — | same | calls `reportExporter.export()` if injected | same | same | IMPLEMENTED BUT UNVERIFIED (unwired) |
| `rollback.recommend` | — | — | — | same | always returns advisory-only success | N/A | N/A | **VERIFIED WORKING** (by design, advisory only) |
| `noop` | — | — | — | same | always succeeds, does nothing | N/A | N/A | **VERIFIED WORKING** (trivial) |
| `incident.create` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `incident.assign_owner` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `incident.timeline.append` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `incident.postmortem.generate_draft` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `ticket.github.create` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `ticket.jira.create` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `pagerduty.trigger` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `runbook.open` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `runbook.step.create` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `status_page.update` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** (risk: high) |
| `alert.severity.change` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `release.guard.warn` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `release.guard.pause` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** (risk: high) |
| `quota.throttle_recommend` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** (risk: high) |
| `retention.archive` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** |
| `retention.purge_request` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** (risk: **critical**) |
| `webhook.call` | — | — | — | same | `notImplementedResult` | N/A | N/A | **PLACEHOLDER / MOCK** (risk: high) |

"—" in Trigger/Condition/Queue columns means "inherited from the parent workflow row above; identical for every action type since the action is just the terminal step of the same run pipeline."

Full document index: `01` through `22` in this directory, plus this `00` catalog and `23-final-automation-health-score.md`.

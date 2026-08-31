# 01 — Executive Summary

Audit date: 2026-08-29. Scope: `src/modules/automation/**` (no-code workflow engine) and `src/modules/alerting/**` + `src/modules/connectors/**` (alerting/notification engine). These are two distinct subsystems sharing one pg-boss instance (`src/lib/pgboss.ts`).

This audit builds on six prior documents already in `docs/` (`alerting-and-connectors-production-audit.md`, `ALERT_RULE_CORRECTNESS_AUDIT.md`, `ALERTING_V2_HARDENING_REPORT.md`, `ENTERPRISE_INCIDENTS_REPORT.md`, `alertseperation.md`, `ALERTING_END_TO_END_FLOW.md`). Where those docs already established a fact, this audit cites them instead of re-deriving it. Where this audit found something new or contradicting, it says so explicitly.

## Verdict

**NOT PRODUCTION READY** for the automation module. **PRODUCTION READY WITH CONDITIONS** for the alerting module (per the already-completed V2 hardening work), with several previously-flagged gaps still open.

## The single most important finding (new, P0)

The automation runtime schema on disk does not match the code that runs against it. `database/migrations/logdb/08_automation_runtime/001_automation_runtime.up.sql` creates `automation_runs`, `automation_run_steps`, `automation_events_inbox`, `automation_audit_logs` with only 16 generic columns (`id, organization_id, project_id, workflow_id, run_id, step_id, actor_user_id, status, event_type, dedupe_key, input, output, error_message, started_at, completed_at, updated_at`). But `src/modules/automation/repository.ts` and `workers.ts` read/write columns that do not exist anywhere in this migration or any other migration found in the repo: `next_retry_at`, `locked_at`, `locked_by`, `attempts`, `received_at`, `sort_order`, `timeout_at`, `idempotency_key`, `approval_id`. No `ALTER TABLE` for any of these four tables was found in `database/migrations/**` or `src/db/postgres/primary_db_draft/**`. See `08-database-schema-and-query-audit.md`. This means: on a database built strictly from committed migrations, every one of `claimInboxEvents`, `createRunWithSteps`, `claimNextStep` would fail with `column does not exist`. This is either an uncommitted/missing migration or a genuine schema gap — I cannot tell which from the repo alone, and the audit explicitly flags this as **NOT VERIFIED whether the deployed database actually has these columns** (they may have been added by a hand-run migration not checked into `database/migrations/`).

## What already works (verified from code, not tests)

- Automation: inbox claiming uses real `FOR UPDATE SKIP LOCKED` (assuming the columns exist); cooldown/rate-limit gating is atomic (advisory lock + check + insert in one transaction); step execution is strictly sequential per run; duplicate event ingestion is deduped at the DB level (`ON CONFLICT`).
- Alerting: the V2 hardening work (already documented) fixed the cooldown race, dual-fingerprint bug, and circuit breaker gap. SSRF protection is live on every outbound webhook call today (this audit re-verified it directly — see `12-security-and-tenant-isolation.md`). Connector secrets are AES-256-GCM encrypted at rest.
- Both subsystems enforce tenant scoping via `organization_id` in nearly every query (app-layer, not RLS).

## What does not work / is fake

- 17 of the automation action types registered in `action-runner.ts` — including `webhook.call`, `incident.create`, `pagerduty.trigger`, `ticket.jira.create`, `status_page.update`, and `retention.purge_request` — are hardcoded to `notImplementedResult()`, which returns `{ success: true, skipped: true }`. A workflow configured to call a webhook or create a PagerDuty incident will run to "succeeded" completion and do nothing. See `06-action-engine.md`.
- Two alerting queues, `alert.correlate` and `notification.digest`, are produced to (`pgboss.send`) but have zero registered `pgboss.work()` consumers anywhere in the codebase — confirmed dead, matching `alertseperation.md`'s note.
- No per-tenant rate limiting or backpressure exists anywhere in either subsystem. A single tenant can consume the entire shared worker concurrency budget.

## Already-known, still-open issues (from prior docs, re-confirmed relevant, not re-derived here)

Carried forward from `ALERTING_V2_HARDENING_REPORT.md` §J and `ENTERPRISE_INCIDENTS_REPORT.md` §R: fingerprint migration for in-flight alerts never written (deploy blocker), `SnapshotEscalationWorker` has zero call sites (dead), lookback/aggregation condition fields are decorative, absence/inactivity rules structurally cannot fire, no RLS backstop, `current_revision` never incremented, incident-table migrations not confirmed auto-applied.

See `18-root-cause-matrix.md` for the full ranked list and `22-final-forensic-verdict.md` for the complete verdict with roadmap.

# 08 — Database Schema and Query Audit

## P0 FINDING: automation runtime schema/code mismatch

`database/migrations/logdb/08_automation_runtime/001_automation_runtime.up.sql` is the **only** migration file found for `automation_runs`, `automation_run_steps`, `automation_events_inbox`, `automation_audit_logs`. It generates all four tables from one templated `DO $$ ... FOREACH ... EXECUTE format(...) $$` loop with exactly these columns:

```
id, organization_id, project_id, workflow_id, run_id, step_id, actor_user_id,
status (logdb_job_state), event_type, dedupe_key, input jsonb, output jsonb,
error_message, started_at, completed_at, updated_at
PRIMARY KEY (id, started_at), PARTITION BY RANGE (started_at)
```

Plus indexes: `(organization_id, workflow_id, started_at DESC)`, unique `(dedupe_key, started_at) WHERE dedupe_key IS NOT NULL`, GIN on `input`, BRIN on `started_at`.

Code in `src/modules/automation/repository.ts` and `workers.ts` references columns **not present in this DDL or any other migration found in the repo** (`database/migrations/**` and `src/db/postgres/primary_db_draft/**` were both searched; no `ALTER TABLE` for any of these four table names was found):

- `next_retry_at`, `locked_at`, `locked_by`, `attempts`, `received_at` — used by `claimInboxEvents`
- `sort_order`, `timeout_at`, `idempotency_key`, `approval_id` — used by `claimNextStep` / `createRunWithSteps`
- The dedupe conflict target used in code is `ON CONFLICT (organization_id, dedupe_key)` for `automation_events_inbox`, but the migration's unique index is `(dedupe_key, started_at)` with no `organization_id` in it — a different conflict target than what the migration actually creates.

**LIVE VERIFIED (2026-08-29): this is a confirmed FACT, not an inference.** This audit connected directly (read-only `information_schema.columns` query, no writes) to the project's own live database (`LOG_DB_PRIMARY` from `.env`, a Neon-hosted Postgres instance) and queried the actual columns of all four tables. The live schema returned is byte-for-byte identical to the 16-column generic migration above: `id, organization_id, project_id, workflow_id, run_id, step_id, actor_user_id, status, event_type, dedupe_key, input, output, error_message, started_at, completed_at, updated_at`. **None of `next_retry_at`, `locked_at`, `locked_by`, `attempts`, `received_at`, `sort_order`, `timeout_at`, `idempotency_key`, or `approval_id` exist on any of these four tables in the live database.**

This means, confirmed rather than suspected: **`claimInboxEvents`, `createRunWithSteps`, and `claimNextStep` as written in `repository.ts` would fail immediately with `column "X" does not exist` if executed against this live database today.** Automation's runtime (inbox processing, run creation, step execution) cannot function against the actual deployed schema right now. This is the single highest-priority (P0) finding of the entire audit — worse than "unverified risk," it is a proven blocker. See `18-root-cause-matrix.md` and `22-final-forensic-verdict.md`.

## Automation control-plane schema (workflow definition, NOT runtime) — DOES exist and matches code

Found at `src/db/postgres/primary_db_draft/14_automation/*.sql` and consolidated in `src/db/postgres/primary_db_draft/schema.sql` (~lines 8070-8430): `automation_workflows`, `automation_workflow_versions`, `automation_triggers`, `automation_conditions`, `automation_actions`, `automation_approvals`, `automation_templates`, `automation_template_versions`. This part of the schema is consistent with what `repository.ts`'s workflow-CRUD methods expect (verified spot-checks: `getWorkflow`, `createWorkflowTransaction`, `setWorkflowEnabled` WHERE clauses match column names seen in these migration files). Classification: **VERIFIED WORKING** for the control-plane tables specifically — the mismatch is isolated to the four Log DB runtime tables above.

## Alerting Log DB schema (`06_alert_runtime/`)

- `001_alert_runtime.up.sql` — legacy v1 generic 9-table set, superseded but not dropped.
- `002_alert_runtime_v2.up.sql` — canonical typed tables: `alert_events_v2` (append-only fact, partitioned by `created_at`, unique idempotency index on `(organization_id, idempotency_key, created_at)`), `alert_event_state` (single mutable projection per ADR-0006, PK `alert_key`, partial indexes for active states/due-escalation/due-auto-resolve/due-ack-expiry), `alert_event_history_v2` (append-only lifecycle audit). File continues past what was directly read in this pass to (per header comments) `alert_delivery_attempts_v2`/`alert_notification_ledger` — **NOT independently re-verified line-by-line in this audit**, trusted from context-gatherer's read plus consistency with `ALERTING_V2_HARDENING_REPORT.md`.
- `003`/`007` — idempotency constraints/enforcement.
- `004` — usage/billing facts.
- `005` — incidents/notification preferences.
- `006` — consolidation.
- `008` — notification delivery contract.
- `009` — drops a dead legacy `alert_incidents` table (superseded by PRIMARY DB `alert_incidents`).

## PRIMARY DB incidents (`src/db/postgres/primary_db_draft/09_alerting/`)

`001_create_alert_incidents.sql` → `alert_incidents` + `alert_incident_status` enum (+8 indexes). `002_create_alert_incident_events.sql` → `alert_incident_events` (+3 indexes). Per `ENTERPRISE_INCIDENTS_REPORT.md` R1 (still open, not re-derived): these migrations are **not confirmed auto-applied** in deployment — until applied, incident persistence fails silently (caught by try/catch, per the `ALERTING_DB_DEPLOYMENT_RUNBOOK.md`'s documented fail-safe design) but alert delivery itself is unaffected.

## Locking mechanisms found (cross-reference with `09-transaction-and-concurrency.md`)

- `FOR UPDATE SKIP LOCKED`: `claimInboxEvents` (automation, if columns exist), `claimNextStep` (automation, same caveat), `claimDueNotificationJobs` (alerting, confirmed), `claimAutoResolvableAlerts` (alerting, confirmed).
- `FOR UPDATE` (no SKIP LOCKED, blocking): `lockState` (alerting, per-alert-key serialization inside `AlertDecisionEngine.decide()`), the job-row lock inside `recordNotificationDelivery`.
- `pg_advisory_xact_lock`: automation's cooldown/rate-limit gate (keyed by first 8 bytes of workflow UUID as bigint — see `09` for the exact key-derivation nuance), alerting's `recordNotificationDelivery` (keyed by `hashtextextended('alert-notification-delivery:'+jobId, 0)`).
- `ON CONFLICT ... DO NOTHING`: dedup inserts for `automation_events_inbox`, `automation_run_steps` (idempotency_key), alerting's `alert_events_v2` idempotency index.

## Index observations

No new index recommendations are made in this audit — per rule #30-4, indexes are not proposed without an `EXPLAIN`-backed benefit analysis, and this audit did not have a live database to run `EXPLAIN` against. If performance issues are found in `16-performance-audit.md`, they are flagged as candidates for investigation, not prescribed fixes.

# 21 — Production Readiness Checklist

Answering the acceptance-criteria questions from the audit brief, per subsystem.

## Automation

| Question | Answer |
|---|---|
| Can an automation be created? | Yes — VERIFIED WORKING (workflow CRUD, draft/version/trigger/condition/action tables all confirmed consistent with code) |
| Can it be activated? | Yes — VERIFIED WORKING (enable/publish flow confirmed) |
| Can its trigger actually fire? | Event API and schedule sweep both confirmed to insert into the inbox correctly at the SQL level intended — BUT the claim step that picks up that inbox row is confirmed BROKEN against the live schema (see below) |
| Can the backend reliably enqueue its execution? | NO, currently — `claimInboxEvents` would throw against the live database (P0, live-verified) |
| Can a worker actually execute it? | NOT VERIFIABLE today until the schema is fixed — the code path that would execute it depends on the broken claim step |
| Are conditions evaluated correctly? | The evaluator itself is VERIFIED WORKING as a pure function; whether it's ever reached in production depends on the broken claim step above |
| Are actions actually performed? | NO for 17 of 26 action types (hardcoded stubs); UNVERIFIED/likely no for the other 9 (no integrations wired); YES trivially for `noop`/`rollback.recommend` |
| Are duplicate executions prevented? | Yes, by design (DB idempotency keys, advisory locks) — VERIFIED WORKING as logic, contingent on the schema fix |
| Are retries safe? | WORKING WITH CONDITIONS — retry logic is sound but has a flagged double-retry-path risk (P1) |
| Does restart recovery work? | Logic appears sound (durable `next_run_at`, timeout-based step reclaim) — NOT VERIFIED LIVE |
| Does tenant isolation hold? | VERIFIED WORKING at the application-query level for all paths examined; no RLS backstop |
| Can one tenant overload the system? | Partially mitigated by `maxRunsPerHour`, but inbox-processing overhead is NOT rate-limited — plausible risk, not load-tested |
| Can automation overload ingestion? | No — automation has no wiring into the ingestion path at all today |
| Is execution history trustworthy? | The data model is sound, but see the `not_implemented`-reported-as-`succeeded` issue — history is technically accurate about *step completion* but misleading about *real-world effect* |
| Are failed automations visible? | Yes, via `automation_runs`/`automation_run_steps` status + `automation_audit_logs` — contingent on the schema fix actually allowing writes to succeed |
| Are all configured actions actually implemented? | **No — confirmed, 17/26 are not, 9 more are unwired** |
| Are any automation routes/table/worker/queue dead? | No dead queues found within automation itself; the runtime tables are not "dead" but currently unusable against the live schema |
| Which capabilities are production-ready? | Workflow CRUD, publish/enable, condition evaluation logic, approval gating logic, cooldown/rate-limit logic — **as code**, not as a working live system until the schema fix ships |
| Which are only theoretical? | Nearly the entire runtime execution path (inbox claim → run → step → action) is theoretical against the live database today; most action types are theoretical regardless of schema |

## Alerting

| Question | Answer |
|---|---|
| Can a rule be created? | Yes — VERIFIED WORKING (per prior audits, not re-derived) |
| Can it be activated? | Yes |
| Can its trigger actually fire? | Yes — 4-tier evaluation confirmed live via prior audits + this audit's own SSRF/locking re-verification |
| Can the backend reliably enqueue its execution? | Yes — pg-boss cron + in-process interval dispatch both confirmed |
| Can a worker actually execute it? | Yes |
| Are conditions evaluated correctly? | Mostly — comparison operators verified correct; lookback/aggregation and absence rules confirmed still broken (carried forward, not new) |
| Are actions actually performed? | Yes for the connector-based delivery path (SSRF-protected, encrypted secrets, real HTTP calls) — NOT VERIFIED against real external providers (no live SMTP/Slack/PagerDuty test performed) |
| Are duplicate executions prevented? | Yes — cooldown race fixed per hardening report, re-confirmed locking mechanisms in this audit |
| Are retries safe? | Yes — bounded retry with `max_retries` default 3 |
| Does restart recovery work? | Plausible from code (pg-boss's own crash recovery + durable state) — NOT VERIFIED LIVE with actual fault injection |
| Does tenant isolation hold? | Yes at the app-layer query level; no RLS backstop (accepted risk per prior docs) |
| Can one tenant overload the system? | Possible — no per-tenant rate limit found on evaluation frequency (new finding) |
| Can automation overload ingestion? | N/A to alerting directly; alerting itself doesn't touch the ingestion critical path synchronously (outbox pattern) |
| Is execution history trustworthy? | Yes — append-only fact + history tables, state is rebuildable, per prior audits |
| Are failed automations visible? | Yes |
| Are all configured actions actually implemented? | Connector-based actions (webhook/Slack/etc.) yes; incident creation yes (with fail-safe try/catch); escalation V2 (SnapshotEscalationWorker) confirmed dead |
| Are any routes/table/worker/queue dead? | Yes — `alert.correlate`/`notification.digest` (confirmed this audit), `SnapshotEscalationWorker` (confirmed by prior audit) |

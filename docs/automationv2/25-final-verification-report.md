# 25 — Final Verification Report

Scope: repair, complete and productionize the Automation subsystem (`src/modules/automation/**`, its schema, its seed data, and the `pulsiv_fe` automation UI).

Every result below was produced by a command actually executed against this repository and its live database. Commands and outputs are given so they can be re-run.

---

## A. What existed before

| # | Defect | Severity | Evidence |
|---|---|---|---|
| A1 | **The four automation runtime tables were in the wrong database, with the wrong columns.** `automation_events_inbox`, `automation_runs`, `automation_run_steps`, `automation_audit_logs` existed only in the LOG database, generated from one generic 16-column template. `AutomationRepository` is constructed with the PRIMARY pool, and `claimNextStep` JOINs `automation_run_steps → automation_runs → automation_workflows → automation_actions` — control-plane tables that live in PRIMARY. A cross-database join is impossible. | **P0** | Live `information_schema.columns` query: PRIMARY reported all four tables MISSING; LOG DB reported exactly the 16 generic columns. Code referenced `next_retry_at`, `locked_at`, `locked_by`, `attempts`, `received_at`, `processed_at`, `last_error`, `sort_order`, `timeout_at`, `idempotency_key`, `approval_id` — none of which existed anywhere. |
| A2 | **26 of 28 action types silently faked success.** `notImplementedResult()` returned `{ success: true, skipped: true }`, so a workflow configured to page PagerDuty, call a webhook or open an incident completed as **succeeded** having done nothing. | **P0** (trust/correctness) | `action-runner.ts` `notImplementedActions` array (17 hardcoded) + 9 handlers that fell through to the same helper. |
| A3 | **Actions were unreachable in production even where implemented.** `workers.ts` built `new ActionRunnerRegistry()` with no integrations — and the worker is where actions actually execute. | **P0** | `workers.ts` worker registration; `automation.module.ts` `createActionRunner()` with no argument. |
| A4 | **No test exercised the real SQL.** 29 tests in `automation-workers.test.ts` passed in under 100 ms while testing only `buildIdempotencyKey` and `evaluateConditions`. This is why A1 survived. | **P0** (test gap) | Executed the suite and read the file: no `Pool`, no DB, no mock of the claim queries. |
| A5 | **Double retry.** A single failed step produced two independent resume attempts: an application-scheduled delayed job (`singletonKey run:<id>:retry:<stepId>`) *and* a pg-boss job retry via an unconditional rethrow (`singletonKey run:<id>`). Different keys, so pg-boss could not dedupe. | **P1** | `workers.ts` `handleStepFailure` + the `if (errorCode === 'STEP_ERROR' && …) throw err;` branch. |
| A6 | **Nine action types had no backing entity, duplicated another action, or were unsafe to automate**, including `retention.purge_request` (irreversible customer-data deletion) and `release.guard.pause` (nothing pausable exists). | **P1** | Live table search: `runbook%`, `status_page%`, `github%`, `jira%`, `report%`, `retention%` → NO TABLES. `project_releases` exists but is append-only with no status column. |
| A7 | **Three seeded templates were fiction**, built entirely on those non-existent entities. | **P2** | `scripts/audit-affected-templates.cjs` against live DB. |
| A8 | **Seeder was not truly idempotent.** Version rows used `ON CONFLICT … DO NOTHING`, so a corrected template definition could never roll out to an already-seeded environment. | **P2** | Seed file inspection. |
| A9 | **Frontend offered all 28 action types**, including the 9 that the backend now rejects at validation — a guaranteed save failure. | **P1** | `pulsiv_fe/src/modules/automation/api/types.ts`. |
| A10 | **9 automation tests were failing before any of this work**, all reading `src/db/postgres/canonical_migrations_draft/19_automation/` — a directory that does not exist. | **P2** | Established as a baseline via `git stash`. |

Two findings were investigated and **cleared** rather than "fixed":

- `automation/ssrf.ts` is **not** a duplicate SSRF implementation; it re-exports `shared/utils/ssrf.js`, the same guard the connectors module uses. The earlier audit's "duplicated guard" concern is retired.
- The failing "blocks non-HTTPS" SSRF test was **not** a production hole. `allowHttp` defaults to `NODE_ENV === 'development' || 'test'`; vitest sets `NODE_ENV=test`. Verified against the compiled guard (`scripts/probe-ssrf-policy.cjs`): with `NODE_ENV=production`, `http://example.com/webhook` → `safe=false, reason="Protocol must be https, got http:"`.

---

## B. What was changed

### Database / migrations
- **NEW** `src/db/postgres/primary_db_draft/14_automation/002_create_automation_runtime.sql` — creates the four runtime tables in PRIMARY, with columns derived directly from `repository.ts`'s `toInboxEvent`/`toRun`/`toStep` and `audit.ts`'s `toAuditRow`. Key decisions:
  - new `automation_inbox_status` enum (stronger than the previously-specified CHECK, and cannot drift between tables);
  - `UNIQUE (organization_id, dedupe_key) NULLS NOT DISTINCT` — the old partial index (`WHERE organization_id IS NOT NULL`) had a real hole: two platform/system events sharing a dedupe key would **both** insert;
  - `automation_runs.idempotency_key NOT NULL UNIQUE` (the code relies on `23505`);
  - partial unique on `automation_run_steps.idempotency_key WHERE NOT NULL`, matching the statement's `ON CONFLICT` predicate exactly;
  - `automation_audit_logs.action` is `VARCHAR(100)`, deliberately **not** the legacy `automation_audit_action` enum, whose labels are underscored (`run_queued`) while the code emits dotted (`run.queued`) and which lacks `run.dead_lettered` entirely — typing it as that enum would fail every audit insert;
  - all audit FKs are `ON DELETE SET NULL`, never CASCADE, so deleting a workflow can never erase its audit trail.
- **NEW** `.../14_automation/003_remove_unbacked_automation_templates.sql` — removes the three fictional templates, scoped to `scope='platform'` so tenant templates are untouched.
- **NEW** `database/migrations/logdb/08_automation_runtime/002_drop_misplaced_automation_runtime.up.sql` — drops the misplaced LOG DB stubs, eliminating the duplicate architecture.

### Backend
- `types.ts` — `ACTION_TYPES` 28 → 19; added `INTEGRATION_DEPENDENT_ACTIONS`; `DANGEROUS_ACTIONS` now empty (see §Security); every integration interface now carries `idempotencyKey`; new `IncidentManager` and `TicketCreator` contracts.
- `action-runner.ts` — rewritten. `notImplementedResult` is gone, replaced by `integrationNotConfigured()` (`success:false`, `INTEGRATION_NOT_CONFIGURED`) and `invalidConfig()` (`INVALID_ACTION_CONFIG`). Added `getAvailability()` so the UI can warn before a user builds on an unavailable action.
- **NEW** `integrations.ts` — binds actions to real subsystems: connectors `NotificationDispatcher`, connector delivery retry, alerting `SilencesRepository`, alerting `IncidentsRepository`, automation approvals.
- `automation.module.ts` and `workers.ts` — both now construct the registry **with** real integrations.
- `service.ts` — `validateActions` rejects unknown/retired action types at creation, and enforces the connector-only `webhook.call` policy.
- `entitlements.ts` — `ACTION_FEATURE_MAP` pruned of removed types.
- `workers.ts` — single authoritative retry: `handleStepFailure` returns `StepFailureOutcome { retryScheduled, retryEnqueued }`; `executeRun` rethrows **only** when the app failed to take ownership.

### Seed data
- Seeder reduced 20 → 17 templates; all 17 version upserts converted `DO NOTHING` → `DO UPDATE`, making re-seeding genuinely effective.

### Frontend (`pulsiv_fe`)
- `api/types.ts` — `ACTION_TYPES` synced to the backend's 19; `DANGEROUS_ACTIONS` emptied to match; `INTEGRATION_DEPENDENT_ACTIONS` added.
- `WorkflowFormDialog.tsx` — integration-dependent actions labelled "(needs integration)" with an amber explanation that runs will fail with `INTEGRATION_NOT_CONFIGURED` rather than silently succeed; `webhook.call` hint directing users to `connectorId`.

### Tests
- **NEW** `test/helpers/automation-scratch.ts` — disposable database, applies the **real** migration files.
- **NEW** `test/integration/automation-runtime.test.ts` — 30 tests, real repository against real schema.
- **NEW** `test/unit/automation-retry-ownership.test.ts` — 7 tests pinning the retry contract.
- Updated `automation-action-runner`, `automation-workers`, `automation-service`, `automation-phase2-behavior`, `automation-hardening`, `automation-repository` — several had encoded the *broken* behaviour as their expectation.

---

## C. Action inventory

| Action | Before | After | Real execution? | Idempotent? | Retry-safe? |
|---|---|---|---|---|---|
| `notification.send` | stub success | connectors `NotificationDispatcher` | Yes | Yes — `dedupKey` + `correlationId` | Yes |
| `quota.notify` | stub success | dispatcher, `automation.quota` | Yes | Yes | Yes |
| `security.notify` | stub success | dispatcher, `automation.security` | Yes | Yes | Yes |
| `webhook.call` | stub success | dispatcher, **webhook connector only** | Yes | Yes | Yes |
| `pagerduty.trigger` | stub success | dispatcher, pagerduty connector | Yes | Yes — PagerDuty honours `dedupKey` natively | Yes |
| `connector.delivery.retry` | stub success | `getDelivery` + `retryDelivery` | Yes | Yes — refuses already-sent | Yes |
| `alert.silence.create` | stub success | `SilencesRepository.createSilence` | Yes | Bounded window | Yes |
| `incident.create` | stub success | `IncidentsRepository.openOrReuse` | Yes | Yes — deterministic fingerprint folds retries into one incident | Yes |
| `incident.timeline.append` | stub success | `appendEvent` | Yes | Kind-validated | Yes |
| `incident.assign_owner` | stub success | `assign` | Yes | Idempotent by nature | Yes |
| `approval.request` | stub success | `createOrGetStepApproval` | Yes | Yes — reuses existing approval | Yes |
| `rollback.recommend` | advisory | advisory, explicitly `advisoryOnly:true` | Yes (advisory) | n/a | Yes |
| `noop` | no-op | no-op, honestly | Yes | n/a | Yes |
| `ai.summary.generate` | stub success | **fails** `INTEGRATION_NOT_CONFIGURED` | No — visible failure | n/a | n/a |
| `ai.root_cause.generate` | stub success | **fails** explicitly | No — visible failure | n/a | n/a |
| `incident.postmortem.generate_draft` | stub success | **fails** explicitly | No — visible failure | n/a | n/a |
| `report.export` | stub success | **fails** explicitly | No — visible failure | n/a | n/a |
| `ticket.github.create` | stub success | **fails** explicitly | No — visible failure | n/a | n/a |
| `ticket.jira.create` | stub success | **fails** explicitly | No — visible failure | n/a | n/a |
| 9 removed types | stub success | **removed from the product** | Cannot be requested | n/a | n/a |

**Net: silent fake successes went from 26 to 0.**

---

## D. Test results (actually executed)

```
npx vitest run test/unit/automation-*.test.ts test/integration/automation-runtime.test.ts --reporter=dot
  Test Files  10 passed (10)
       Tests  372 passed (372)
    Duration  24.03s
```

Before this work the same automation surface was **322 passed / 9 failed**. Now **372 passed / 0 failed**.

```
npx tsc --noEmit                  → clean (no errors)
npm run build                     → succeeds
npx tsc -b   (in pulsiv_fe)       → clean (no errors)
```

Live verification scripts, all re-run for this report:

```
node scripts/verify-automation-runtime.cjs       → 19 PASS · "ALL RUNTIME SQL VERIFIED AGAINST LIVE PRIMARY SCHEMA"
node scripts/verify-automation-integrations.cjs  → "ALL ACTION INTEGRATIONS VERIFIED AGAINST LIVE DATABASE"
node scripts/verify-automation-templates.cjs     → "TEMPLATE REGISTRY VERIFIED"
node scripts/verify-automation-fe-be-sync.cjs    → "FE/BE AUTOMATION CONTRACT IN SYNC"
```

The first two run inside a transaction that is **rolled back**, so they leave no residue.

---

## E. Reliability verification

| Property | How it was proven |
|---|---|
| Schema matches code | Integration test asserts all 12 tables, all 15 inbox columns, all run-step claim/retry/timeout columns, and the 3 unique indexes exist in a database built from the real migrations |
| Migrations idempotent | Integration test re-applies the full automation migration set and expects success |
| Inbox durable + deduped | Real inserts; duplicate key returns the original row and the original payload wins; two tenants may share a dedupe key |
| Worker claim safe | Two concurrent `claimInboxEvents` calls share **zero** events (`FOR UPDATE SKIP LOCKED`); two concurrent `claimNextStep` calls yield exactly one winner |
| Crash recovery | A `processing` row locked 10 minutes ago is reclaimable; a `running` step with expired `timeout_at` is reclaimable with `attempt` incremented |
| Sequential execution | Step 1 cannot be claimed while step 0 is unfinished |
| Run idempotency | Duplicate idempotency key raises `AutomationConflictError`; exactly one row exists |
| External idempotency | A retried `incident.create` folds into the **same** incident (`occurrence_count=2`, exactly one row) — verified against the live database |
| Retry single-owner | Exactly one delayed job per failure; backoff 30s/60s/120s, capped at 1h; `retryEnqueued=false` only when the enqueue genuinely failed; nothing scheduled once attempts are exhausted |
| Disabled cannot execute | A workflow switched **off after** its run was queued yields zero claimable steps; re-enabling restores it. Soft-deleted likewise blocked |
| Audit trustworthy | Dotted action names and `run.dead_lettered` persist; audit rows **survive** workflow hard-delete with `workflow_id` set to NULL |
| Tenant isolation | Cross-org `getWorkflow`/`getRun` return null, cross-org toggle has no effect, cross-org matching excludes, cross-org audit total is 0 |

---

## F. Frontend verification

Verified by reading the code and typechecking; **not** exercised in a browser (see §H).

- List, ON/OFF toggle, status, details, execution history and error visibility all already existed and are genuinely wired: `toggleWorkflow` is a real mutation calling `enable`/`disable`, with `onSuccess: invalidate` (server-authoritative refetch, never an optimistic claim of success) plus success and error toasts.
- Drafts have the switch blocked with the inline reason "Publish a version before switching this on".
- `AutomationRunDetailPage` renders `errorCode`/`errorMessage` at both run and step level, attempt counters, the idempotency key, and a JSON view of the output payload — so `INTEGRATION_NOT_CONFIGURED` and its `requiredIntegration` field are visible to the user.
- No mock or hardcoded data exists in the automation module.
- All 25 routes the API client calls exist in `routes.ts`.
- Action-type drift fixed and now guarded by a script.

---

## G. Security

- `webhook.call` is **connector-referenced only**. Inline URLs are rejected in both `action-runner.ts` and `service.validateActions`. Consequences: the destination is SSRF-validated inside the connectors subsystem on every send, and credentials live encrypted in `connector_credentials` instead of in a workflow definition.
- `DANGEROUS_ACTIONS` is empty because the four destructive entries were **removed from the product**, which is stricter than gating them. The approval gate itself remains fully wired: any action resolving to high/critical risk still requires approval, proven by test.
- Tenant scoping is enforced on every integration lookup; cross-tenant connector, incident and delivery resolution all return nothing.
- **Bug found and fixed during verification:** silences created with `startsAt = now` were briefly ineffective, because Postgres `NOW()` is the transaction-start timestamp and the app clock can drift from the database clock — so an in-flight evaluation could still fire alerts the user had just silenced. A 5-second backdating grace closes the window.

---

## H. Remaining issues — explicitly incomplete

1. **No event producer feeds automation.** This is the most important remaining gap. Nothing publishes into `automation_events_inbox` except the explicit `POST /organizations/:orgId/automation/events` API and automation's own cron sweep. Consequently **every event-triggered template is inert**, regardless of its `sourceModule`. The three `schedule.cron` templates do work. Highest-value next step is an alerting → automation bridge, which would activate 7 of the 17 templates. This was identified, documented and scoped — not built.
2. **Six action types have no integration** (`ai.summary.generate`, `ai.root_cause.generate`, `incident.postmortem.generate_draft`, `report.export`, `ticket.github.create`, `ticket.jira.create`). They now fail loudly instead of lying. AI needs credit/cost wiring; report export and GitHub/Jira have no subsystem at all.
3. **Four template `sourceModule` values have no owning module**: `cron_monitoring`, `monitoring`, `releases`, `uptime`. Those templates are kept because their actions are real and only the producer is missing.
4. **No per-tenant rate limiting or backpressure.** `maxRunsPerHour` caps run creation per workflow, but inbox-processing work still scales with event volume, so one noisy tenant can consume shared worker capacity.
5. **No browser-level E2E test.** Frontend correctness is established by typecheck and code reading, not by driving a browser. The mandate's §29 click-through was not performed.
6. **External providers never exercised.** No real email/Slack/PagerDuty send was performed; delivery is verified up to the connector dispatch boundary.
7. **Pre-existing, out-of-scope:** `test/integration/alerting-bindings-migrations.test.ts` (12 failures) and other tests read `src/db/postgres/canonical_migrations_draft/`, which does not exist. `npm run db:migrate:logdb` is blocked by an unrelated ingestion-drain guard on `030_events_logs_idempotency.up.sql`; that guard was deliberately **not** bypassed.
8. **DST/timezone edge cases** in `cron.ts` `nextCronOccurrence` remain untested.

---

## I. Production readiness score

Scored against evidence in this document. Not inflated.

| Area | Score | Basis |
|---|---:|---|
| Rule correctness | 85 | Evaluator sound; validation now rejects unexecutable workflows at creation |
| Trigger reliability | 45 | Schedule triggers work end-to-end; event triggers have no producer wired (§H1) |
| Scheduler reliability | 80 | Durable `next_run_at`, invalid-cron self-disable, `SKIP LOCKED`; DST untested |
| Queue architecture | 85 | All five queues have matched producers/consumers; pg-boss `singletonKey` dedupe |
| Worker reliability | 90 | Claim/lock/reclaim proven against a real database, including concurrency |
| Condition engine | 85 | Pure, ReDoS-mitigated, well covered |
| Action execution | 70 | 13 of 19 perform real side effects; 6 fail honestly; 0 fake |
| Retry handling | 90 | Single authoritative owner, bounded backoff, explicit fallback |
| Idempotency | 88 | Enforced at DB row level **and** forwarded to providers; proven by incident-fold test |
| Tenant isolation | 85 | Proven at repository level for workflows, runs, matching and audit; still app-layer, no RLS |
| Security | 85 | Connector-scoped webhooks, encrypted secrets, approval gate intact, silence-window bug fixed |
| Observability | 75 | Full audit trail with correlation IDs; no dedicated metrics/dashboards |
| Performance | 60 | Indexes justified by query shape; no load test, no per-tenant backpressure |
| Recovery | 85 | Stale-claim and expired-timeout recovery proven; no process-kill fault injection |
| Test coverage | 88 | 372 tests, 0 failures, including 30 real-schema integration tests; no browser E2E |
| Frontend integration | 80 | Real mutations, real error surfacing, contract drift guarded; no browser E2E |

**Automation Overall: 79/100**

**Production Ready: NO — for event-driven automation. YES (with conditions) — for scheduled automation and manual runs.**

### Critical blockers

1. **Event-driven automation cannot fire** because no module publishes into the inbox (§H1). Any customer enabling an event-triggered automation would see it never run. This is the single blocker standing between the current state and a genuinely complete feature.
2. **Six action types are unavailable.** They fail visibly rather than silently, which is correct, but a customer selecting one gets a failed run.

### What is genuinely fixed and trustworthy

The foundation is now sound and proven rather than assumed: the schema matches the code and is verified against a real database; concurrent workers cannot double-claim; crashed workers recover; retries have exactly one owner; external side effects are deduplicated by the provider; disabled workflows cannot execute even when a run was already queued; the audit trail survives deletion; tenants are isolated; and no action type can any longer report success while doing nothing.

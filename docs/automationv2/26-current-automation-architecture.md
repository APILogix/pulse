# 26 — Current Automation Architecture (post-repair, post-event-bridge)

This supersedes `02-current-architecture.md` for the automation module. That document described the system as found during the audit; this one describes it as it now stands. Where the two disagree, this document is correct for automation. (`02` remains accurate for the alerting subsystem's own internal behavior, which was not modified — only its Log DB-side outbox is now shared with the new bridge described in §3a.)

Every statement here is backed by code, a migration file, or a verification script named in `25-final-verification-report.md` or `28-event-driven-activation-report.md` (the report for the event-bridge phase this document was updated for).

**Update (event-driven activation phase):** §H1 of `25-final-verification-report.md` — "no event producer feeds automation" — is now closed for the alerting sourceModule. See §3a below and `28-event-driven-activation-report.md` for the full account, including a real end-to-end proof (a real sent email, real incident/silence rows) for every non-AI action type the 6 activated templates use.

---

## 1. Where automation lives

```
PRIMARY database (src/config/database.ts -> pool)
│
├── Control plane (7 tables)
│     automation_templates, automation_template_versions,
│     automation_workflows, automation_workflow_versions,
│     automation_triggers, automation_conditions,
│     automation_actions, automation_approvals
│
└── Runtime (4 tables)
      automation_events_inbox, automation_runs,
      automation_run_steps, automation_audit_logs
```

**All automation tables are in PRIMARY, and only in PRIMARY.** This is the single most important structural fact. `AutomationRepository` is constructed with the PRIMARY pool, and `claimNextStep` joins run steps → runs → workflows → actions in one statement. Splitting those across databases makes the query impossible, which is exactly the defect that was repaired.

The LOG database contains **no** automation tables (verified: all 11 report MISSING).

Migrations: `src/db/postgres/primary_db_draft/14_automation/` — 11 files. Applied with:

```
npm run db:primary:draft -- 14_automation
```

---

## 2. Rule lifecycle

```
POST /organizations/:orgId/automation/workflows
  → validation (role, entitlement, quota, project ownership, timezone,
                action types, webhook connector policy)
  → INSERT automation_workflows  (status='draft', is_enabled=FALSE, current_version=1)
    + draft version + triggers + conditions + actions
  → audit: workflow.created

POST /workflows/:id/publish        → creates/activates a published version
POST /workflows/:id/enable         → requires a published version;
                                     UPDATE is_enabled=TRUE, status='active'
POST /workflows/:id/disable        → UPDATE is_enabled=FALSE, status='disabled'
DELETE /workflows/:id              → soft delete (deleted_at)
```

A workflow cannot be enabled without a published version. The API returns the authoritative state, which the UI re-reads rather than assuming.

---

## 3. Trigger paths

There are now **three** producers into `automation_events_inbox`:

```
(a) POST /organizations/:orgId/automation/events     external / cross-module events (human-actor HTTP path)
(b) runScheduleSweep()  (workers.ts, cron '* * * * *')  schedule.cron ticks
(c) alertDomainEventIngest consumer (workers.ts)        alerting domain events, via the bridge in §3a
```

**Historical note:** at the time `25-final-verification-report.md` §H1 was written, only (a) and (b) existed, so event-triggered workflows were inert regardless of `sourceModule`. (c) closes that gap for `sourceModule='alerting'` specifically — the other three sourceModule values with no owning module (§H3: `cron_monitoring`, `monitoring`, `releases`, `uptime`) remain unwired.

### 3a. Alerting → Automation event bridge

Alerting and automation run in the same process (`src/shared/workers/main.ts`) but read/write two different physical databases (alerting's runtime tables live in the **Log DB**; all automation tables live in **PRIMARY** — see §1). A same-transaction insert across them is impossible, so the bridge is an outbox + relay, mirroring the existing `TelemetryOutboxRelay` pattern rather than inventing a new one:

```
alerting decide()                                    (Log DB tx)
  ... appendHistory ...
  → AlertRuntimeRepository.appendDomainOutbox()       INSERT into telemetry_outbox
                                                       signal_kind='alert_domain_event', fast_path=FALSE
                                                       (same tx, same idempotency-reservation CTE
                                                        pattern as every other alert-runtime write)
        │  (Log DB, polled every 1s)
        ▼
AlertDomainOutboxRelay.run()                          claims signal_kind='alert_domain_event' rows only
                                                       (FOR UPDATE SKIP LOCKED, 2-min staleness reclaim —
                                                        disjoint from TelemetryOutboxRelay's fast_path=TRUE claim)
  → pgboss.send('automation-ingest.alert-domain-event', job, { retryLimit:5, retryBackoff:true, deadLetter })
        │  (cross-module contract: this job name + payload shape ONLY — no imports cross the boundary)
        ▼
automation ingestAlertDomainEvent()                   (PRIMARY DB)
  → re-check hasEntitlement('module_automation_enabled')
  → AutomationRepository.insertInboxEvent()            ON CONFLICT (organization_id, dedupe_key) DO NOTHING
                                                         sourceModule='alerting', actorType:'system' audit
  → best-effort enqueue automation.inbox.process        (DB is source of truth; schedule sweep also recovers)
  → rethrow on failure                                  pg-boss retry (owned by the RELAY's retryLimit) is
                                                         the single retry mechanism; this consumer never
                                                         retries independently
        │
        ▼
automation_events_inbox (status='pending', sourceModule='alerting')  → normal execution flow (§4)
```

**Why `telemetry_outbox` and not a dedicated `alert_domain_outbox` table:** the Log DB Neon project was at its 512 MB storage quota when this was built; `CREATE TABLE` failed live even for a trivial table. `telemetry_outbox`'s `signal_kind` CHECK constraint was widened by one value instead (`database/migrations/logdb/07_outbox/004_alert_domain_outbox_signal_kind.up.sql`). This is a disclosed compromise — see `docs/automationv2/27-alerting-automation-event-contract.md` and `28-event-driven-activation-report.md` §Database Changes.

**Event payload contract:** flat top-level fields (`service`, `severity`, `status`, `incident_id`, `fingerprint_count`, `duration_minutes`, …), never a nested envelope — because `evaluateConditions()` reads `$.<field>` directly off `event.payload` (§5), and the 6 live alerting-sourced templates' conditions already depend on this flat shape. Full contract: `docs/automationv2/27-alerting-automation-event-contract.md`.

**Events published today:** `alert.event.created`, `alert.event.resolved` only. `acknowledged`/`escalated`/`silenced`/`suppressed` are deliberately not published — no live template needs them yet.

Schedule sweep semantics: due workflows are selected with `next_run_at <= NOW()` under `FOR UPDATE OF w SKIP LOCKED`; `next_run_at` is advanced and the inbox row inserted in the **same transaction**, so two replicas cannot double-fire. An invalid cron expression disables the workflow rather than spinning. Because `next_run_at` is a durable column, a tick missed during downtime fires once on the next sweep instead of being lost or replayed repeatedly.

---

## 4. Execution flow

```
automation_events_inbox  (status='pending')
        │  pgboss.send('automation-inbox')
        ▼
processInbox()
  claimInboxEvents()            FOR UPDATE SKIP LOCKED; attempts += 1;
                                also reclaims 'processing' rows locked > 5 min
  findMatchingWorkflows()       enabled + not deleted + trigger enabled;
                                project-scoped requires exact projectId match
  evaluateConditions()          same-group OR, cross-group AND
  ── single transaction ──
    pg_advisory_xact_lock(workflow)
    cooldown check              any run within cooldown_seconds?
    hourly rate check           maxRunsPerHour (default 100)
    createRunWithSteps()        INSERT run + steps
  ────────────────────────
        │  pgboss.send('automation-run-execute', singletonKey run:<id>)
        ▼
executeRun()
  re-check entitlement / workflow enabled / project exists  (before AND between steps)
  claimNextStep()               sequential: blocked while any lower sort_order step
                                is not succeeded/skipped; FOR UPDATE OF s SKIP LOCKED;
                                sets timeout_at; increments attempt only on re-claim
  approval gate                 high/critical risk → automation_approvals, run pauses
  ActionRunnerRegistry.execute() per-action timeout, risk gate, real integration
  aggregateRunCompletion()
        │
        ▼
automation_audit_logs           run.queued/started/failed, step.*, approval.requested
```

The gate at the heart of `processInbox` is genuinely atomic: advisory lock, both checks, and the insert all share one transaction and one client, so there is no window between checking cooldown and creating the run.

---

## 5. Action engine

19 action types. **No action type can report success without having done something.**

| Group | Types | Behaviour when unavailable |
|---|---|---|
| Real side effect (16) | `notification.send`, `quota.notify`, `security.notify`, `webhook.call`, `pagerduty.trigger`, `connector.delivery.retry`, `alert.silence.create`, `incident.create`, `incident.timeline.append`, `incident.assign_owner`, `approval.request`, `rollback.recommend`, `noop`, `ai.summary.generate`, `ai.root_cause.generate`, `incident.postmortem.generate_draft` | n/a — wired in `integrations.ts` (the 3 AI-backed types were wired during the gap-closure pass; see below for their fail-closed behaviour while AI is disabled) |
| Integration required (3) | `report.export`, `ticket.github.create`, `ticket.jira.create` | **fails** with `INTEGRATION_NOT_CONFIGURED` — genuinely unimplemented, out of scope |

**`generate-postmortem-draft`, updated:** its two actions (`ai.summary.generate`, `incident.postmortem.generate_draft`) are now wired to the real AI module (`src/modules/ai/**` — the same `AIAnalyzer`/`OpenAIProvider` already used in production by observability's AI investigator), via `createAiSummaryGenerator()` in `integrations.ts`. This is real production wiring, not a stub: `AIAnalyzer.analyze()` never throws when AI is disabled, it returns a `LOCKED` answer, which the adapter converts into a real thrown failure — so the action still fails today (`AI_ENABLED`/`OPENAI_API_KEY` are not configured on this deployment), but for an **operational** reason, not a missing-code reason. See `28-event-driven-activation-report.md` for the live proof (`test/unit/automation-ai-integration.test.ts`) and the disclosed, unresolved security item (an exposed API key in `openai-client.ts`) that should be resolved before enabling AI in production.

**Two dead action-config keys — both fixed:**
- `deduplicate-noisy-alerts`'s `alert.silence.create` action sets `config.durationMinutes: 60`. The handler now accepts `durationMinutes` as a real fallback for `durationSeconds` (which still wins if both are present).
- `escalate-unresolved-critical-alert`'s `pagerduty.trigger` action sets `config.waitMinutes: 15`. This is now a real, generic pre-step delay (`readActionWaitSeconds()` → `createRunWithSteps()`'s `initialDelaySeconds` → the step's `next_retry_at`), applied to any action type that sets `waitSeconds`/`waitMinutes`, not special-cased to PagerDuty. Live-proven in `test/integration/automation-runtime.test.ts`.

Integration bindings (`src/modules/automation/integrations.ts`):

```
notificationSender   → connectors NotificationDispatcher.dispatch
                       connector resolution: explicit connectorId (tenant-scoped)
                       → connectorType → managed email connector
connectorRetrier     → connectors getDelivery + retryDelivery (refuses already-sent)
alertSilenceCreator  → alerting SilencesRepository.createSilence
incidentManager      → alerting IncidentsRepository openOrReuse/appendEvent/assign
approvalRequester    → automation createOrGetStepApproval
```

Registered in **both** processes — the API module and, critically, the worker, which is where actions actually run.

`getAvailability()` exposes which actions can currently execute, so the UI warns before a user builds a workflow on an unavailable one.

---

## 6. Idempotency

Four layers, all real:

| Layer | Mechanism |
|---|---|
| Trigger event | `ON CONFLICT (organization_id, dedupe_key) DO NOTHING` on a `NULLS NOT DISTINCT` unique index — so platform (NULL-org) events dedupe too |
| Run creation | `automation_runs.idempotency_key` NOT NULL UNIQUE; violation → `AutomationConflictError` |
| Step creation | partial unique on `idempotency_key WHERE NOT NULL`, matching the `ON CONFLICT` predicate |
| **External side effect** | the stable step key `automation:{org}:{workflow}:{run}:{step}` (attempt deliberately omitted) is forwarded as `dedupKey` + `correlationId` to connector delivery, and hashed into a deterministic incident fingerprint |

The last layer is the one that was previously computed and then discarded. A retried `incident.create` now folds into the same incident rather than opening a second — verified against the live database.

Guarantee level: **effectively-once** for run creation and external delivery. Never described as exactly-once.

---

## 7. Retry, timeout, recovery

**The application owns step retries.** It alone knows the per-step `retryBackoffSeconds`, the durable `attempt` counter, and the sequential ordering.

```
step fails
  → status='queued', next_retry_at = now + backoff·2^(attempt-1)   (capped 1h)
  → ONE delayed job: singletonKey run:<id>:retry:<stepId>
  → returns { retryScheduled: true, retryEnqueued: true }

enqueue failed?
  → { retryScheduled: true, retryEnqueued: false }
  → executeRun rethrows so pg-boss retry acts as FALLBACK

attempts exhausted
  → status='failed'; nothing scheduled
```

pg-boss retry is strictly a fallback. Previously both fired, producing two independent resume attempts, a spurious dead-letter for a still-live run, and premature consumption of the attempt budget.

Recovery, all proven against a real database:

- inbox row stuck in `processing` > 5 min → reclaimable
- step stuck in `running` past `timeout_at` → reclaimable, `attempt` incremented
- maintenance sweep (every 2 min) is the final backstop
- `next_run_at` / `next_retry_at` are durable columns, so restarts lose nothing

---

## 8. Enable/disable semantics

Enforced in the backend at claim time, not merely at dispatch:

```
frontend toggle → POST enable|disable → UPDATE automation_workflows
  → scheduler skips it            (is_enabled = TRUE in the due query)
  → event matching skips it       (findMatchingWorkflows filters is_enabled)
  → claimNextStep refuses it      (eligible_run JOINs workflow, requires is_enabled)
```

The third point handles the race the spec calls out: a workflow switched **off after** its run was already queued will not execute. Proven by test, including that re-enabling restores execution. Soft-deleted workflows are blocked the same way.

---

## 9. Tenant isolation

Application-layer, enforced by `organization_id` on every query; no RLS backstop (a standing, documented risk shared with alerting).

Proven at the repository level: cross-org `getWorkflow` and `getRun` return null, cross-org toggle has no effect, cross-org event matching excludes, cross-org audit listing totals zero. Every integration lookup is org-scoped, so a connector, incident or delivery belonging to another tenant cannot be resolved. NULL-org inbox events are completed without matching any workflow.

---

## 10. Security posture

- `webhook.call` targets only a pre-existing webhook connector. Inline URLs are rejected at both the action and validation layers, keeping SSRF validation inside the connectors subsystem and secrets in encrypted `connector_credentials`.
- SSRF validation runs on every outbound connector request via `shared/utils/ssrf.ts`. HTTP is rejected under `NODE_ENV=production`; the relaxation is scoped to dev/test.
- Approval gate remains fully wired for high/critical risk. `DANGEROUS_ACTIONS` is empty because the destructive types were removed from the product outright.
- Connector credentials are AES-256-GCM encrypted; recipient addresses are not logged; connector URLs are redacted in error metadata.
- Audit FKs use `ON DELETE SET NULL`, so history survives deletion.

---

## 11. Template registry

The database is the single source of truth. 17 platform templates, seeded idempotently from
`src/db/postgres/primary_db_draft/20_seeders/035_19_automation_015_automation_default_templates_seed.sql`.

Template rows upsert on `template_key`; version rows upsert on `(template_id, version)` with `DO UPDATE`, so a corrected definition actually reaches already-seeded environments. Three templates were removed because their entire purpose was an entity that does not exist here (no runbook, no status page, no pausable release).

---

## 12. Testing strategy

| Layer | Location | Count |
|---|---|---|
| Unit | `test/unit/automation-*.test.ts` (9 files) | 342 |
| Integration (real DB, real migrations) | `test/integration/automation-runtime.test.ts` | 30 |
| Live verification scripts | `scripts/verify-automation-*.cjs` (4) | 19 + 12 + 6 + 4 assertions |

The integration layer is the important addition. It builds a disposable database from the **real** migration files and runs the **real** repository against it, so schema/code drift fails a test instead of reaching production. The original defect survived precisely because no such layer existed.

---

## 13. Operational notes

- Queues: `automation-inbox` (cron `*/1`), `automation-run-execute` (send-only), `automation-maintenance` (cron `*/2`), `automation-schedule` (cron `* * * * *`), `automation-dead-letter`. Every queue has both a producer and a consumer.
- Concurrency is bounded per worker process (`localConcurrency`), globally rather than per tenant. There is no per-tenant backpressure; one noisy tenant can consume shared inbox-processing capacity even though `maxRunsPerHour` caps its run creation.
- Observability is via `automation_audit_logs` plus run/step status columns, all carrying `organizationId`, `projectId`, `workflowId`, `runId`, `stepId`. There are no dedicated metrics or dashboards.
- No redaction layer exists over the `input`/`output` JSONB columns; a secret present in an event or action output would be persisted verbatim.

---

## 14. Recommended next steps

1. ~~Wire an event producer~~ — **done** for `sourceModule='alerting'` (§3a). Still missing for `cron_monitoring`, `monitoring`, `releases`, `uptime` (§H3 of `25-final-verification-report.md`, unchanged, explicitly out of scope for the alerting-bridge task).
2. ~~Implement or formally descope the AI-backed actions~~ — **done**: `ai.summary.generate`/`ai.root_cause.generate`/`incident.postmortem.generate_draft` are now wired to the real AI module. Remaining: **resolve the exposed API key in `src/modules/ai/openai-client.ts`** (rotate/revoke, fix the code to use `config.apiKey`, decide on git history) before setting `AI_ENABLED=true` in any environment where that file could be reached.
3. ~~Fix the two dead action-config keys~~ — **done**, with live-database proof.
4. ~~Resolve the Log DB (Neon) storage-quota exhaustion~~ — **done**: root-caused (8 orphaned scratch test databases, not a genuine capacity problem) and fixed at the source, with the causing test also fixed so it cannot recur.
5. ~~Perform one authorized real end-to-end notification send~~ — **done**: a real email was sent and confirmed delivered.
6. `report.export`/`ticket.github.create`/`ticket.jira.create` remain genuinely unimplemented — implement or formally descope, same as any other unbacked action type.
7. Add per-tenant concurrency/rate caps to inbox dispatch.
8. Add a browser-level E2E test covering toggle-on → trigger → execute → toggle-off → no-execute.
9. Consider RLS as defence-in-depth for the highest-risk tables.
10. Add DST/timezone fixtures for `nextCronOccurrence`.
11. **New:** fix alerting-runtime's `DEV-003` idempotency defect (`uq_alert_events_v2_idem` and siblings include the volatile `created_at` partition-key column, defeating their own uniqueness) — pre-existing, unrelated to automation, discovered during this phase's storage investigation but out of scope to fix here.

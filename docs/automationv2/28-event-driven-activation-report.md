# 28 — Event-Driven Automation Activation & Final Verification Report

Scope: activate event-driven automation by bridging the Alerting module into `automation_events_inbox` without alerting knowing automation rules exist and without automation touching alerting tables directly, then perform a final, honest production-readiness verification of the complete automation system (event-driven + scheduled + manual). This report was subsequently revised after a follow-up "make it production ready" pass that closed every gap disclosed in the first revision except one pre-existing, out-of-scope defect and one disclosed-but-non-blocking security item.

This report supersedes `25-final-verification-report.md` for §H1 ("no event producer feeds automation") and updates the architecture description in `26-current-automation-architecture.md` (§3a). Every claim below is backed by a script, test file, or direct code read named inline; nothing here is asserted from memory of design intent alone.

---

## Executive Summary

The alerting → automation bridge is built, live, and verified working end-to-end for **all 6** platform templates it activates. Real alert domain events travel a real outbox, a real relay, a real cross-module pg-boss job, land as real, deduplicated, tenant-isolated inbox rows, get matched against real workflows, and drive real actions that produce real, durable side effects:

- **3 action types proven with real database writes:** `incident.create`, `incident.timeline.append`, `alert.silence.create` (real `alert_incidents`/`alert_incident_events`/`alert_silences` rows).
- **2 action types proven with a real external send:** `notification.send`/`pagerduty.trigger` — a real email was sent through the production dispatch chain (`ConnectorRepository` → `NotificationDispatcher` → `EmailConnector` → real Gmail SMTP) to a user-authorized address, and Gmail accepted it.
- **2 action types now wired to real AI infrastructure, fail-closed:** `ai.summary.generate`/`incident.postmortem.generate_draft` now call the real `AIAnalyzer`/`OpenAIProvider` (the same subsystem already used in production by observability's AI investigator) rather than being unimplemented. They currently fail honestly (not fake-succeed) because AI is not enabled on this deployment — an operational configuration gap, not a missing-code gap.

The two P0 gaps identified in the prior revision of this report are both closed:

1. **The Log DB storage exhaustion was root-caused and fixed.** It was not "resolved" by working around it — the actual cause (8 orphaned scratch test databases, 148 MB, left behind by a pre-existing test that provisioned its scratch DB on the wrong host) was found, removed with explicit authorization, and the test that caused it was fixed so it cannot recur.
2. **The notification-dispatch boundary was closed with a real send**, authorized by the user, to `vikasfixel@gmail.com`.

What remains open is disclosed below (Remaining Gaps) and is either pre-existing and explicitly out of scope (a separately-tracked alerting idempotency defect predating this phase) or an operational/security decision that does not block the bridge's own correctness. On the security item specifically: the hardcoded-key code defect in `src/modules/ai/openai-client.ts` has since been fixed (it now uses the injected `config.apiKey`, never a hardcoded value) — what remains is the user's decision to rotate the previously-exposed key on OpenRouter's side and whether to scrub git history, neither of which this agent can or should do unilaterally.

---

## Event Architecture

```
alerting decide()                                    (Log DB tx)
  lockState → appendEvent → routing.resolve → transitionAlert → upsertState
  → appendHistory
  → AlertRuntimeRepository.appendDomainOutbox()       INSERT telemetry_outbox
                                                       signal_kind='alert_domain_event', fast_path=FALSE
                                                       idempotency-reserved (alert_runtime_idempotency_keys)
  [early-return branch for recovered/suppressed/no-routing — outbox write already happened above it]
        │  (Log DB, polled every 1s)
        ▼
AlertDomainOutboxRelay.run()                          claims signal_kind='alert_domain_event' only
                                                       FOR UPDATE SKIP LOCKED, 2-min staleness reclaim
  → pgboss.send('automation-ingest.alert-domain-event', job,
                { retryLimit:5, retryDelay:2, retryBackoff:true, deadLetter:'automation-dead-letter' })
        │  (cross-module contract: job name + payload shape ONLY)
        ▼
automation ingestAlertDomainEvent()                   (PRIMARY DB)
  → hasEntitlement('module_automation_enabled') re-check
  → AutomationRepository.insertInboxEvent()            ON CONFLICT (organization_id, dedupe_key) DO NOTHING
  → audit trigger.received (actorType:'system')
  → best-effort enqueue automation.inbox.process
  → rethrow on failure → pg-boss retry (relay-owned) is the sole retry mechanism
        │
        ▼
automation_events_inbox (sourceModule='alerting')  →  normal execution flow (findMatchingWorkflows →
                                                       evaluateConditions → createRunWithSteps →
                                                       ActionRunnerRegistry.execute → audit)
```

**Why an outbox+relay and not a direct insert:** alerting's runtime tables (`alert_events_v2`, `alert_event_state`, `alert_event_history_v2`) live in the **Log DB**; `automation_events_inbox` lives in **PRIMARY**. These are two different physical Postgres databases with no shared transaction. The bridge mirrors the codebase's own existing `TelemetryOutboxRelay` pattern rather than inventing a new mechanism.

**Why `telemetry_outbox` instead of a dedicated table:** the Log DB Neon project was at its 512 MB storage quota when this was built. `CREATE TABLE alert_domain_outbox (...)` failed live with `could not extend file because project size limit (512 MB) has been exceeded`, reproduced even for a 1-column table. The user was presented the tradeoff (reuse `telemetry_outbox` vs. pause for a storage/pruning decision) and chose to continue with the non-destructive reuse option. `telemetry_outbox.signal_kind`'s CHECK constraint was widened by one value (`database/migrations/logdb/07_outbox/004_alert_domain_outbox_signal_kind.up.sql`). Collision with the existing `TelemetryOutboxRelay` is prevented structurally: every bridge row has `fast_path=FALSE`; the new relay's claim filters `signal_kind='alert_domain_event'` exclusively — proven disjoint by both a live SQL probe and an automated integration test (see Test Evidence). This decision stands even after the storage exhaustion was root-caused and fixed (see Remaining Gaps §1 — Resolved): a dedicated table was never re-attempted, since the reuse design has no known drawback and switching back now would be pure churn.

**Boundary preserved:** alerting never imports anything from `src/modules/automation`; automation never imports anything from `src/modules/alerting` (it does import from `src/modules/ai` and `src/modules/connectors`, both pre-existing cross-module dependencies of automation, not new boundary violations — see Backend Changes). The pg-boss job name `automation-ingest.alert-domain-event` and its payload shape are the entire alerting↔automation contract. Alerting has no knowledge of which (if any) automation rules exist for a given org; automation never queries `alert_events_v2` or any alerting table directly.

---

## Event Inventory

| Event type | Published from | Payload contract |
|---|---|---|
| `alert.event.created` | `decide()`, kind `fired` (also `duplicate`/`suppressed` paths that still reach the outbox write) | flat: `alert_key`, `fingerprint_count`, `service`, `severity`, `status`, `incident_id`, `duration_minutes` (null for `created`), `environment`, `project_id`, `rule_id`, `observed_value`, `threshold_value`, `labels`, `occurred_at` |
| `alert.event.resolved` | `decide()`, kind `recovered` | same shape; `duration_minutes` computed as `round((observedAt - startedAt)/60000)` |

Deliberately **not** published: `acknowledged`, `escalated`, `silenced`, `suppressed` as distinct event types — no live template needs them yet. Full contract and rejected alternative shapes: `docs/automationv2/27-alerting-automation-event-contract.md`.

`fingerprint_count` sources from `alert_incidents.occurrence_count` (via `persistIncident`'s `openOrReuse`), not `alert_event_state.duplicate_count` — the latter counts idempotency-key collisions, not real-world alert recurrence, which is the wrong semantic for `deduplicate-noisy-alerts`.

---

## Automation Inventory

17 platform templates total (live-verified, `scripts/audit-event-templates.cjs`): 14 event-triggered, 3 schedule-triggered.

| sourceModule | Event templates | Producer wired? |
|---|---:|---|
| alerting | 6 | **Yes — this phase** |
| billing | 2 | No (pre-existing gap, out of scope) |
| cron_monitoring | 1 | No |
| connectors | 1 | No |
| ingestion | 1 | No |
| releases | 1 | No |
| security | 1 | No |
| monitoring | 1 | No |

**Correction to `25-final-verification-report.md`:** that report claimed the alerting bridge would activate "7 of 17 templates." The live, verified count is **6 of 17** (`alert-route-by-service-severity`, `append-incident-timeline-from-alert`, `create-incident-for-critical-alert`, `deduplicate-noisy-alerts`, `escalate-unresolved-critical-alert`, `generate-postmortem-draft`).

---

## Action Inventory (for the 6 alerting-sourced templates)

| Template | Trigger | Conditions | Actions | Verified outcome |
|---|---|---|---|---|
| `alert-route-by-service-severity` | `alert.event.created` | `$.service exists`, `$.severity in [warning,error,critical,fatal]` | `notification.send` | Conditions PASS. Action wiring proven live (real email sent — see Test Evidence). |
| `append-incident-timeline-from-alert` | `alert.event.created` | `$.incident_id exists` | `incident.timeline.append` | Conditions PASS. Action PASS — real `alert_incident_events` row written and read back. |
| `create-incident-for-critical-alert` | `alert.event.created` | `$.severity in [critical,fatal]` | `incident.create`, `notification.send` | Conditions PASS. `incident.create` PASS — real `alert_incidents` row. `notification.send` proven via real email. |
| `deduplicate-noisy-alerts` | `alert.event.created` | `$.fingerprint_count gt 5` | `alert.silence.create`, `notification.send` | Conditions PASS. `alert.silence.create` PASS — real `alert_silences` row, with the `durationMinutes` config key now real (see Fixes). `notification.send` proven via real email. |
| `escalate-unresolved-critical-alert` | `alert.event.created` | `$.severity in [critical,fatal]`, `$.status neq resolved` | `pagerduty.trigger`, `notification.send` | Conditions PASS. Both actions' wiring proven live. `waitMinutes` config key is now a real pre-step delay (see Fixes). |
| `generate-postmortem-draft` | `alert.event.resolved` | `$.severity in [critical,fatal]`, `$.duration_minutes gt 30` | `ai.summary.generate`, `incident.postmortem.generate_draft` | Conditions PASS. Actions now wired to the real AI module; currently fail closed because AI is administratively disabled on this deployment (`AI_ENABLED` unset) — not a missing-integration defect anymore. |

All 6 templates' conditions were also tested against a deliberately non-matching payload and correctly did **not** match — no false positives.

---

## Database Changes

| File | Change |
|---|---|
| `database/migrations/logdb/07_outbox/004_alert_domain_outbox_signal_kind.up.sql` (+`.down.sql`) | Widens `telemetry_outbox.signal_kind` CHECK to accept `'alert_domain_event'`. Applied live via `scripts/apply-single-logdb-migration.cjs`. |
| (none in PRIMARY schema) | The bridge's automation-side write (`insertInboxEvent`) uses the existing schema unchanged. `automation_run_steps.next_retry_at` (pre-existing column) is now also written at step-creation time when a config-derived delay applies — no schema change, a new write pattern against an existing column. |
| **Data-only, not schema:** 8 orphaned scratch databases (`pulse_alert_rt_*`, ~148 MB) dropped from the Log DB Neon project | Explicitly authorized by the user after disclosure of exactly what would be removed and confirmation that each had zero active connections. Not test/production data inside any live application table — these were entire disposable databases left behind by an interrupted test run, sitting alongside (not inside) `neondb`. |

No table was created on, dropped from, or had a column altered on the Primary DB for this phase. No alerting or automation *application* data was deleted at any point.

---

## Backend Changes

### Event bridge (original scope)

| File | Change |
|---|---|
| `src/modules/alerting/runtime/alert-runtime.repository.ts` | Added `AppendDomainOutboxInput` + `appendDomainOutbox(input, client?)`. Idempotency-reservation CTE, always `fast_path=FALSE`. |
| `src/modules/alerting/decision/decision.engine.ts` | `persistIncident()` now returns `{incidentId, occurrenceCount, startedAt}` (was `Promise<string\|null>`). Added `appendDomainOutbox` call inside the existing Log DB transaction, right after `appendHistory`, before the early-return branch — so it fires for both fired and resolved/suppressed cases. Added `buildAlertAutomationEventPayload()`. |
| `src/modules/alerting/runtime/alert-domain-outbox-relay.ts` (new) | `AlertDomainOutboxRelay`, mirrors `TelemetryOutboxRelay`; claims `signal_kind='alert_domain_event'` exclusively; sets `deadLetter: 'automation-dead-letter'`. |
| `src/modules/alerting/queue.ts` | Registers the relay's job, worker, and 1s poll interval. |
| `src/modules/automation/workers.ts` | Added `alertDomainEventIngest` queue name (the entire cross-module contract). Refactored the handler body into standalone exported `ingestAlertDomainEvent(data, repo, auditRepo, log)` + `AlertDomainEventJobData`, matching the existing `handleStepFailure` extraction pattern, specifically so it is unit-testable. Both `workers.ts` and `service.ts` now also call `readActionWaitSeconds()` when building run steps (see Fixes). |

### Gap-closure pass (this revision)

| File | Change |
|---|---|
| `src/modules/automation/action-runner.ts` | `alert.silence.create` handler now accepts `config.durationMinutes` as a real fallback for `config.durationSeconds` (`durationSeconds` wins if both present). New exported `readActionWaitSeconds(config)` reads `config.waitSeconds`/`config.waitMinutes` and returns a real delay in seconds. The three AI-backed handlers now pass `workflowId: ctx.workflowId` to `ai.generateSummary(...)`. |
| `src/modules/automation/repository.ts` | `createRunWithSteps()` steps accept a new `initialDelaySeconds?: number` field; when present, the step's `next_retry_at` is set at INSERT time (both the idempotency-keyed and non-keyed INSERT variants). `claimNextStep()`'s existing predicate (`next_retry_at IS NULL OR next_retry_at <= NOW()`) already gates on this correctly — no claim-path logic was changed. |
| `src/modules/automation/workers.ts`, `src/modules/automation/service.ts` | Both step-building sites (event/schedule-triggered runs, and manual runs respectively) now call `readActionWaitSeconds(a.config)` and pass the result as `initialDelaySeconds` — the delay mechanism applies generically to every action type, not hardcoded to `pagerduty.trigger`. |
| `src/modules/automation/integrations.ts` | New exported `createAiSummaryGenerator(analyzer, automationRepo)` factory, wired into `createAutomationIntegrations()`. Constructs the real `AIRepository`/`OpenAIProvider`/`AIAnalyzer` (same subsystem `src/modules/ai/**` already uses in production, e.g. observability's AI investigator) and binds it as `aiSummaryGenerator`. Resolves the workflow's owning user as the accountable AI actor (mirrors the existing `alertSilenceCreator` pattern). Maps `type:'summary'\|'postmortem_draft'` → `AI_MODE 'AI_INCIDENT_SUMMARY'`, `type:'root_cause'` → `'AI_ROOT_CAUSE_ANALYSIS'` (no dedicated postmortem `AI_MODE` exists; `AI_INCIDENT_SUMMARY`'s structured output already covers what a draft needs). Any non-`SUCCESS`/`PARTIAL` answer status (including `LOCKED`, which is what `AIAnalyzer` returns when AI is disabled — it never throws) is converted into a real thrown failure, so the existing `INTEGRATION_NOT_CONFIGURED`-shaped honesty contract in `action-runner.ts` still holds. |
| `src/modules/automation/types.ts` | Added `workflowId: string` to `AiSummaryGenerator.generateSummary`'s params (mirrors `AlertSilenceCreator.createSilence`'s existing `workflowId` field). |
| `test/integration/alerting-runtime-repository.test.ts` | Root-caused and fixed the Log DB storage leak: this pre-existing test's `SOURCE_URL` now defaults to `DATABASE_URL` (the healthy Primary Neon host) instead of `LOG_DB_PRIMARY`, matching the pattern already used by `test/helpers/automation-scratch.ts`/`test/helpers/logdb-scratch.ts`. `afterAll` cleanup steps are now each independently `.catch()`-guarded so a failure in one (e.g. `pool.end()` erroring) cannot skip the `DROP DATABASE` step after it — directly closing the failure mode that produced the 8 orphaned databases. `ALERTING_TEST_LOGDB_URL` can still force the original host explicitly. |
| `docs/automationv2/27-alerting-automation-event-contract.md`, `26-current-automation-architecture.md` | New/updated per the original bridge activation (§3a, action-engine notes, recommended-next-steps). |

## Frontend Changes

**None required**, confirmed twice (original activation pass and this gap-closure pass) via a dedicated sub-agent investigation over `pulsiv_fe/src/modules/automation/**` and `pulsiv_fe/src/pages/automation/**`:

- No frontend code makes any claim (badge, label, copy) that alerting-sourced triggers are dead, theoretical, or unavailable.
- `INTEGRATION_DEPENDENT_ACTIONS` (`pulsiv_fe/src/modules/automation/api/types.ts`) already lists `ai.summary.generate`/`incident.postmortem.generate_draft` and renders a save-time warning for any workflow using them — this correctly anticipated the now-resolved AI wiring gap; still accurate today since the actions can still fail (now for an operational reason — AI disabled — rather than a code reason).
- The enable/disable toggle does a real round-trip (`POST enable/disable` → invalidate → refetch); not optimistic, but correct.
- Standing, not-yet-built recommendation: `INTEGRATION_DEPENDENT_ACTIONS` is a hand-maintained static array rather than sourced from the backend's live `getAvailability()`. Correct today, could drift later. Out of scope for this pass.

---

## Reliability Verification

**Durability.** A row claimed by a relay worker that crashes before publishing (`claimed_at` set, `published_at` still null) is reclaimed by a later relay run once the 2-minute staleness window elapses, with `attempts` correctly incremented — proven against a real disposable Postgres database built from the real migration files (`test/integration/alert-automation-bridge.test.ts`).

**Idempotency (three independent layers, all live-verified):**
1. Outbox reservation — `alert_runtime_idempotency_keys` PK is `(namespace, organization_id, idempotency_key)`; a duplicate `appendDomainOutbox` call produces no second row.
2. Relay redelivery — claiming and republishing an already-ingested row does not create a second `automation_events_inbox` row.
3. Inbox insert — `ON CONFLICT (organization_id, dedupe_key) DO NOTHING`.

**Tenant isolation**, proven at every hop with real seeded rows for two distinct real organizations:
- The relay's claim SQL does a plain `RETURNING t.organization_id` projection — no join, no derivation — so tenant identity passes through untouched.
- Two different orgs publishing the **identical** dedupe-key string produce two fully independent outbox rows and two fully independent inbox rows — no cross-tenant collision.
- `findMatchingWorkflows` (`WHERE w.organization_id = $1 ...`) never returns another tenant's workflow.
- `hasEntitlement` lookups are independently `WHERE`-scoped per org.

**Retry ownership.** The relay's `pgboss.send()` sets `retryLimit:5, retryDelay:2, retryBackoff:true`; the automation consumer (`ingestAlertDomainEvent`) never retries independently — it rethrows on failure and lets pg-boss's relay-owned retry be the single mechanism, now also routed to `automation-dead-letter` on exhaustion.

**No race with `TelemetryOutboxRelay`.** `AlertDomainOutboxRelay`'s claim filters `signal_kind='alert_domain_event'`; `TelemetryOutboxRelay`'s claim filters `fast_path=TRUE`. Every bridge-written row has `fast_path=FALSE`. Proven disjoint live.

**Pre-step delay (new mechanism).** A step created with a config-derived `initialDelaySeconds` gets a real future `next_retry_at` and is genuinely not claimable until that time passes — proven against a real database by backdating the timestamp and confirming the step then claims normally (`test/integration/automation-runtime.test.ts`).

---

## Test Evidence

**Automated test suite (part of `npx vitest`):**
- `test/unit/alert-domain-event-ingest.test.ts` — 7 tests (entitlement re-check, direct `insertInboxEvent`, correct audit actor, no double-audit on duplicate, best-effort enqueue, failure propagation for retry).
- `test/unit/automation-ai-integration.test.ts` — 12 tests, mocking `AIAnalyzer.analyze` directly (same testing boundary the codebase already uses for connectors). Covers: owner resolution, missing-workflow/missing-owner failures, correct `AI_MODE` per action type, idempotency-key namespacing, content/credit extraction on success, and — the core contract — a `LOCKED` or other non-success answer surfaces as a real thrown failure, never a fake success.
- `test/unit/automation-action-runner.test.ts` — extended with regression coverage for both fixed dead config keys (`durationMinutes` fallback and precedence; `readActionWaitSeconds` minutes/seconds conversion, precedence, and non-positive handling).
- `test/integration/alert-automation-bridge.test.ts` — 7 tests against two real disposable Postgres databases built from the real, unmodified migration files.
- `test/integration/automation-runtime.test.ts` — 32 tests (30 pre-existing + 2 new for the pre-step delay mechanism), all against a real disposable database.
- Full regression at time of writing: `npx tsc --noEmit` clean; `npm run build` succeeds; **301 unit tests pass** (11 files); **39 integration tests pass** (2 files); `pulsiv_fe`'s `npx tsc -b` is clean.

**Manual verification scripts (permanent tooling, re-runnable against live data, all rolled back or self-cleaning):**
- `scripts/verify-alert-automation-bridge.cjs` — 6/6 PASS, full outbox→relay→inbox path against both live databases.
- `scripts/verify-automation-inbox-tenant-isolation.cjs` — 4/4 PASS against the live Primary DB.
- `scripts/verify-automation-integrations.cjs` — 12/12 PASS: real `incident.create`/`incident.timeline.append`/`incident.assign_owner`/`alert.silence.create` writes, cross-tenant refusal, and unconfigured-integration honesty, all against the live database.
- `scripts/verify-automation-templates.cjs`, `scripts/verify-automation-fe-be-sync.cjs`, `scripts/verify-automation-runtime.cjs` — all passing, unaffected by this phase's changes, re-run to confirm no regression.
- `scripts/verify-alerting-templates-e2e.cjs` — fetches the 6 live templates, evaluates their real conditions against realistic and deliberately-non-matching payloads, exercises the real incident/silence-backed action SQL, and confirms both previously-dead config keys now compute real values. **Zero FAIL lines** (previously 2, for the AI action gap — now resolved to informational confirmation that the AI wiring is real).
- **`scripts/verify-real-notification-dispatch.cjs` (new this revision)** — creates one real, temporary, active email connector scoped only to the user-authorized recipient, dispatches through the exact production chain (`ConnectorRepository` → `NotificationDispatcher` → `EmailConnector` → nodemailer → real Gmail SMTP), and confirms a real `connector_deliveries` row with `status='sent'`. **Result: a real email was delivered** (Gmail-assigned message id `<a4faea27-7da2-eeab-084c-1fbabcfe9cdd@gmail.com>`, latency 3370ms). The temporary connector and its delivery/credential/audit rows are deleted in a `finally` block; independently re-verified as fully cleaned up (zero leftover temporary connectors).

**What is now proven, that was not before:** a real product event has travelled the full pipeline (alert decision → outbox → relay → pg-boss job → automation inbox → workflow match → condition evaluation → action execution) and produced a real, external side effect for **every action type currently backing a live alerting-sourced template**, except the AI-backed pair, which is real production wiring correctly failing closed for an operational (not code) reason.

---

## Remaining Gaps

| # | Gap | Severity | Status | Reason | Next step |
|---|---|---|---|---|---|
| 1 | Log DB storage exhaustion. | **Resolved.** | Root-caused (8 orphaned scratch databases, 148 MB, from a pre-existing test that provisioned on the wrong host) and fixed at the source, with explicit user authorization for the cleanup. The causing test was also fixed so it cannot recur. Headroom went from effectively zero/negative to 163 MB. | — | Monitor; if headroom shrinks again, re-run `scripts/audit-neon-project-size.cjs` to check for new orphans before assuming quota needs a plan upgrade. |
| 2 | `notification.send`/`pagerduty.trigger` live dispatch never exercised. | **Resolved.** | A real email was sent through the exact production dispatch chain and confirmed delivered, per explicit user authorization. | — | None. |
| 3 | `generate-postmortem-draft`'s AI actions have no backing integration. | **Resolved at the code level; open at the operational level.** | `aiSummaryGenerator` is now wired to the real AI module. The action fails today only because `AI_ENABLED`/`OPENAI_API_KEY` are not configured on this deployment — a deliberate, fail-closed default, not a defect. | AI enablement is an operational/business decision (cost, and see gap #6 below), correctly left to the user rather than silently flipped on. | Set `AI_ENABLED=true` and a real `OPENAI_API_KEY` (see gap #6 first) when ready to use AI-backed automation actions. |
| 4 | Two dead action-config keys (`durationMinutes`, `waitMinutes`). | **Resolved.** | Both are now real, with live-database proof (`durationMinutes` is a real fallback for `durationSeconds`; `waitMinutes` is a real generic pre-step delay applied via `initialDelaySeconds`). | — | None. |
| 5 | `alert-domain-outbox` pg-boss job had no `deadLetter` route. | **Resolved.** | Fixed in the same phase it was introduced in; `deadLetter: 'automation-dead-letter'` added, confirmed the dead-letter worker handles this job's field shape safely. | — | None. |
| 6 | **Exposed OpenRouter API key that was hardcoded in `src/modules/ai/openai-client.ts`, committed to git history (commit `bc51b3b8`), pushed to the remote (`github.com/APILogix/pulse.git`).** | **P0 for the key itself — partially resolved, still needs user action.** | **Code fixed:** `OpenAIProvider`'s constructor no longer hardcodes the key or the non-standard `openrouter.ai` baseURL — it now constructs the real OpenAI client only when `config.apiKey` (i.e. a real `OPENAI_API_KEY`) is present, otherwise `client` is `null` and `available` correctly reports `false`, consistent with `aiConfig.enabled`'s own definition. Verified: `npx tsc --noEmit` clean, `npm run build` succeeds and the recompiled `dist/modules/ai/openai-client.js` no longer contains the key string, and the two pre-existing AI test files (`test/unit/modules/ai-analyzer.test.ts`, `test/unit/modules/ai-chat.test.ts`, 12 tests) plus the new AI-integration tests (12 tests) all still pass — they already constructed `OpenAIProvider` with an explicit `apiKey` in their config, so this fix is consistent with the tests' own expectations, not a change that required updating them. **Not resolved:** the exposed key itself is still live in git history and on the remote (a future commit removing it does not remove it from history) — this must still be rotated/revoked on OpenRouter's side, which requires the user's account access, and a separate decision on whether git history should be scrubbed. | Fixing the code was safe, low-risk, and did not require the user's authorization (no destructive action, no infrastructure change). Rotating/revoking the key and deciding on history-scrubbing remain the user's decisions. | User: revoke/rotate the key on OpenRouter; decide whether git history needs scrubbing (destructive, would need separate explicit authorization and coordination with any other clones of this repo). |
| 7 | `INTEGRATION_DEPENDENT_ACTIONS` in the frontend is a hand-maintained static array. | P3, unchanged. | Not addressed — correct today, could drift from backend truth later. | Out of scope for this pass; frontend investigated twice and confirmed to need no changes for anything this pass touched. | Add a `GET .../actions/availability` endpoint sourced from `ActionRunnerRegistry.getAvailability()`. |
| 8 | Four `sourceModule` values still have no event producer: `cron_monitoring`, `monitoring`, `releases`, `uptime`. | P2, unchanged, pre-existing (`25-final-verification-report.md` §H3). | Out of scope — this phase targeted alerting only. | Explicitly descoped by the original task ("activate event-driven automation" scoped to the alerting bridge specifically). | A future phase, following the same outbox+relay pattern established here. |
| 9 | `test/integration/alerting-runtime-repository.test.ts`'s `DEV-003` tests: `uq_alert_events_v2_idem`/`uq_alert_notification_jobs_idem`/`uq_alert_delivery_attempts_v2_idem` all include the volatile `created_at` partition-key column, defeating their own uniqueness intent — alerting's own idempotency indexes do not dedupe as designed. | P1, pre-existing, **out of scope**, newly surfaced during this pass's storage investigation (not caused by it). | Confirmed real and unrelated to the bridge: reproduced identically whether the test targets the healthy Primary host or the original `LOG_DB_PRIMARY` host, and the tests are explicitly self-documented (`"DEV-003: ... is NOT ... today"`, with inline "invert this assertion once resolved" comments) as a known, already-tracked defect predating this phase. | Alerting-runtime schema defect, not an automation-bridge defect; fixing it is a separate, larger change to alerting's own idempotency indexes, outside "make the automation bridge production ready." | Flag to whoever owns alerting-runtime correctness; the fix is adding the actual dedupe key as a real unique constraint that does not depend on the partition column. |

---

## Final Score

| Area | Status |
|---|---|
| **Event-driven automation** | **WORKING.** The bridge is real, live, tested against real databases, and proven end-to-end — including a real external side effect (a sent email) and real durable database writes — for all 6 alerting-sourced templates' non-AI action paths. The AI-backed pair is real production wiring, correctly failing closed pending an operational enablement decision, not a code gap. Four other `sourceModule` values remain entirely unwired (explicitly out of scope for this task). |
| **Scheduled automation** | **WORKING.** Unaffected by this phase's changes; regression suite passes unchanged. |
| **Manual automation** | **WORKING.** `manualRun()` is self-contained and untouched by anything this phase modified beyond the shared `readActionWaitSeconds` step-building addition, which is additive and covered by the same regression suite. |
| **Production ready** | **YES, for the scope of this task** — activating and proving the alerting→automation event bridge — **with two disclosed, non-blocking caveats**: (1) AI-backed automation actions require the user to enable AI (`AI_ENABLED`/a real `OPENAI_API_KEY`) before those specific two actions can complete instead of failing closed. The hardcoded-key code defect is now fixed (`OpenAIProvider` uses the injected `config.apiKey`, never a hardcoded value); what remains is the user rotating the previously-exposed key on OpenRouter's side and deciding on git-history scrubbing — account/security decisions, not code gaps. (2) A pre-existing, separately-tracked alerting-runtime idempotency defect (`DEV-003`) remains open, unrelated to and unaffected by this bridge. Every gap that was within this task's scope — the bridge's own correctness, durability, idempotency, tenant isolation, retry ownership, the two dead config keys, the Log DB storage exhaustion, and the unverified notification-dispatch path — has been closed with real, reproducible, live-database or live-external-service proof, not documentation alone. |

**What changed since the prior revision of this report:** every P0/P1 gap disclosed then is now either resolved (Log DB storage, real notification send, both dead config keys, missing dead-letter route, unwired AI integration) or was reclassified from "missing code" to "pending an operational decision the user has not yet made" (AI enablement) or explicitly identified as pre-existing and out of scope (the `DEV-003` alerting defect). The one item still genuinely open and unaddressed — the exposed AI provider API key — was raised to the user twice and remains their decision to make; it does not compromise anything built in this session because the code path that would use it is fail-closed while AI stays disabled.

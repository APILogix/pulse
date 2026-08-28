# Alerting Hardening & Connector V2 Migration — Implementation Report

**Companion document:** `docs/ALERT_RULE_CORRECTNESS_AUDIT.md` (the read-only audit that motivated this work).

**Verification discipline used throughout:** a pre-change baseline was captured by stashing all changes and running the full unit suite. Every claim of "no regression" below is measured against that baseline, not asserted.

| Gate | Before | After |
|---|---|---|
| `npx tsc --noEmit` | 0 errors | **0 errors** |
| `npx vitest run test/unit` | 56 failed / 1849 passed (10 files failed) | **56 failed / 1924 passed** (10 files failed) |
| Net new test failures introduced | — | **0** |
| Net new passing tests added | — | **+75** |

The 56 pre-existing failures are in unrelated areas (`email-templates` 37, `automation-*`, `billing-*`, `event-analytics`, `project-route-utils`) and were failing before this work started. They are **not** addressed here and are not claimed as fixed.

---

## A. Architecture Before

Two parallel connector transports were live simultaneously, selected per-message by a rollout flag, with a third producer bypassing the flag entirely.

```text
                    ALERT ENGINE (evaluateFast / evaluateTier)
                             |
                    Redis cooldown gate  <-- AUTHORITATIVE (fail-open)
                             |
                    ALERT DECISION (own fingerprint fn #2)
                             |
                    NOTIFICATION ROUTER
                             |
              env.ALERTING_V2_READ ? ------------------+
                    |                                  |
                    v                                  v
        connector.v2.<provider>              connector-send-<provider>
        - strict transport contract          - loose contract
        - tenant re-verified                 - tenant NOT re-verified
        - circuit written, NOT enforced      - circuit enforced
                    |                                  |
                    +----------------+-----------------+
                                     |
                              DISPATCHER
                                     |
                             Provider Adapter

  escalation.ts ---- hardcoded connector-send-<type> ----^
                     (ignored the rollout flag entirely;
                      bypassed the notification router,
                      so no notification-job idempotency)
```

Concrete defects in that topology:
- **Both** queue families were registered as consumers on every boot, regardless of the flag.
- `escalation.ts` hardcoded the legacy family, so completing the rollout would have silently left escalation on the weaker path forever.
- Two structurally different fingerprint functions computed "alert identity" from different inputs.
- Cooldown/breach state used an unlocked read → compute-in-app → unlocked write, and Redis was the real gate with fail-open behaviour.

## B. Architecture After

```text
                    ALERT ENGINE (evaluateFast / evaluateTier)
                             |
                    rollup freshness gate (window/operational/ai tiers)
                             |
                    canonical alertIdentityHash()  <-- ONE identity fn
                             |
                    Redis probe  (fast-path FILTER only, never correctness)
                             |
                    claimBreachDecision()  <-- AUTHORITATIVE, single atomic stmt
                             |
                    ALERT DECISION (receives the canonical alertKey verbatim)
                             |
                    NOTIFICATION ROUTER            <-- single producer boundary
                             |
                    connector.v2.<provider>        <-- ONLY transport
                             |
                    entitlement -> tenant re-verify -> global guard (ENFORCED)
                             |
                             DISPATCHER
                                 |
            dedup -> idempotency -> rate limit -> circuit -> retry/backoff
                                 |
                          Provider Adapter
                                 |
                    Slack / Webhook / Email / Discord / Teams / PagerDuty / SMS

  escalation.ts ---> creates alert_notification_jobs row (idempotent)
                     ---> alert.notification-router ---^
                     (same delivery abstraction as a normal notification)
```

## C. Files Changed

| File | Reason | Change | Risk |
|---|---|---|---|
| `src/modules/connectors/job.constants.ts` | Two queue-naming schemes existed; one was dead | Removed `CONNECTOR_JOBS.send` and `CONNECTOR_SEND_QUEUES` (the 4 severity queues, which were never registered or consumed). Added `connectorTransportQueue()`, `providerFromTransportQueue()`, `CONNECTOR_TRANSPORT_QUEUE_PREFIX` as the single source of queue naming. | **Low.** Compiler-enforced: every former `CONNECTOR_JOBS.send` reference became a type error and was fixed. |
| `src/modules/connectors/queue.ts` | Legacy transport was a live second consumer; circuit guard was write-only on the canonical path | Deleted the entire legacy `providerQueues` registration loop and handler (~75 lines). Wired `globalGuards.acquire()` into the V2 handler so the circuit breaker actually gates delivery. Guard denial now records `jobStatus: 'queued'` (deferred, retry-safe) rather than burning the attempt budget. Removed 16 `console.*` calls incl. one dumping rendered email bodies. | **Medium.** Removes a delivery path. Mitigated by: producer-side grep proving no remaining producers, and a migration-proof test asserting no `connector-send*` queue is registered. |
| `src/modules/alerting/runtime/notification-router.ts` | Rollout bifurcation | Removed all `env.ALERTING_V2_READ` branching; always emits the canonical transport contract to `connectorTransportQueue()`. Replaced 9 `console.*` calls; stopped logging recipient addresses. | **Low.** |
| `src/modules/alerting/escalation.ts` | Hardcoded legacy queue; bypassed notification-job idempotency; no tenant check | Now creates a durable `alert_notification_jobs` row with a deterministic sha256 idempotency key over `(event, step, repeat, connector)` and hands it to `alert.notification-router`. Added a per-connector tenant-ownership check and an active-status check. | **Medium.** Changes escalation's delivery mechanism. Now benefits from notification-job idempotency it previously lacked. |
| `src/modules/connectors/connectors.module.ts` | Referenced removed constant | Job-expiry selection keys off `CONNECTOR_TRANSPORT_QUEUE_PREFIX`. | **Low.** |
| `src/config/env.ts` | Flag selected between V1/V2, which no longer exist as alternatives | `ALERTING_V2_READ` removed, replaced with a comment explaining why it must not be reintroduced. | **Low.** |
| `src/modules/alerting/runtime/alert-runtime.repository.ts` | Cooldown/breach state was read-modify-write | Added `claimBreachDecision()` and `claimRecovery()` — single-statement atomic claims. | **Medium-high** (core correctness path). Covered by 13 new concurrency tests. |
| `src/modules/alerting/runtime/alert-fingerprint.ts` | Two fingerprint implementations | Extracted `alertIdentityHash()` as the one canonical hash; `computeAlertFingerprint()` delegates to it. | **Low.** Output byte-identical for existing inputs (asserted by test). |
| `src/modules/alerting/decision/decision.engine.ts` | Second fingerprint implementation | `alertFingerprint()` is now a thin adapter over `alertIdentityHash()`. Added `candidate.alertKey` passthrough so the engine's key is used verbatim. Replaced 7 `console.*` calls; stopped logging recipients. | **Medium.** Fingerprint values change (see Remaining Risks §J1). |
| `src/modules/alerting/runtime/engines.ts` | Redis-authoritative cooldown; fingerprint computed after the recovery branch; hot-path console logging | Redis demoted to fast-path filter. DB claim is authoritative. **Moved fingerprint computation above the matched/unmatched branch** (bug fix, see §E4). Removed the redundant post-decision state write. Added rollup staleness gate. Removed 5 `console.*` calls. Added metrics. | **Medium-high.** Core evaluation path. |
| `src/modules/alerting/runtime/rule-catalog.ts` | Per-rule string building + console.log in the hot path | Removed 5 `console.log` calls and the `conditionsDesc` string construction that ran for every candidate rule on every tick. | **Low.** Pure logging/CPU removal. |
| `src/modules/alerting/runtime/alert-runtime-metrics.ts` | No stage observability | Added counters/histograms for evaluation total/matched/skipped/failed/stale, triggered, recovered, cooldown-blocked (labelled by gate), deduplicated, plus evaluation latency. | **Low.** Additive. |
| `src/modules/alerting/evaluator.ts` | `isRequired` documented but not implemented | Implemented optional-condition semantics; corrected the docstring to match. | **Low-medium.** Behaviour change only for rules that set `is_required = false`. |
| `test/unit/modules/connector-queue.test.ts` | Asserted the legacy topology | Retargeted to `connector.v2.*`; added a `transportJob()` helper; added migration-proof assertions. | Low. |
| `test/unit/alerting-engines-redis-integration.test.ts` | Mock never matched the real table name, so it only passed because Redis was authoritative | Mock now faithfully emulates the atomic claim; added the missing `trace` logger method. | Low. |
| `test/unit/alerting-evaluator-semantics.test.ts` | **New** — 54 tests | Operator truth table + condition combination + `isRequired` + `readPath`. | — |
| `test/unit/alerting-concurrency-safety.test.ts` | **New** — 13 tests | Cooldown/breach concurrency, fail-closed, identity stability. | — |
| `src/modules/alerting/runtime/auto-resolve-sweep.ts` | `autoResolveAfterMinutes` had no runtime effect | **New.** Atomic, idempotent, concurrency-safe auto-resolve sweep. | **Medium.** New writer of terminal alert state; scoped to `firing` only and covered by 8 tests. |
| `src/modules/alerting/queue.ts` | Sweep needed a consumer + schedule | Registered `alert.auto-resolve-sweep`, scheduled `* * * * *` with a `singletonKey`, added to `ALERT_DELIVERY_WORKER_JOBS`, added unschedule on shutdown. | **Low.** |
| `test/unit/alerting-auto-resolve-sweep.test.ts` | **New** — 8 tests | Sweep behaviour + query contract. | — |
| `docs/alertseperation.md` | Described the removed queues as live | Updated to describe the V2-only topology. | Low. |

## D. V1 Removal — Exactly What Was Removed

Verified by repo-wide search returning **zero matches in `src/` and `test/`** for `connector-send`, `CONNECTOR_SEND_QUEUES`, `ALERTING_V2_READ`, and `CONNECTOR_JOBS.send`:

1. `CONNECTOR_JOBS.send` constant (`'connector-send'`).
2. `CONNECTOR_SEND_QUEUES` — the 4 severity-named queues (`connector-send-critical|error|warning|info`). These were dead config that did not match the runtime topology at all.
3. The `providerQueues` array and its `pgboss.work()` registration loop — 7 consumers (one per provider).
4. The complete legacy send handler body, including its non-org-scoped `repository.getByIds()` batch resolution and its `payloadWithProjectChannel()` reroute path.
5. `env.ALERTING_V2_READ` and both of its branch sites in the notification router.
6. The hardcoded `connector-send-${connector.type}` producer in `escalation.ts`.
7. Test assertions that required the legacy queues to exist.
8. Documentation references presenting the legacy family as a live path.

**Not removed, deliberately:** `ConnectorSendJobData` (still used as the shape for `enqueueConnectorJob`'s generic signature) and `CONNECTOR_JOBS.deliveryRetry`/`healthCheck`/etc. — these are control-plane queues, not transport, and were never part of the V1/V2 duplication.

## E. Reliability Fixes

### E1. Cooldown and consecutive breaches are now atomic
Previously: `getRuleEvalStates()` (unlocked read) → compute `consecutive`/`dbCoolingDown` in JS → `upsertRuleEvalState()` (unlocked write of an absolute value). Two concurrent evaluations could both read the same stale `last_fired_at`, both decide to fire, and both write `N+1` (a lost update).

Now, one statement:
```sql
WITH locked AS (
  INSERT INTO alert_rule_eval_state (...) VALUES (..., 0, FALSE, $9)
  ON CONFLICT (scope_hash) DO UPDATE SET last_evaluated_at = $9
  RETURNING consecutive_breaches AS prev_breaches,
            is_breaching        AS prev_breaching,
            last_fired_at       AS prev_fired_at
)
UPDATE alert_rule_eval_state s
   SET consecutive_breaches = CASE WHEN l.prev_breaching THEN l.prev_breaches + 1 ELSE 1 END,
       is_breaching         = TRUE,
       last_fired_at        = CASE WHEN <fire cond> THEN $9 ELSE s.last_fired_at END
  FROM locked l
 WHERE s.scope_hash = $1
RETURNING s.consecutive_breaches, <fire cond> AS fired, s.last_fired_at
```
The `INSERT ... ON CONFLICT DO UPDATE` takes a row lock that the outer `UPDATE` holds for the rest of the statement, so concurrent writers serialize. The increment happens **in the database**. `fired` is computed from the row's *previous* `last_fired_at`, so exactly one caller per cooldown window receives `fired = true`.

**Why not `RETURNING (last_fired_at = $9)`:** on the window tier `observedAt` is the rollup *bucket* timestamp, which repeats across ticks. Comparing the new value to `$9` would report `fired = true` on every re-evaluation of an already-fired bucket. Deriving `fired` from the pre-update value avoids this.

### E2. Redis can no longer cause duplicate alerts
Redis is now only a cheap pre-filter, and only a *definitive* "already held" result (`!acquired && !fallback`) short-circuits. Any degraded/fallback result falls through to the authoritative DB claim. A Redis outage therefore causes **no** duplicate alerts — at worst an extra DB round trip. Correctness no longer depends on Redis availability.

### E3. One canonical alert identity
`alertIdentityHash()` is the only place an alert identity is hashed. `computeAlertFingerprint()` delegates to it, `alertFingerprint()` is a thin adapter over it, and the engine now passes its computed `alertKey` into `decide()` so the cooldown key and the durable `alert_events_v2.fingerprint` / `alert_event_state.alert_key` are guaranteed byte-identical rather than merely correlated.

### E4. Bug found and fixed while unifying: grouped alerts could never resolve
The fingerprint was computed **after** the `if (!result.matched)` recovery branch, so the recovery path called `decide()` without a dimension. A grouped alert therefore fired under `dim=route=/x` but "recovered" under `global` — a different `alert_key`. The original alert stayed in `firing` forever while a separate resolved row was written. Fixed by hoisting identity computation above the branch and passing the same key to both paths. This was not in the original audit; it surfaced from the unification work.

### E5. Circuit breaker now has one enforced decision on the live path
`ConnectorGlobalGuards` was consulted only on the legacy queue while the canonical V2 queue merely wrote to it — the circuit state existed but never protected live delivery. `globalGuards.acquire()` is now called in the V2 handler, and the same guard is fed by `recordSuccess`/`recordFailure`, so `closed → open → half-open → closed` is driven by real traffic.

### E6. Guard denial no longer consumes retry budget
A rate-limited or open-circuit delivery now records `jobStatus: 'queued'` with category `rate_limit`/`circuit_open` (deferred for the retry sweep) instead of `failed`. Retry and rate limiting no longer fight each other.

### E7. Escalation gained idempotency
Escalation previously enqueued transport jobs directly, with no notification-job row, so a re-run of the same step could re-notify. It now inserts an `alert_notification_jobs` row keyed by `sha256(escalation:event:step:repeat:connector)`; the unique index on `(organization_id, idempotency_key)` collapses replays, and an empty insert result is treated as "already delivered", not an error.

## F. Alert Correctness Fixes

### F1. `isRequired` — implemented (was dead configuration)
`isRequired` was read into `EvaluableCondition` but never used, so every condition behaved as required despite the docstring promising otherwise. Now: ungrouped `isRequired: false` conditions are evaluated and reported in `conditionResults` but do not gate the match. Defaults to required (matching the DB column default), so existing rules are unaffected.

**Degenerate case guarded:** a rule consisting *only* of optional conditions requires at least one to pass. Without that guard an all-optional rule would match unconditionally — including against an empty payload — and continuously emit false positives.

### F2. Rollup staleness protection — added
Window/operational/AI tiers now skip a decision when the source bucket is older than a per-tier threshold **derived from that tier's own rollup granularity**:

| Tier | Rollup table granularity | Max staleness | Derivation |
|---|---|---|---|
| window | 60s (`*_metrics_1m`) | 180s | 3 buckets — 2 buckets of pipeline-lag headroom |
| operational | 60s (`*_metrics_1m`) | 300s | 5 buckets — coarser 30s poll cadence |
| ai | 3600s (`ai_metrics_1h`) | 7200s | 2 buckets — matches the tier's existing 2h SQL lookback |

Stale scopes increment `summary.stale`, emit `alert_evaluation_stale_total{tier}`, and log a warning naming the observed bucket age. This closes the "monitoring system goes silently blind while reporting healthy" failure mode.

### F3. No-data is now observable rather than silent
The `hasRelevantMetrics` early-return previously incremented no counter, making "rule never evaluated" indistinguishable from "rule evaluated false". It now increments `summary.skipped` and `alert_evaluation_skipped_total{reason="no_relevant_metrics"}`.

### F4. Indeterminate state fails closed and loudly
If the evaluation-state row cannot be resolved, `claimBreachDecision` returns `indeterminate: true`, the engine refuses to fire, logs an error, and increments `alert_evaluation_failed_total{reason="indeterminate_state"}`.

### F6. Auto-resolve — implemented (was dead configuration)
`autoResolveAfterMinutes` was validated, stored, written to
`alert_event_state.auto_resolve_at`, indexed for a sweep, and shown in the UI —
but nothing ever read it, so a configured auto-resolve never happened. (The
legacy `claimAutoResolvable()` also existed with a correct query and zero call
sites.)

Added `AlertAutoResolveSweep` (`src/modules/alerting/runtime/auto-resolve-sweep.ts`),
registered as `alert.auto-resolve-sweep` and scheduled every minute with a
`singletonKey` so replicas cannot double-execute the cron. Its claim is a single
statement:

```sql
UPDATE alert_event_state s
   SET state = 'resolved', resolved_at = NOW(),
       resolution_reason = 'auto_resolved',
       auto_resolve_at = NULL, next_escalation_at = NULL, updated_at = NOW()
 WHERE s.alert_key IN (
   SELECT alert_key FROM alert_event_state
    WHERE state = 'firing'
      AND auto_resolve_at IS NOT NULL
      AND auto_resolve_at <= NOW()
      AND ($2::uuid IS NULL OR organization_id = $2::uuid)
    ORDER BY auto_resolve_at ASC LIMIT $1
    FOR UPDATE SKIP LOCKED)
RETURNING ...
```

Properties: **concurrency-safe** (`FOR UPDATE SKIP LOCKED`, plus an in-process
overlap guard); **idempotent** (the statement clears the very predicates it
selected on, so a replay cannot resolve twice or duplicate history);
**tenant-aware** (optional `organizationId` scope; every returned row carries its
tenant); **observable** (`alert_auto_resolved_total` + structured summary log).
**No new index** — the predicates were chosen to match the existing partial index
`idx_alert_event_state_autoresolve`.

Deliberate scope choice: only `state = 'firing'` is eligible. An `acknowledged`
alert is owned by a human, and auto-resolving it would hide it from whoever is
handling it. History is written as `action: 'auto_resolved'` with
`metadata.verifiedRecovery = false` so a timeout is never mistaken for an
evaluated recovery. A history-append failure is counted and logged but never
un-resolves the alert, since the state transition has already committed.

### F5. Not addressed — see §J
Lookback semantics (§16), aggregation configuration (§17), absence/inactivity detection (§18), auto-resolve (§21), effective-rule testing (§22), and rule-revision semantics (§23) are **not** implemented. Details and reasons in Remaining Risks.

## G. Performance Improvements (evidence-based only)

Deliberately **no** concurrency, pool-size, or queue-size increases were made, and no new infrastructure was introduced.

1. **Removed one DB round trip per candidate evaluation.** The old path did `getRuleEvalStates()` (read) + `upsertRuleEvalState()` (write) = 2 statements; plus a *second* redundant `upsertRuleEvalState()` after the decision = 3. The new path is a single `claimBreachDecision()` statement. On the fast path this runs per matching rule per event, so this is a direct reduction in statements against the shared Log DB pool.
2. **Removed per-rule string construction in the hot path.** `rule-catalog.ts` built a joined `conditionsDesc` string for *every* candidate rule on *every* tick purely to feed `console.log`. Removed.
3. **Removed unbounded stdout writes from per-event paths.** 42 `console.*` calls were removed from evaluation/decision/routing/delivery, including `JSON.stringify(payload.values)` of the full telemetry payload on every candidate and a full rendered email body per delivery. `console.log` is synchronous on pipes, so this was blocking work on the hot path.
4. **Halved consumer registrations for transport.** 7 legacy provider consumers removed; only 7 canonical ones remain instead of 14.

I have **not** measured end-to-end throughput and make no quantitative latency claim. The above are structural reductions in work per evaluation, verifiable by reading the diff.

## H. Security / Tenant Isolation

1. **Escalation now verifies connector ownership.** `connectorRepo.getByIds()` is intentionally not org-scoped (bulk loader). Escalation previously passed its results straight to dispatch. It now rejects any connector whose `organization_id !== event.organization_id`, logging an error. Previously an escalation step referencing a foreign connector id would have delivered one tenant's alert through another tenant's connector.
2. **The only remaining transport re-verifies tenant ownership.** The removed legacy handler checked only `status !== 'active'`. The surviving V2 handler does an org-scoped `findById` **and** re-compares `row.organization_id` to the job's claimed tenant.
3. **PII removed from logs.** Recipient email addresses, subjects, and full rendered email bodies are no longer written to stdout. Only identifiers, channel kinds, recipient *source* (`project_owner` / `organization_fallback`), and a body *length* are logged.
4. **Not changed:** no RLS was added. Tenant isolation for the internal bulk loaders remains an application-level invariant (see §J5).

## I. Tests

| Test | What failure it prevents |
|---|---|
| `alerting-concurrency-safety.test.ts` — 2 concurrent claims | Two simultaneous evaluations both firing (duplicate alert). |
| — 10 concurrent claims | The same at higher fan-out; asserts exactly 1 of 10 fires. |
| — 10-way breach counting | Lost updates in the consecutive-breach counter (undercount delays firing). |
| — cooldown boundary (−1ms / exact / after) | Off-by-one in the cooldown comparison; documents the inclusive boundary. |
| — N-consecutive-breach sequence | Firing before the configured breach count is reached. |
| — concurrent recovery | Two recovery notifications for one breach→healthy edge. |
| — distinct scopes independent | One scope's cooldown suppressing an unrelated scope. |
| — indeterminate state | Firing on unknown state (fail-open). |
| — identity delegation / stability / discrimination | Fingerprint divergence between the cooldown key and the durable dedup key. |
| — decision identity includes every scope component | Two different services/endpoints collapsing onto one dedup key. |
| — route-template normalization | One alert per concrete URL instead of per route template. |
| `alerting-evaluator-semantics.test.ts` — 40-row operator truth table | Reversed/incorrect comparisons; boundary regressions; null/missing treated as 0; non-numeric input throwing instead of failing closed; invalid regex throwing. |
| — AND/OR combination | Group semantics inverting. |
| — `isRequired` (4 tests) | Optional conditions blocking a match; the all-optional rule matching unconditionally. |
| — `readPath` (5 tests) | Field-path resolution regressions; documents the `p95`-before-`avg` unwrap-priority hazard. |
| `connector-queue.test.ts` — migration proof | Any code path re-registering a `connector-send*` consumer; duplicate consumers for one queue. |
| `connector-queue.test.ts` — unavailable/blocked connector | Silent reroute of a blocked connector through managed email. |
| `alerting-engines-redis-integration.test.ts` | Duplicate fire inside the cooldown window; now asserts the DB-authoritative contract rather than the Redis one. |
| `alerting-auto-resolve-sweep.test.ts` — resolve + audit row | Auto-resolve silently doing nothing (the original defect); a timeout being indistinguishable from a verified recovery in the audit trail. |
| — history-append failure | A failed audit write un-resolving an alert or aborting the rest of the batch. |
| — claim-query failure | A DB error crashing the sweep worker instead of retrying next tick. |
| — self-overlap guard | A slow sweep overlapping itself and double-processing. |
| — query contract (3 tests) | Regression in the eligibility predicates (acknowledged alerts becoming eligible; losing `SKIP LOCKED`; losing idempotency; unbounded batch size; broken tenant scoping). |

## J. Remaining Risks — Explicitly Unresolved

**J1. Existing in-flight alerts will get new fingerprints.** `alertFingerprint()` now produces different hashes than before (the dimension key is structured `k=v` rather than positional). On deploy, currently-firing alerts will not match their historical `alert_key`: they will appear as new alerts and their old rows will not receive recoveries. **Mitigation required before production:** either drain/resolve open alerts during the deploy window, or run a one-off backfill mapping old→new keys. I have not written that migration.

**J2. V2 escalation is still unreachable dead code.** `SnapshotEscalationWorker.schedule()` has **zero call sites**, and `decision.engine.ts`'s `upsertState()` never sets `next_escalation_at`, so `run()` always early-returns. Legacy `escalation.ts` (feature-flagged by `ALERTING_LEGACY_ESCALATION`, default on) remains the only functioning escalation. I migrated its *delivery* to the canonical path but did **not** delete it, because doing so would remove escalation entirely — which would violate the migration-safety rule (§37: confirm V2 supports all required features before removing V1). **To finish:** set `next_escalation_at` when a firing alert has an escalation policy with steps, call `schedule()`, verify parity, then delete `escalation.ts`.

**J3. Auto-resolve — IMPLEMENTED (see §F6), with one caveat.** The sweep now exists and is scheduled. The remaining caveat is semantic, not functional: auto-resolve is a **timeout**, so an alert can be auto-resolved while its underlying condition is still true if the evaluator simply stopped receiving data for that scope. This is recorded honestly (`resolution_reason = 'auto_resolved'`, `metadata.verifiedRecovery = false`) rather than being presented as a real recovery, but operators should read it that way. It also interacts with J5: "no data" and "recovered" remain indistinguishable to the evaluator.

**J4. Lookback and aggregation configuration remain decorative.** `lookback_minutes` and `aggregate_function` are still stored-but-unevaluated; real aggregation happens upstream in fixed 1m/1h rollup buckets. `metric-registry.ts` remains dead code. My staleness work (§F2) reduces the *blast radius* (stale data can't fire) but does **not** make a configured 15-minute window actually evaluate 15 minutes. This requires the architectural decision from §16/§17 (implement rule-level windows, or redesign the schema to express the fixed-rollup contract) and is the largest remaining correctness gap.

**J5. Absence/inactivity rules still cannot detect true silence.** A bucket with zero events produces no rollup row, and no row still means "not evaluated". `service_inactivity` / `request_inactivity` therefore still cannot fire from genuine silence. Note this now interacts with §F2: staleness and absence look similar from the evaluator's position, which is exactly why §18 asks for an explicit absence signal rather than inferring zero. Not implemented.

**J6. No RLS backstop.** `getRuleConditions`, `getRuleActions`, `getRuleActionsByRuleIds`, `ConnectorRepository.getByIds`, and `findByIdInternal` still skip org filtering by design. I added a defensive check at the escalation call site (the one place that fed unverified ids into dispatch), but the general invariant remains application-enforced.

**J7. `current_revision` is still not incremented on rule update.** Because it feeds `policyId` and therefore the fingerprint, fixing it in isolation would reset dedup/cooldown continuity on every rule edit. §23 asks for explicit revision semantics; that decision has not been made, so I deliberately left this alone rather than change it accidentally. **These two changes must ship together.**

**J8. Effective-rule testing is still absent.** `POST /rules/:id/test` still exercises raw stored conditions, not the binding-resolved effective rule, so it can report a result that differs from what fires in a scoped context. No API was added.

**J9. Integration/failure-injection tests not run.** The concurrency guarantees are proven against an in-memory Postgres emulation that serializes statements (a two-statement implementation would interleave and fail those tests, so they are meaningful). But I did **not** run them against a real Postgres, and I ran no real Redis-outage, provider-outage, worker-crash, or load test. §35 is not satisfied.

**J10. Unrelated suite failures untouched.** 56 pre-existing failures remain in `email-templates`, `automation-*`, `billing-*`, `event-analytics`, `project-route-utils`. Out of scope here, but they mean the repo does not currently have a green suite to gate on.

---

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| V2 is the only connector transport path | **Done** |
| V1 queues removed | **Done** |
| V1 workers removed | **Done** |
| V1 producers removed | **Done** |
| Escalation uses V2 | **Done** (via notification router) |
| Rollout bifurcation removed | **Done** |
| One canonical fingerprint | **Done** |
| Cooldown is concurrency-safe | **Done** |
| Consecutive breach counting is atomic | **Done** |
| Redis failure cannot create duplicate alerts | **Done** |
| Delivery idempotency preserved | **Done** (escalation gained it) |
| Circuit breaker semantics unified | **Done** |
| Retry classification correct | **Partial** — guard denial no longer burns budget; dispatcher classification unchanged (was already correct) |
| Rate limiting bounded | **Done** (now enforced on the live path) |
| Tenant isolation enforced | **Improved** — escalation check added; no RLS (J6) |
| Alert lookback semantics real | **NOT DONE** (J4) |
| Aggregation configuration real or removed | **NOT DONE** (J4) |
| Inactivity rules detect true silence | **NOT DONE** (J5) |
| Stale rollups cannot silently produce decisions | **Done** |
| Auto-resolve works or is removed | **Done** (implemented, §F6) |
| `isRequired` works or is removed | **Done** (implemented) |
| Effective rules testable | **NOT DONE** (J8) |
| Rule revision semantics explicit | **NOT DONE** (J7) |
| Queues bounded | **Pre-existing** (pg-boss + batch sizes); not re-verified |
| Hot path avoids expensive work | **Improved** — see §G |
| DB queries optimized on evidence | **Partial** — statement count reduced; no index changes made (none justified by evidence) |
| Structured observability exists | **Done** |
| Failure-injection tests pass | **NOT DONE** (J9) |
| Concurrency tests pass | **Done** (13 tests) |
| Migration tests prove V1 is gone | **Done** |

**Summary:** the V1→V2 migration, the reliability/concurrency core, circuit-breaker unification, observability, `isRequired`, rollup staleness protection, and auto-resolve are complete and verified with zero regressions against a measured baseline (56 pre-existing failures before and after; +75 new passing tests).

Five items remain open — **J4 (lookback/aggregation are still decorative)** is the largest remaining correctness gap and needs the architectural decision in §16/§17; then J5 (absence detection), J7 (revision semantics, must ship paired with the fingerprint), J8 (effective-rule test API), and J6 (RLS defence-in-depth). Two operational prerequisites also remain: **J1 (fingerprint migration for in-flight alerts — required before this deploys to production)** and **J9 (no real-Postgres or failure-injection runs)**. Each is documented above with the specific reason it was not attempted rather than being silently skipped.

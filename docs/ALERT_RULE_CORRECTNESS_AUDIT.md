# Alert Rule System — Correctness & Verification Audit

**Scope:** Read-only audit. No code was modified as part of this document.
**Question this audit answers:** *When the evaluator says an alert rule matched, does the implemented check actually prove the configured rule condition is true?*
**Audited path:** `src/modules/alerting/**`, `src/modules/connectors/**`, `src/modules/analytics-engine/**` (rollup producer), `src/modules/alerting/runtime/telemetry-outbox-relay.ts`, related migrations under `src/db/postgres/primary_db_draft/09_alerting/`.

All file:line references below were confirmed by direct file reads unless explicitly marked "per sub-agent trace, not independently re-opened."

---

## 1. System Map — What Actually Exists

### 1.1 The two evaluation tiers

The system is **not** one alert engine — it's two structurally different pipelines that converge on one shared condition-matching function.

**Fast tier (event-driven, sub-second)**
```
telemetry write (ingestion)
  -> telemetry_outbox row (same DB transaction as the ingestion write)
  -> TelemetryOutboxRelay.run() claims rows: FOR UPDATE SKIP LOCKED
     (src/modules/alerting/runtime/telemetry-outbox-relay.ts:94-118)
  -> pg-boss job "alert.evaluate.fast" per (org, project, environment)
  -> AlertRuntimeEngines.evaluateFast()  (src/modules/alerting/runtime/engines.ts)
  -> per-event payload built in-memory (fastPayload())
  -> evaluateCandidate() -> evaluateRule()/evaluateCondition() (evaluator.ts)
```
Also triggered directly by `alert.error-group-regressed` (synthetic error event, bypasses the outbox).

**Window / Operational / AI tiers (cron-polled, pre-aggregated)**
```
setInterval timers (queue.ts:299-306): window=5s, operational=30s, ai=300s
  -> per-org pg-boss job "alert.evaluate.window|operational|ai"
  -> AlertRuntimeEngines.evaluateTier()  (engines.ts:212-259)
  -> loadWindowScopes/loadOperationalScopes/loadAiScopes: plain SELECT
     against pre-aggregated rollup tables (request_metrics_1m, cron_metrics_1m,
     ai_metrics_1m, runtime_metrics_1m, log_metrics_1m, service_metrics_1m,
     endpoint_metrics_1m, metric_series_1m, ai_metrics_1h)
  -> evaluateCandidate() -> evaluateRule()/evaluateCondition() (SAME function as fast tier)
```
The actual aggregation (COUNT, AVG, PERCENTILE_CONT, GROUPING SETS) happens **upstream and independently**, inside `src/modules/analytics-engine/workers/*.worker.ts`, driven by its own watermark-based scheduler. Alerting never issues an aggregation query of its own — it only reads whatever row the rollup worker last wrote.

### 1.2 Rule storage

Postgres tables (`src/db/postgres/primary_db_draft/09_alerting/`):
- `alert_rules` — rule header (severity, cooldown, dedup window, evaluation interval, `evaluation_category` in `('fast','analytics')`, `current_revision`).
- `alert_rule_conditions` — one row per condition: `field_path`, `operator` (Postgres enum `alert_condition_operator`), `threshold_value jsonb`, `condition_group_id`, `is_required`, `aggregate_function varchar(50)` (no DB enum), `lookback_minutes`.
- `alert_rule_actions` — notify/webhook/suppress/escalate/group, `connector_id`/`route_id` (FK'd), `template_id`/`escalation_policy_id` (**not** FK'd).
- `alert_rule_bindings` — scope-inheritance overrides (org/project/environment/service/endpoint), `threshold_overrides jsonb`.
- Legacy `project_alert_thresholds` — pre-binding threshold model, still read and translated via `OPERATOR_MAP`/`THRESHOLD_PRESET_MAP` in `policy/resolve-threshold.ts`.

### 1.3 Rule catalog documented in `docs/alert-rules-catalog.md`

That catalog lists ~35 preset rules (10 fast-tier `eq:true` boolean signals, ~25 analytics-tier threshold/aggregate rules) plus templates and project-level operational thresholds. This audit evaluates the **mechanism** that executes any of those rules, since all of them funnel through the same evaluator.

---

## 2. The Core Evaluation Mechanism

### 2.1 Field resolution — `readPath()` (`src/modules/alerting/evaluator.ts:38-79`)

```ts
export function readPath(obj: unknown, path: string): unknown {
  ...
  for (const rawSeg of path.split('.')) {
    // exact key -> camelCase<->snake_case fallback -> case-insensitive fallback
  }
  // If the resolved leaf is an object, unwrap using a fixed priority order:
  if (typeof objRec.p95 === 'number') return objRec.p95;
  if (typeof objRec.value === 'number') return objRec.value;
  if (typeof objRec.ms === 'number') return objRec.ms;
  if (typeof objRec.avg === 'number') return objRec.avg;
  if (typeof objRec.p99 === 'number') return objRec.p99;
  if (typeof objRec.count === 'number') return objRec.count;
  if (typeof objRec.rate === 'number') return objRec.rate;
  if (typeof objRec.pct === 'number') return objRec.pct;
}
```
**Finding:** this is a **synonym-resolution layer**, not a strict schema lookup. `requests.latency.p95`, `duration_ms`, `latency.value` can all resolve to the exact same underlying rollup column because the payload builders (`loadWindowScopes`, `engines.ts` ~594-622) deliberately construct nested objects containing multiple alias keys (`p95`, `value`, `ms`, `avg`) pointing at the same number. If a rule author picks a field path that lands on an object containing several of these alias keys, the **fixed priority order** (p95 before avg before count) decides which underlying statistic actually gets compared — silently, with no indication to the rule author which one won.

### 2.2 Operator application — `evaluateCondition()` (`evaluator.ts:104-131`)

```ts
switch (operator) {
  case 'exists': return actual !== undefined && actual !== null;
  case 'eq':  return actual === expected || String(actual) === String(expected);
  case 'neq': return !(actual === expected || String(actual) === String(expected));
  case 'gt': case 'lt': case 'gte': case 'lte': {
    const a = toNumber(actual); const e = toNumber(expected);
    if (a === null || e === null) return false;   // fails closed
    ...
  }
  case 'contains': ...
  case 'in': return Array.isArray(expected) && expected.map(String).includes(String(actual));
  case 'regex': try { return typeof actual === 'string' && new RegExp(String(expected)).test(actual); } catch { return false; }
  default: return false;                            // fails closed
}
```
Verified directly (`evaluator.ts`). **No inverted comparisons, no hardcoded `true`, unknown operators fail closed.** This is the one part of the system that is straightforwardly correct in isolation — provided the `actual` value handed to it is trustworthy (see §2.1 and §2.4 for where that assumption breaks down).

### 2.3 AND/OR condition combination — `evaluateRule()` (`evaluator.ts:139-172`)

```ts
// Conditions sharing conditionGroupId are OR'd; groups + ungrouped conditions are AND'd.
const groupTruths = [...groups.values()].map((arr) => arr.some(Boolean));
const allTerms = [...groupTruths, ...ungrouped];
const matched = allTerms.length > 0 && allTerms.every(Boolean);
```
**FINDING (spec/implementation mismatch):** the module docstring (`evaluator.ts:9-11`) claims: *"A condition marked `isRequired=false` that fails does not fail the group unless it is the only condition contributing to its group's truth."* This is **not implemented anywhere in the function** — `isRequired` is read into `EvaluableCondition` (`engines.ts:250`, `isRequired: condition.is_required`) but never referenced inside `evaluateRule`/`evaluateCondition`. Every condition currently behaves as `isRequired=true` regardless of what's stored in `alert_rule_conditions.is_required`. Any rule author who set `is_required: false` expecting a "soft"/optional condition is silently getting hard-AND semantics instead.

### 2.4 The "does evaluation prove the rule" gate — `evaluateCandidate()` (`engines.ts:243-...`, verified directly)

```ts
const hasRelevantMetrics = evaluable.some((c) => {
  if (c.operator === 'exists') return true;
  const val = readPath(payload.values, c.fieldPath);
  return val !== undefined && val !== null;
});
if (!hasRelevantMetrics) return;   // silently skip, no counter incremented
```
This guard only requires **any one** condition's field path to resolve — for a multi-condition AND rule, the rule can proceed to full evaluation even when most of its conditions have zero data in the current payload. It does not by itself cause a false match (each unresolved condition still independently evaluates to `false` via `toNumber(actual)===null` or `actual===undefined`), but it means a rule can be logged/counted as "evaluated" while most of its inputs are absent, and the `summary.skipped` counter under-reports true no-data situations.

**Aggregation gap not visible to the evaluator:** the "aggregate_function" column on `alert_rule_conditions` (`avg`,`sum`,`count`,`max`,`min`,`p99`) is **never read by any evaluation code**. Confirmed: `src/modules/alerting/evaluation/metric-registry.ts` implements a generic in-memory aggregator (`evaluateMetric`, rate/percentage/moving_average/count/ratio/p50/p95/p99) but has **zero import references** anywhere in `engines.ts`, `queue.ts`, or `rule-catalog.ts` — confirmed by direct read of the file and by grep across `src/`. It is dead code, exercised only by its own unit test. This means: **the `aggregate_function` and `lookback_minutes` fields stored per-condition are pure configuration metadata that flow through the system unevaluated.** The real aggregation always happens far upstream, in the analytics-engine rollup workers, over a fixed 1-minute (or 1-hour, for `ai_metrics_1h`) bucket — never over the `lookback_minutes` value a rule author actually configured. A rule author who sets `lookback_minutes: 15` gets a comparison against a 1-minute rollup bucket, not a genuine 15-minute aggregate. The "Lookback Window" column values in `docs/alert-rules-catalog.md` (e.g. "15 min", "60 min") describe how far back the SELECT looks for *candidate rollup rows to iterate*, not the aggregation window baked into each value being compared.

---

## 3. Rule Semantics vs Actual Check — Per Rule Type

Because every documented rule (fast or analytics) executes through the identical `evaluateRule`/`evaluateCondition` pair, correctness is dominated by **three shared mechanisms** rather than by 35 independent rule implementations. The per-rule-type table below groups the catalog by mechanism and states the verdict for each mechanism, then flags any type-specific deviation.

| Rule category (from `alert-rules-catalog.md`) | Intended semantics | Actual check | Verdict | Why |
|---|---|---|---|---|
| **Fast boolean signals** (`unhandled_exception_fast`, `fatal_exception_fast`, `process_crash_fast`, `out_of_memory_fast`, `cron_failed_fast`, `security_event_fast`, `auth_failure_fast`, `heartbeat_lost_fast`, `deployment_failed_fast`, `connector_open_circuit_fast`) | Any single telemetry event flagged with the given boolean field should fire (operator `eq`, value `true`) | `evaluateCondition('eq', actual, true)` on the raw event payload, evaluated per-event as soon as the outbox relay publishes it | **PASS** (mechanism), **PARTIAL** (system) | The `eq`/`true` check itself is correct and directly proves the condition. But firing is gated by cooldown/consecutive-breach/dedup logic that has real races (§5) — a true condition can be correctly detected yet still be dropped, duplicated, or delayed by those downstream gates. |
| **Rate/percentage threshold rules** (`high_error_rate`, `elevated_5xx`, `availability_degradation`, `cron_failure_rate`, `ai_failure_rate`) | `metric.rate >= X%` computed over the configured lookback window | `gte` comparison against a rollup-table `CASE WHEN total_count>0 THEN 100.0*num/total_count ELSE NULL END` column, computed over a **fixed 1-minute bucket**, not the rule's configured lookback | **PARTIAL** | The comparison operator and null-handling (`ELSE NULL`, never divides by zero) are correct. But the window is NOT the one configured on the rule — `lookback_minutes` is stored and displayed but not applied; only the rollup worker's fixed bucket size governs the real aggregation window. A rule documented as "5 min window" is actually evaluated against however the underlying rollup bucket is sized (1 minute), re-checked on every tick within the coarse lookback SELECT range. |
| **Absolute count threshold rules** (`error_volume_spike`, `log_error_burst`, `failed_cron`, `queue_backlog`, `db_connection_errors`) | `count >= N` in the window | `gte` against a rollup `count`/`filterCount` column | **PASS** (mechanism) for the comparison itself; **PARTIAL** for window fidelity — same fixed-bucket caveat as above. |
| **Percentile latency rules** (`high_latency_p95`, `high_latency_p99`, `ai_slow_requests_p95`) | `p95/p99 latency >= X ms` | `gte` against `PERCENTILE_CONT` columns computed by the analytics-engine rollup worker (`AGG.percentile`, `analytics-engine/workers/base.ts:374-383`) | **PASS** | This is the one aggregate type that genuinely is computed with a real percentile algorithm upstream, and the field-path resolution (`readPath`) correctly lands on the right numeric column for the documented preset keys. Caveat: subject to the same rollup-staleness risk as all window-tier rules (§5.1). |
| **Inactivity / absence rules** (`service_inactivity`, `request_inactivity`) | `count < 1` (no requests observed) → should fire | `lt` comparison, BUT: if truly zero events occurred, the rollup worker never writes a row for that bucket at all, and `loadWindowScopes`'s SELECT returns **no row** for that scope | **FAIL** | This is a genuine false-negative bug class: "less than 1" / "zero activity" is exactly the condition that produces **no data to evaluate against**, and the engine's design is "no row = rule not evaluated" (§2.4), not "no row = value is 0." A service_inactivity rule intended to detect total silence will never fire from true silence in a bucket that has no rollup row at all — it can only fire if some other correlated signal produces a partial row with `total_count=0` explicitly written. Whether the rollup worker ever writes an explicit zero-row for empty buckets was not confirmed in this audit and should be verified before trusting this rule class. |
| **Log-pattern rules** (`out_of_memory_logs`, `database_connection_logs`, `cache_error_logs`, `auth_failure_spike`, `webhook_delivery_failures`) | `logs.matches contains 'substring'` | `contains` operator — `actual.includes(String(expected))` for strings, or array membership for arrays | **PASS** (mechanism) | Straightforward substring/array match; no wrong-field or inversion risk found. Depends on the upstream log-matching pipeline populating `logs.matches` correctly (not audited here — outside the rule-evaluation boundary). |
| **CPU/Memory/Disk average rules** (`high_cpu_usage`, `high_memory_usage`, `disk_usage_high`, `queue_lag_high`) | `avg(metric) >= X%` over window | `gte` against a rollup `avg()` column (`AGG.avg`) | **PASS** (mechanism), same fixed-bucket window caveat as other window-tier rules. |
| **AI cost/credit rules** (`ai_credit_burn_spike`, `ai_cost_spike`, `ai_token_volume_spike`) | `sum(cost/credits/tokens) >= X` over 60 min | `gte` against `ai_metrics_1h` rollup — this is the one rule family that reads from an **hourly** rollup table rather than the 1-minute tables | **PASS** (mechanism) | Verified in the fast/window trace that `ai_metrics_1h` is a distinct table from the 1-minute set, so this rule family's window genuinely is closer to what's documented (60 min) than the 1-minute-bucket rules above, though it's still the rollup's fixed hourly bucket, not a rolling 60-minute window. |
| **Legacy project threshold rules** (`project_alert_thresholds` / `latency_p50`..`latency_p99`, `apdex`, `event_volume_spike/drop`) | Same comparison semantics, legacy `>`,`>=`,`<`,`<=`,`=`,`!=` operators | Mapped via `OPERATOR_MAP` (`resolve-threshold.ts:88-95`) into the same condition-operator set, then evaluated identically | **PARTIAL** | Mapping is correct for the 6 legacy operators it knows about, but `mapComparisonOperator` returns `null` for anything outside that 6-item map, silently producing a binding with `operator: null` rather than raising an error — a malformed/unexpected legacy operator value degrades to a rule that can never usefully evaluate, with no surfaced warning found in the reviewed code path. |

**Cross-cutting mechanism verdicts (apply to every rule type above):**

| Mechanism | Verdict | Evidence |
|---|---|---|
| Comparison operator correctness (`gt/lt/gte/lte/eq/neq/contains/in/regex/exists`) | **PASS** | `evaluator.ts:104-131`, direct switch statement, no inversion, fails closed on unknown operator/non-numeric input. |
| AND/OR condition-group combination | **PASS** for the AND/OR logic itself; **FAIL** for `isRequired=false` (dead code) | `evaluator.ts:139-172`. |
| Aggregate function (`avg/sum/count/max/min/p99`) honoring the value stored per-condition | **FAIL** | Confirmed dead: `metric-registry.ts` never imported into the live path. Real aggregation happens upstream, disconnected from the per-condition config. |
| `lookback_minutes` honored as the actual aggregation window | **FAIL** | The rollup bucket size is fixed by the analytics-engine worker (1m or 1h), not parameterized by the rule's `lookback_minutes`. |
| Null/missing value handling | **PARTIAL** | Rate-style rollup columns correctly emit `NULL` (not `0`) on zero denominator; but a bucket with literally zero events produces **no row at all**, causing the rule to be silently skipped rather than evaluated against an explicit "0" — wrong for "absence" rule types (`service_inactivity`, `request_inactivity`). |
| Tenant/project/environment scoping of the data read | **PASS** | Every rollup/rule query seen in this audit includes `organization_id = $N` in its WHERE clause; project/environment/service/endpoint scoping is enforced in `bindingMatchesScope`/`resolveRulesForScope` (`policy/resolve-rule.ts`). |

---

## 4. Rule Resolution — Configured vs Effective (Where Semantics Can Silently Change)

`resolveEffectiveRule()` (`src/modules/alerting/policy/resolve-rule.ts:180-283`) implements scope-inheritance (ADR-0004): a rule's own row is the baseline, and matching `alert_rule_bindings` rows (org → project → environment → service → endpoint, deepest wins) can override `enabled`, `severity`, `cooldownSeconds`, `deduplicationWindowSeconds`, `evaluationIntervalSeconds`, `autoResolveAfterMinutes`, `consecutiveBreaches`, and per-field `threshold_value` — all **without changing the base `alert_rules`/`alert_rule_conditions` rows**.

**FINDING — audit trail exists, but the visible API doesn't show it.** `GET /rules/:id` returns the raw rule + raw conditions (`rules.service.ts` `getRule()`/`ruleToDto()`) — it does **not** call `resolveEffectiveRule`. An operator inspecting a rule through the API sees configured values that may not match what actually fires in a given project/environment. The only endpoint that exercises evaluation logic is `POST /rules/:id/test`, and per the sub-agent trace of `rules.service.ts:250-259` that only runs `evaluateRule` against the raw stored conditions — **not the effective/bound ones** — so "testing" a rule does not validate what will really fire in a scoped context where bindings apply.

**FINDING — revision number does not track content changes.** `alert_rules.current_revision` is described (`rules.types.ts:150`) as the value used for effective-policy hashing/versioning, and it feeds directly into the alert fingerprint (`policyId = ${organization_id}:${rule.id}:${rule.current_revision}`, used both by `computeAlertFingerprint` and `alertFingerprint`/`decision.engine.ts:47-58`). But `RulesRepository.updateRule` **does not increment `current_revision`** on any field change (confirmed by sub-agent trace of the update SQL). Two consequences:
1. `AlertPolicyCache`'s 30-second TTL cache key includes `version` (defaulted to `1` by the caller, not derived from `current_revision`), so a rule update is not reliably reflected even after cache expiry if callers keep passing the stale default version.
2. Because the fingerprint depends on `current_revision`, and that value is effectively frozen post-creation in this code path, rule edits do **not** trigger the "new revision, new fingerprint, dedup-history reset" behavior that the fingerprint design implies — a partial mercy, since the alternative behavior (revision bump on every edit silently splitting alert history) is also flagged as undesirable below (§5.2).

**FINDING — cache invalidation gap on the policy engine.** `AlertPolicyCache` (`policy/policy.cache.ts`) has a 30s TTL and an `invalidateRule()` method, but no call site in `rules.service.ts` was found invoking it — the service only invalidates the separate `AlertRuntimeRuleCatalog` cache (60s TTL, used by the fast-tier catalog lookup, and that one IS correctly wired to every CRUD mutation). Per the sub-agent trace, `AlertPolicyEngine`/binding resolution is explicitly commented in `bindings.service.ts` as dormant ("nothing in the evaluation path calls this yet") — meaning this specific gap may not be live-exploitable yet, but the plumbing exists half-wired and should not be assumed safe if/when the binding-resolution path is switched on for the hot evaluation path.

**FINDING — no minimum-conditions guard.** `UpdateRuleSchema` is `CreateRuleSchema.partial()`; submitting `conditions: []` on a PATCH replaces all conditions with none (`rules.repository.ts` delete-then-reinsert pattern). A rule with zero conditions is not rejected — `evaluateRule` returns `matched: false` for `conditions.length === 0` (confirmed in `evaluator.ts:150-152`), so it fails safe (never fires), but it silently disarms a previously-working rule with no confirmation and no restore path other than re-adding conditions manually.

---

## 5. Trigger Correctness — Decision, Dedup, Cooldown, State, Notification

### 5.1 Two independently-computed fingerprints for the same logical alert

- `computeAlertFingerprint()` (`runtime/alert-fingerprint.ts`) — rich, `groupBy`-aware, used for the **Redis cooldown gate** (`AlertRedisStateService.acquireCooldown`).
- `alertFingerprint()` (`decision/decision.engine.ts:47-58`) — simpler, used for `alert_events_v2.fingerprint`, `dedup_key`, and `alert_event_state.alert_key` (the durable DB record).

Both are seeded from the same `policyId = org:ruleId:current_revision` and conceptually the same scope, but they hash **different input compositions** (one embeds a joined `dimensionKey` string, the other passes `service`/`endpoint`/`dimension` as separate raw fields — see `engines.ts` call into `decide()`, `normalizedDimensions.route ?? scope.endpoint`, vs `dimensionOverride`). They are two separately maintained code paths with no shared test enforcing agreement. If a rule's `groupBy` normalizes a route differently than `scope.endpoint` (e.g. `groupBy` excludes `route` while `scope.endpoint` is raw, unnormalized), the Redis cooldown key and the DB dedup key can diverge — the Redis gate can allow an evaluation through that the DB layer treats as a different (or the same) alert than intended.

**Verdict: FAIL** on the guarantee that "one logical alert occurrence maps to exactly one fingerprint end-to-end." Two independently maintained hash functions is a design smell that has already produced observable drift risk, confirmed by direct comparison of their input construction.

### 5.2 Cooldown is enforced by two layers that can disagree under failure

```ts
// engines.ts (evaluateCandidate) — verified directly
const dbCoolingDown = previous?.last_fired_at
  ? now.getTime() - previous.last_fired_at.getTime() < effective.cooldownSeconds * 1000
  : false;
...
let inCooldown = dbCoolingDown;
if (shouldFire && effective.cooldownSeconds > 0) {
  const cooldownResult = await this.redisState.acquireCooldown({...});
  if (!cooldownResult.acquired) inCooldown = true;
  else if (cooldownResult.fallback) inCooldown = dbCoolingDown;  // Redis down -> fall back
  else inCooldown = false;
}
```
- `alert_rule_eval_state` (`last_fired_at`, `consecutive_breaches`) is read via a plain unlocked `SELECT` and later written via an unlocked `UPSERT` — **two separate round trips, no row lock spanning them, no atomic increment** (the client computes `consecutive + 1` and writes the absolute value rather than issuing `SET consecutive_breaches = consecutive_breaches + 1`).
- Redis's `SET key val EX ttl NX` **is** atomic and correctly serializes concurrent evaluations of the same key — as long as Redis is reachable.
- **When Redis is unavailable** (fail-open path returns `{ acquired: true, fallback: true }`), the code falls back to the unlocked `dbCoolingDown` check. Two concurrent evaluations (e.g. overlapping fast-tier batches, or fast + window tier evaluating overlapping scopes) can both read `last_fired_at` as stale/absent, both compute `inCooldown=false`, and both proceed to `appendDecision()`.
- The DB-level backstop against a literal duplicate row is `appendEvent()`'s idempotency key: `hash(alertKey:kind:observedAt.toISOString())`. This only collapses duplicates when `observedAt` is **identical** — and two separate evaluation ticks almost never share the exact same `observedAt` timestamp. **Conclusion: during a Redis outage, concurrent evaluation of the same scope can produce two distinct `alert_events_v2` "fired" rows and two sets of notification jobs for what should be one cooldown-gated occurrence.**

**Verdict: FAIL** (false-positive/duplicate-alert risk), specifically conditioned on Redis unavailability + true evaluation concurrency for the same scope. This is a real, reachable failure mode, not a theoretical one — the fast tier's outbox relay and the window/operational/ai cron timers can legitimately overlap for the same organization.

### 5.3 Consecutive-breach counter — lost-update risk, but fails safe

Same unlocked read-then-write pattern as cooldown. Two concurrent evaluations can both read `consecutive_breaches=N` and both write `N+1` (an under-count, since it should be `N+2`). This delays firing rather than causing a false fire — **fails in the safe direction** — but is still a correctness gap relative to the configured `consecutiveBreaches` requirement (a rule requiring "3 consecutive breaches" could, under sustained concurrency, take longer than 3 real breaches to fire, or in principle never accumulate correctly if evaluations are consistently paired).

### 5.4 Rule-edit fingerprint sensitivity

`policyId` embeds `current_revision`. Per §4, `current_revision` isn't actually bumped by `updateRule` in the reviewed code path — which incidentally avoids the worse failure mode (every edit splitting alert/dedup history), but this is accidental, not designed. If `current_revision` increment is added later (a very plausible near-term fix, since the field's whole purpose is to track edits), it will — unless `alertFingerprint`/`computeAlertFingerprint` are changed simultaneously — silently reset dedup continuity, `duplicate_count`, and cooldown history on every rule edit. **This must be treated as a linked pair of fixes, not two independent ones.**

### 5.5 State machine and resolution

`state-machine.ts`'s transition table includes an `evaluate_breach` transition (`healthy → pending`) that is **never invoked** by the live decision engine — `decision.engine.ts` only ever calls `trigger` or `recover`. The "pending" concept is entirely absorbed into `engines.ts`'s client-side `shouldFire` consecutive-breach gate, before `decide()` is ever called. Functionally this is consistent (the gate substitutes for the missing transition), but it means the persisted state machine cannot represent "N of M breaches accumulated, not yet firing" — that information lives only in `alert_rule_eval_state`, not in `alert_event_state`.

Recovery correctly requires a subsequent evaluation to return `matched: false` (verified in `engines.ts`: `if (!result.matched) { ...recoveredAt: previous?.is_breaching ? now : null }`) — it is not merely "no new evaluation occurred," which is the right behavior.

### 5.6 Auto-resolve is dead in both schemas

- **V2 path:** `alert_event_state.auto_resolve_at` is written by `decision.engine.ts` (`upsertState(... autoResolveAt: ...)`) whenever `policy.autoResolveAfterMinutes` is set, and an index (`idx_alert_event_state_autoresolve`) exists for a sweep to use it. **No code was found anywhere in `src/` that reads `auto_resolve_at` to force a resolution.** Confirmed via full-repo grep for `auto_resolve_at`/`autoResolveAt` sweep consumers — none exist outside the write path and test fixtures.
- **Legacy V1 path:** `EventsRepository.claimAutoResolvable()` exists (`src/modules/alerting/events/events.repository.ts`) with a real `SELECT ... FOR UPDATE SKIP LOCKED`-style claim query, but it has **zero call sites** anywhere in `src/` (confirmed via grep — the only references are in `dist/` compiled artifacts, a `scratch/` migration helper script, and its type declaration). The worker/cron job that was presumably meant to call it does not exist in the current codebase.

**Verdict: FAIL.** `autoResolveAfterMinutes` is a fully configurable, validated (`rules.types.ts:66`, `1..20160` minutes), documented field that **has no effect on system behavior** in either alert schema. An operator who configures a rule to auto-resolve after N minutes of no further breaches will see the alert remain open indefinitely unless a real re-evaluation explicitly recovers it. This is a silent, currently-shipped functionality gap, not merely a theoretical risk.

### 5.7 Idempotency for alert creation and notification — genuinely solid where it applies

- `appendEvent()` uses a CTE reservation against `alert_runtime_idempotency_keys` (PK `(namespace, organization_id, idempotency_key)`, **not partitioned**), which is explicitly documented in migration `007_alert_runtime_idempotency_enforcement.up.sql` as the real uniqueness authority — because `alert_events_v2` itself is partitioned by `created_at`, so its own unique index cannot guarantee cross-partition uniqueness. This design correctly compensates for that partitioning limitation.
- `incrementDuplicate()` does a true atomic `UPDATE ... SET duplicate_count = duplicate_count + 1` on genuine idempotency-key replay — correct, and does not create a duplicate notification.
- `insertNotificationJobs()`/`recordNotificationDelivery()`/`claimDueNotificationJobs()` use the same CTE-reservation pattern plus `pg_advisory_xact_lock` plus `FOR UPDATE SKIP LOCKED` — correct exactly-once and no-double-dispatch guarantees **for the retry/duplicate-callback case**.
- **The gap is not in this machinery — it's that the machinery only catches duplicates sharing an identical `observedAt`.** It does not, and cannot, catch the "two concurrent evaluations, two different `observedAt` values, same real-world condition" case described in §5.2. This is the single most important nuance in this whole audit: the system's idempotency design is correct for retries of the same decision, but not for two independent decisions about the same underlying condition made concurrently under cooldown-gate failure.

---

## 6. Security and Tenant Isolation

| Check | Result | Evidence |
|---|---|---|
| Every telemetry/rollup read during evaluation is org-scoped | **PASS** | Every SELECT reviewed in `engines.ts` (`loadWindowScopes`, `loadOperationalScopes`, `loadAiScopes`) includes `WHERE organization_id = $1`. |
| Rule lookups scoped to tenant for direct API paths | **PASS** | `RulesRepository.findRuleById`/`updateRule`/`softDeleteRule`/`setRuleEnabled` all include `organization_id` in WHERE. |
| Internal bulk-loader paths tenant-scoped | **PARTIAL** | `getRuleConditions(ruleId)`, `getRuleActions(ruleId)`, `getRuleActionsByRuleIds(ruleIds)`, `ConnectorRepository.getByIds(ids)`, `findByIdInternal(id)` all skip the org filter by design, documented in-code as "callers must have already validated tenant ownership." No RLS backstop exists — isolation here is an **application-level invariant**, not DB-enforced. A bug anywhere upstream that collects the wrong set of ids (e.g. a bad JOIN, or reused/predictable UUIDs) has no second line of defense. |
| SQL injection via user-controlled rule fields (`field_path`, `threshold_value`, `operator`) | **PASS (no injection found)** | All condition fields are written via parameterized `UNNEST` arrays with Postgres enum casts (`::alert_condition_operator`); `field_path` is only ever used as an in-memory JS object key at evaluation time, never concatenated into SQL. `listRules` search filter is correctly parameterized. |
| Connector dispatch re-verifies tenant ownership before sending | **PARTIAL** | The `connector.v2.<provider>` transport-queue worker (`connectors/queue.ts:374-383`) does a defensive double-check (`row.organization_id !== job.data.organizationId` → skip). The provider-queue **batch** path and the escalation-sweep path use the non-org-scoped `getByIds` and do **not** re-check `organization_id` at dispatch time — they trust that the `connectorId` embedded in the rule action/escalation step was already validated as belonging to that org when the association was created. |
| Rule evaluation project/environment/service/endpoint scoping | **PASS** | `bindingMatchesScope()` and `AlertCatalogSnapshot.resolveRulesForScope()` enforce exact/null-wildcard matching per dimension; org-level rules explicitly do not apply to a project scope unless a binding subscribes it (`requireProjectSubscription` gate). |

**Overall isolation verdict:** no confirmed cross-tenant data leak path or SQL injection vector was found. The residual risk is architectural: several internal repository methods deliberately forgo tenant filtering and rely on upstream correctness, with no database-level (RLS) enforcement as a second line of defense. This is a design choice that should be documented as an explicit accepted risk, or hardened with RLS if the threat model requires defense-in-depth against application bugs.

---

## 7. Ingestion Coupling — Will Alerting Changes Affect Ingestion?

**Short answer: changing alert *evaluation logic* cannot corrupt ingestion writes or block ingestion throughput directly, but it can create indirect, real degradation through a shared table and a shared connection pool.**

- **No synchronous call path.** Ingestion's write function (`writeBatchDetailedWithOutbox`) inserts the typed telemetry row and a `telemetry_outbox` row **in the same transaction**, then commits — it never calls into any alerting module function and never waits for alerting to consume the row. The coupling is purely: shared table + async pg-boss dispatch picked up later by a separate relay worker.
- **Locking is already defended.** The relay's claim query uses `FOR UPDATE SKIP LOCKED` (`telemetry-outbox-relay.ts:94-116`), so it cannot block on rows ingestion is currently inserting — it simply skips locked rows and retries on the next poll (default every ~10s, batch size 250, capped at 1000).
- **Real risk #1 — table bloat.** If alert-evaluation logic changes make the relay/evaluator slower (e.g. adding a heavier per-row check before `markPublished`), unprocessed `telemetry_outbox` rows accumulate (`published_at IS NULL`). This doesn't block new ingestion INSERTs, but over time increases table size/autovacuum pressure on a table ingestion also writes into every batch — a slow, indirect tax on ingestion write latency if left unbounded.
- **Real risk #2 — connection-pool contention.** The background-worker process passes `logDB.getPrimaryPool()` into `registerAlertingWorkers` (confirmed in `src/shared/workers/main.ts`), which is the **same shared Log DB primary pool** used elsewhere for Log DB reads. Ingestion's own writes use a **separate, dedicated write pool** (`createTelemetryWritePool()`), so ingestion writes are already isolated from this. But if alert-evaluation code is changed to hold a checked-out connection/transaction open for longer (e.g. a long-running query added inside `evaluateCandidate` or the decision engine's transaction), it consumes a slot from the shared Log DB pool, which can starve other Log DB **reads** (including, notably, anything in the ingestion worker process that also reads from Log DB via the shared pool rather than its dedicated write pool). It does not touch ingestion's write pool directly.
- **A previously-real, now-fixed bug is documented directly in the code as a warning.** `src/shared/workers/main.ts` contains an explicit comment (paraphrased): evaluators must read telemetry through the same pool ingestion writes through, or telemetry-driven alerts silently never fire — this was a real production issue, fixed by explicit pool injection. The **silent fallback default remains** in `alerting/queue.ts:117` (`const runtimePool = telemetryPool ?? pool;`): any future bootstrap path that forgets to pass `telemetryPool` explicitly will reintroduce this exact bug (alerts silently never firing, not a crash) with no warning surfaced anywhere. This is a latent regression trap independent of any evaluation-logic change, and should be flagged to whoever maintains worker bootstrap wiring.

**Conclusion: updating alert rule evaluation logic (operators, aggregation, window handling, dedup, etc.) is safe with respect to ingestion correctness and, in normal operation, safe with respect to ingestion throughput — provided any new evaluation code avoids (a) making the outbox relay dramatically slower without adjusting its poll/claim tuning, and (b) holding long-lived transactions against the shared Log DB primary pool.** Neither risk is hypothetical scaremongering — both are direct, structural consequences of the existing shared-table/shared-pool design, not new risks introduced by hypothetical future changes.

---

## 8. Boundary / Edge-Case Truth Tables

### 8.1 Numeric threshold operators (`gt`/`gte`/`lt`/`lte`) — `evaluator.ts:112-121`

| Input | Operator | Expected | Actual (code) | Correct? |
|---|---|---|---|---|
| value = threshold | `gte` | true | `a >= e` → true | ✅ |
| value = threshold | `gt` | false | `a > e` → false | ✅ |
| value just below threshold | `gte` | false | false | ✅ |
| value just above threshold | `gte` | true | true | ✅ |
| value = 0, threshold = 0 | `gte` | true | true | ✅ |
| value = -5, threshold = 0 | `lt` | true | true | ✅ (negative numbers pass through `toNumber` unchanged) |
| value = `null` (missing rollup row / no bucket) | `gte`/`gt`/`lt`/`lte` | Rule-dependent — should be treated as "no data," ideally not silently "false forever" | `toNumber(null) === null` → `return false` (never matches) — but the RULE ITSELF may never even be evaluated (see §3, absence rules) | ⚠️ **Correct at the function level (fails closed), wrong at the system level for "absence" rule types** where no row means the rule is skipped entirely, not evaluated-and-failed |
| value = non-numeric string ("N/A") | `gte` | Should not match, should not throw | `toNumber("N/A") === null` → false | ✅ |
| value = numeric string ("42") | `gte` | Should coerce and match like a number | `toNumber("42") === 42` → real comparison | ✅ |
| duplicate identical events in same evaluation tick | any | Should not double-count for a scalar per-event rule | Fast tier evaluates per-event as each outbox row is claimed; two literal duplicate telemetry events produce two separate `evaluateCandidate` calls, each independently gated by cooldown/consecutive-breach — not "double-counted" within one evaluation, but each is a distinct evaluation opportunity | ✅ for scalar boolean rules; **N/A** for aggregate rules since aggregation happens upstream in the rollup worker, outside this evaluator's control |

### 8.2 `eq`/`neq` — `evaluator.ts:107-110`

| Input | Operator | Expected | Actual | Correct? |
|---|---|---|---|---|
| `actual=true, expected=true` | `eq` | true | `true===true` → true | ✅ |
| `actual="true", expected=true` | `eq` | true (loose match intended for boolean-as-string telemetry) | `String("true")===String(true)` → `"true"==="true"` → true | ✅ (deliberate loose fallback) |
| `actual=undefined, expected=true` | `eq` | false | `undefined===true` false; `String(undefined)==="undefined"` vs `"true"` → false | ✅ |
| `actual=false, expected=true` | `neq` | true | `!(false===true \|\| "false"==="true")` → true | ✅ |

### 8.3 `exists` — `evaluator.ts:105-106`

| Input | Expected | Actual | Correct? |
|---|---|---|---|
| field present, value=0 | true (0 is a defined value) | `0 !== undefined && 0 !== null` → true | ✅ |
| field present, value=`""` | true | `"" !== undefined && "" !== null` → true | ✅ |
| field absent entirely | false | `undefined !== undefined` → false | ✅ |
| field present, value=`null` explicitly | false | `null !== null` → false | ✅ |

### 8.4 Time-window boundary (rollup bucketing, per `analytics-engine/windows.ts` + `engines.ts` per sub-agent trace)

| Scenario | Expected | Actual | Correct? |
|---|---|---|---|
| Event exactly at bucket lower boundary | Included in that bucket (`date_trunc` inclusive lower bound) | `buildBucketRecomputeSql` uses `>= lo AND < hi` | ✅ |
| Event exactly at bucket upper boundary | Excluded from that bucket, included in next | Exclusive upper bound (`< hi`) | ✅ |
| Rollup row that is 4+ minutes stale (rollup worker delayed) | Should ideally be flagged as stale / not used for firing, or at minimum bounded | `loadWindowScopes` uses `bucket >= NOW() - INTERVAL '5 minutes'` with no upper-bound freshness check beyond that coarse lookback — a 4-minute-old row within that 5-minute lookback is evaluated exactly as if it were fresh | ❌ **No staleness detection** — this is a real gap, not just an edge case |
| Bucket with zero events (true silence) | Should be evaluable as "0" for count-based/absence rules | No row is written/read for that bucket at all → rule is skipped, not evaluated as 0 | ❌ for absence-style rules (§3) |

### 8.5 Cooldown / dedup boundary (per verified `engines.ts` code + sub-agent trace)

| Scenario | Expected | Actual | Correct? |
|---|---|---|---|
| `now - last_fired_at == cooldownSeconds` exactly | Cooldown expired (boundary should allow firing, or documented otherwise) | `now - last_fired_at < cooldownSeconds*1000` — strict `<`, so exact equality means **not** cooling down, firing is allowed | ✅ (consistent, though the "inclusive/exclusive" choice is not documented anywhere as an explicit design decision) |
| `now - last_fired_at == cooldownSeconds - 1ms` | Still cooling down | `< cooldownSeconds*1000` → true → cooling down | ✅ |
| Redis up, two concurrent evaluations, same alert key | Exactly one should acquire the gate | `SET NX EX` — atomic, exactly one wins | ✅ |
| Redis down, two concurrent evaluations, same alert key | Should still behave as if exactly one acquired (fail-safe) | Both fall back to unlocked DB read, both can pass, both call `decide()` with different `observedAt` → idempotency key differs → **both persist as separate fired events** | ❌ **Confirmed false-positive/duplicate-alert path** |
| Consecutive breaches: rule requires 3, breach occurs 3 times sequentially, no concurrency | Fires on the 3rd | `consecutive = previous.consecutive_breaches + 1`, `shouldFire = consecutive >= 3` — correct sequential accumulation | ✅ |
| Consecutive breaches under concurrency (2 evaluations of same scope racing) | Should still correctly reach 3 after 3 real breaches | Lost-update risk: both reads can see the same `N`, both write `N+1` → undercount, delays firing | ⚠️ **Fails safe (delay) but is not correct** |

---

## 9. System-Level Problems (Architectural)

1. **Dual fingerprint functions for one logical alert** (§5.1) — structurally separate hash inputs for the Redis cooldown key vs. the DB dedup key, correlated today by convention, not guaranteed by shared code or a test.
2. **Cooldown/consecutive-breach state uses unlocked read-then-write** (§5.2, §5.3) — no `FOR UPDATE`, no atomic increment; correctness depends entirely on Redis being up, with no compensating lock at the DB layer when Redis fails.
3. **Aggregate function and lookback_minutes are configuration-only, never executed** (§2.4, §3) — real aggregation window is whatever the analytics-engine rollup bucket size is (1 minute or 1 hour), decoupled from what the rule author configured on the condition.
4. **"Absence" rules (zero-activity detection) cannot fire from true silence** (§3, §8.4) — a bucket with zero events produces no row, and no row means the rule is skipped, not evaluated-and-failed. This directly undermines `service_inactivity` and `request_inactivity` rules, and any future rule intended to catch "nothing happened."
5. **No rollup-staleness detection** (§8.4) — a stale rollup row within the lookback window is evaluated identically to a fresh one; a delayed analytics-engine worker can cause alerts to fire (or fail to fire) based on data that is several minutes old, with no signal to operators that staleness occurred.
6. **Auto-resolve is entirely dead code in both alert schemas** (§5.6) — a documented, validated, UI-exposed field (`autoResolveAfterMinutes`) has no runtime effect.
7. **`isRequired=false` condition semantics are documented but not implemented** (§2.3) — every condition behaves as required regardless of configuration.
8. **`current_revision` is not incremented on rule update**, and the alert fingerprint depends on it (§4, §5.4) — currently avoids one failure mode by accident, but is a landmine for whoever fixes the revision-tracking bug independently of the fingerprint design.
9. **Policy-effective cache (`AlertPolicyCache`) has no wired invalidation from rule CRUD** (§4) — currently low-risk only because that code path is not yet on the hot evaluation path; will become a real staleness bug the moment it is switched on, unless invalidation is wired at the same time.
10. **Silent pool-fallback footgun**: `runtimePool = telemetryPool ?? pool` (§7) — a documented-in-code historical bug (evaluators reading the wrong pool, causing alerts to silently never fire) has its root cause (the silent fallback) still present, just currently not triggered because the correct pool happens to be passed explicitly today.
11. **Verbose `console.log` statements throughout `engines.ts` and `decision.engine.ts`** (confirmed directly in both files, e.g. `[ALERTING] [Phase 2/4: Candidate Evaluation]...`) — not a correctness bug, but a production-hygiene issue: these run on every single candidate evaluation across all tiers and should go through the structured logger (`this.log`) with appropriate levels, not unconditional `console.log`/`console.error`, especially at fast-tier per-event volume.
12. **Internal repository methods that skip tenant scoping by design** (§6) — no RLS backstop; isolation is an application-level invariant across `getRuleConditions`, `getRuleActions`, `getRuleActionsByRuleIds`, `ConnectorRepository.getByIds`, `findByIdInternal`.

---

## 10. Final Verdict

### 10.1 Correctly verified
- The core comparison operators (`gt/gte/lt/lte/eq/neq/exists/contains/in/regex`) are implemented correctly, fail closed on bad input, and were not found to have any inverted or hardcoded-true logic.
- AND/OR condition-group combination logic is correct (modulo the `isRequired` gap below).
- Tenant scoping on the primary, externally-reachable API and evaluation-query paths is correctly enforced by `organization_id` WHERE clauses.
- No SQL injection surface exists in the rule-condition read/write path.
- Alert-event and notification-job idempotency for **retry-of-the-same-decision** scenarios is genuinely solid (CTE-reservation pattern against a non-partitioned idempotency table, atomic duplicate-count increments, advisory locks on delivery status transitions).
- Percentile-based latency rules (`p95`/`p99`) and count/rate-style threshold rules are backed by real SQL aggregation upstream (via `analytics-engine`), and the null-handling for zero-denominator rate calculations is correct (`NULL`, never a silent `0`).
- Recovery correctly requires a subsequent evaluation to return `matched: false`, not merely the absence of a new evaluation.
- Ingestion write correctness is not put at risk by alerting; the coupling is asynchronous and lock-safe (`SKIP LOCKED`).

### 10.2 Incorrectly verified / failing
- **Absence/inactivity rules** (`service_inactivity`, `request_inactivity`) cannot detect true zero-activity because no rollup row exists to evaluate against — a documented rule type that structurally cannot fire under the exact condition it's meant to detect.
- **`autoResolveAfterMinutes`** has zero runtime effect in either alert schema (V1 or V2) — dead configuration.
- **`isRequired=false`** on conditions has zero runtime effect — dead configuration, contradicts the module's own documentation.
- **`aggregate_function`/`lookback_minutes`** per condition are not honored by any evaluation code — the real aggregation window is fixed by the upstream rollup worker, independent of what a rule author configures.

### 10.3 Only partially verified
- Rate/percentage/absolute-count threshold rules: the comparison mechanism is correct, but window fidelity (configured lookback vs. actual fixed rollup bucket) is not what's documented to users.
- Legacy `project_alert_thresholds` operator mapping: correct for the 6 known operators, silently degrades (`operator: null`) for anything else with no surfaced warning.
- Tenant isolation: correct at the SQL layer for all paths audited, but several internal bulk-loader methods deliberately skip org filtering and rely on upstream invariants with no RLS backstop.

### 10.4 Most dangerous false-positive path
**Redis outage + concurrent evaluation of the same alert scope** (§5.2, §8.5). This produces two independently-persisted "fired" events and two sets of dispatched notifications for a single real breach, because the DB-side idempotency key includes `observedAt`, which differs between the two racing evaluations. This is the single highest-severity finding in this audit: it is a genuine duplicate-alert / duplicate-notification bug, reachable in a realistic failure mode (Redis being temporarily unavailable is not an exotic scenario), not a contrived edge case.

### 10.5 Most dangerous false-negative path
**Absence/inactivity rules never firing from true silence** (§3, §8.4, §9.4) combined with **no rollup-staleness detection** (§9.5). Together these mean: (a) a rule meant to detect "nothing is happening" structurally cannot detect the one condition it exists for, and (b) if the upstream rollup pipeline stalls entirely, every window/operational/AI-tier rule keeps evaluating against increasingly stale data with no signal that anything is wrong — a monitoring system that can go silently blind while still reporting "evaluated: N" in its own summary counters.

### 10.6 Critical architectural issues (ranked)
1. Cooldown/consecutive-breach state lacks row-level locking or atomic increments, creating a real duplicate-alert path during Redis outages.
2. Two independently-computed fingerprint functions for what should be one canonical alert identity.
3. Aggregate function and lookback window configuration are decorative — not connected to any evaluation code.
4. Absence-detection rule types are structurally unsupported by the "no row = skip" design.
5. Auto-resolve is fully dead code in both schemas.
6. `current_revision` / fingerprint coupling is a latent landmine for future maintainers.
7. Policy-effective cache invalidation gap, currently dormant but unsafe to activate as-is.

### 10.7 Exact fixes required
- **Cooldown/breach locking:** wrap the `alert_rule_eval_state` read + write in a single transaction using `SELECT ... FOR UPDATE` on the `scopeHash` row (or a `pg_advisory_xact_lock` keyed on `scopeHash`), and convert `consecutive_breaches` updates to a DB-side atomic increment (`SET consecutive_breaches = consecutive_breaches + 1`) rather than a client-computed absolute value. This closes both the cooldown-bypass and lost-update findings in one change.
- **Unify fingerprinting:** make `decision.engine.ts`'s `alertFingerprint()` call `computeAlertFingerprint()` (or vice versa) so there is exactly one function computing the canonical alert identity, consumed by both the Redis gate and the DB dedup key.
- **Wire `aggregate_function`/`lookback_minutes` into evaluation,** or, if the intended design is that all aggregation happens upstream in the analytics-engine rollup workers, remove/deprecate these fields from the condition schema and API surface so operators aren't configuring settings that do nothing. Whichever direction is chosen, update `docs/alert-rules-catalog.md` to reflect the true evaluated window (fixed rollup bucket), not the configured `lookback_minutes`.
- **Fix absence-rule evaluation:** either have the rollup workers write an explicit zero-row for buckets with no matching events (at least for org/project/environment scopes with any prior activity), or add an explicit "no data for N consecutive expected buckets" signal that absence-type rules can key off of, rather than relying on `count < 1` against data that never gets materialized.
- **Add rollup-staleness detection:** compare each fetched rollup row's `bucket` timestamp against `NOW()` and either skip evaluation with an explicit "stale data" log/metric, or surface staleness on the resulting alert's evidence, once staleness exceeds a defined threshold (e.g. 2x the rollup interval).
- **Implement or remove auto-resolve:** either build the sweep worker that reads `auto_resolve_at` (V2) and forces resolution, or remove the field from the schema/API/UI if the feature is not going to be implemented, to stop presenting a working-looking option that silently does nothing.
- **Implement or remove `isRequired`:** either implement the documented soft-condition semantics in `evaluateRule`, or remove the field and update the module docstring to match actual behavior.
- **Fix `current_revision` increment,** and simultaneously verify/update the fingerprint functions' handling of revision bumps so that a routine rule edit doesn't silently reset dedup/alert history — these two fixes must ship together.
- **Wire `AlertPolicyEngine.invalidateRule()`** into `RulesService`'s CRUD mutations before any code path that relies on `AlertPolicyEngine.resolve()` goes live on the hot evaluation path.
- **Remove the silent pool fallback** (`telemetryPool ?? pool`) in `alerting/queue.ts:117` and make `registerAlertingWorkers` require an explicit telemetry pool argument (throw if omitted), so a future bootstrap mistake fails loudly instead of silently producing alerts that never fire.
- **Replace `console.log`/`console.error` in `engines.ts` and `decision.engine.ts`** with the existing structured logger at appropriate levels (debug for per-condition detail, info for fire/recover decisions), gated behind a verbosity flag if the detail is still wanted in development.
- **Expose the effective/resolved rule through the API** (e.g. `GET /rules/:id/effective?projectId=...`) so operators can see what will actually fire in a given scope, not just the raw configured row — and make `POST /rules/:id/test` exercise the effective rule (including bindings), not just the raw stored conditions.

### 10.8 Recommended tests before considering the alert system reliable
- **Concurrency test:** simulate Redis unavailability and fire two concurrent `evaluateCandidate()` calls for the identical scope/rule with a genuinely matching condition; assert exactly one `alert_events_v2` row and one set of notification jobs is created, not two.
- **Consecutive-breach race test:** fire N concurrent evaluations for the same scope where the rule requires M consecutive breaches; assert the counter reaches exactly M after M true breaches regardless of concurrency (will fail today; use to validate the atomic-increment fix).
- **Absence-rule test:** feed a scope zero events for a full window and assert `service_inactivity`/`request_inactivity`-style rules actually fire (will fail today; use to validate the zero-row/absence-signal fix).
- **Staleness test:** freeze the analytics-engine rollup worker, advance wall-clock time past the staleness threshold, and assert the window-tier evaluator either skips evaluation or flags the resulting decision as stale (will fail today; no such behavior exists).
- **Auto-resolve test:** create a rule with `autoResolveAfterMinutes` set, fire it, then advance time past the auto-resolve window with no further evaluations; assert the alert transitions to `resolved`. (Will fail today — there is no sweep.)
- **`isRequired=false` test:** construct a rule with one required and one optional (`isRequired:false`) condition in the same group where only the required one passes; assert it matches. (Will fail today.)
- **Rule-edit fingerprint continuity test:** update a rule's threshold value (bumping whatever revision-tracking mechanism is fixed per §10.7), then fire the same condition before and after the edit; assert `duplicate_count`/cooldown history carries over rather than resetting, unless a reset is the explicitly intended behavior.
- **Field-path synonym collision test:** construct a rule whose `field_path` resolves to an object containing both `p95` and `avg` keys; assert the evaluator picks the statistic the rule author actually intended (today it always picks by the fixed priority order regardless of intent) — use this to decide whether `readPath`'s unwrap priority needs to become field-path-aware rather than global.
- **Cross-tenant IDOR regression test:** for each non-org-scoped internal method (`getRuleConditions`, `getRuleActions`, `getRuleActionsByRuleIds`, `ConnectorRepository.getByIds`), add a test asserting the current call sites always pass pre-validated, same-tenant ids — as a tripwire against a future caller introducing a cross-tenant id by accident.
- **Legacy operator mapping test:** assert that any `project_alert_thresholds.comparison_operator` value outside the known 6-item map raises a visible warning/error rather than silently producing `operator: null`.

---

## 11. Files Referenced in This Audit

- `src/modules/alerting/evaluator.ts`
- `src/modules/alerting/runtime/engines.ts`
- `src/modules/alerting/runtime/telemetry-outbox-relay.ts`
- `src/modules/alerting/runtime/alert-fingerprint.ts`
- `src/modules/alerting/runtime/alert-runtime.repository.ts`
- `src/modules/alerting/runtime/notification-router.ts` / `notification-routing.service.ts` / `notification-entitlement.service.ts`
- `src/modules/alerting/decision/decision.engine.ts`
- `src/modules/alerting/decision/state-machine.ts`
- `src/modules/alerting/evaluation/metric-registry.ts` (confirmed dead code)
- `src/modules/alerting/policy/resolve-rule.ts`, `resolve-threshold.ts`, `policy.engine.ts`, `policy.cache.ts`
- `src/modules/alerting/rules/rules.repository.ts`, `rules.service.ts`, `rules.types.ts`
- `src/modules/alerting/events/events.repository.ts`, `events.service.ts`
- `src/modules/alerting/escalation.ts`, `escalation/escalation.worker.ts`
- `src/modules/alerting/queue.ts`
- `src/modules/connectors/queue.ts`, `core/connector.repository.ts`
- `src/modules/analytics-engine/workers/base.ts`, `requests.worker.ts`
- `src/db/postgres/primary_db_draft/09_alerting/*.sql`
- `src/shared/workers/main.ts`, `ingestion-worker-main.ts`
- `docs/alert-rules-catalog.md`, `docs/alertseperation.md` (referenced for documented intent, not treated as ground truth for actual behavior)

*No code was modified during this audit.*

---

## 12. Appendix — Frontend Pages Under the Alert ("Act") Section

This section inventories every frontend page tied to alerting, in the separate `pulsiv_fe` repo (`c:\Users\vikas\OneDrive\Desktop\startup\pulsiv_fe`), and maps each to its route and backend dependency. Included because the correctness of the alert *system* is only as useful as the surfaces that expose it — and because dead/duplicate pages found here compound some of the backend findings above (e.g. §4's "no way to see the effective/resolved rule" gap is visible directly in the UI).

### 12.1 Navigation entry point

The alert section is labeled **"Act"** in the primary nav (`src/app/navigation/navigation.tsx:140-157`), rooted at `/alerts`, with children:

| Nav label | Path | Group |
|---|---|---|
| Overview | `/alerts/overview` | Alerting |
| Incidents | `/alerts` (exact) | Alerting |
| Alert rules | `/alerts/rules` | Alerting |
| Escalations | `/alerts/escalations` | Alerting |
| Templates | `/alerts/templates` | Alerting |
| Silences | `/alerts/silences` | Operations |
| Routing | `/alerts/routing` | Operations |
| Metrics | `/alerts/metrics` | Operations |
| Dead letters | `/alerts/dead-letters` | Operations |

### 12.2 Route → component map (org-level `/alerts/*`, from `protected-routes.tsx:383-406`)

```
/alerts                        -> AlertEventsPage          (index)
/alerts/overview                -> AlertOverviewPage
/alerts/incidents                -> AlertEventsPage          (duplicate of index)
/alerts/incidents/:incidentId    -> AlertEventDetailPage
/alerts/:incidentId              -> AlertEventDetailPage     (catch-all, same component as above)
/alerts/rules                    -> AlertRulesPage
/alerts/rules/:ruleId            -> AlertRuleDetailPage
/alerts/policies/:policyId       -> OrgPolicyDetailPage
/alerts/escalations              -> EscalationsPage
/alerts/escalations/:policyId    -> EscalationDetailPage
/alerts/templates                -> AlertTemplatesPage (= ChannelsPage.tsx, exported as AlertTemplatesPage)
/alerts/silences                 -> SilencesPage
/alerts/routing                  -> RoutingRulesPage
/alerts/metrics                  -> AlertMetricsPage
/alerts/dead-letters              -> AlertDeadLettersPage (= DeadLettersPage.tsx)
/alerts/channels                 -> redirect to ../templates
/alerts/channels/:channelId      -> redirect to ../templates
```

All are lazily loaded (`lazy(() => import("@/pages/act/..."))`) and rendered inside a shared `ModuleLayout`.

**Finding: `/alerts` and `/alerts/incidents` are two distinct routes rendering the identical `AlertEventsPage` component**, and `/alerts/:incidentId` is a catch-all that resolves to the same `AlertEventDetailPage` as the more specific `/alerts/incidents/:incidentId`. This isn't broken, but it's redundant routing — three route entries doing the work of two, likely left over from a nav restructuring (the nav config still calls this section "Incidents" while the component file is named `AlertEventsPage`).

**Finding: `AlertTemplatesPage` is a rename-via-export, not an actual "templates" page.** `const AlertTemplatesPage = lazy(() => import("@/pages/act/ChannelsPage"))`, and `ChannelsPage.tsx`'s default export function is literally named `AlertTemplatesPage` (confirmed by direct read: `export default function AlertTemplatesPage() {` at `ChannelsPage.tsx:29`). The file, the route comment, and the nav label all disagree about whether this is a "channels" or "templates" concept — functionally it's whichever one `ChannelsPage.tsx` actually implements (message templates, per its imports of `AlertTemplate` types), but the naming trail here is confusing for anyone navigating the codebase.

### 12.3 Page-by-page inventory (org-level, `src/pages/act/`)

| File | Routed? | Backing hook / API | Purpose |
|---|---|---|---|
| `AlertOverviewPage.tsx` | ✅ `/alerts/overview` | `@/modules/alerting/hooks/useAlerting` | Alerting health/volume/status dashboard. |
| `AlertEventsPage.tsx` | ✅ `/alerts`, `/alerts/incidents` | `@/modules/alerting/hooks/useAlerting`, `AlertSeverity`/`IncidentState` types | Incident/event list with severity + state filters; the actual "Incidents" screen despite the file being named "Events". |
| `AlertEventDetailPage.tsx` | ✅ `/alerts/incidents/:incidentId`, `/alerts/:incidentId` | alerting API | Single incident detail — acknowledge/resolve actions, auto-resolve display (`event.autoResolveAt`, confirmed at line 179 — **this UI field renders a value that, per §5.6/§9.6 of this audit, the backend never actually acts on**; the UI will show a countdown/time for auto-resolve that will never trigger a real resolution). |
| `AlertRulesPage.tsx` | ✅ `/alerts/rules` | `useOrganizationAlertPolicyMutations` and related hooks, `AlertSeverity`/`PolicyCategory` types | Rule list — create/edit/enable/disable rules. Per §4 of this audit, this page (and its detail counterpart) reflects the **raw configured rule**, not the effective/bound rule that project-level bindings might override — there is no UI affordance here for viewing what a rule actually resolves to in a specific project scope. |
| `AlertRuleDetailPage.tsx` | ✅ `/alerts/rules/:ruleId` | alerting API | Single rule detail/edit. Same effective-vs-configured gap as above. |
| `OrgPolicyDetailPage.tsx` | ✅ `/alerts/policies/:policyId` | alerting API | Org-level alert policy detail (distinct from a "rule" — policy/threshold preset detail view). |
| `EscalationsPage.tsx` | ✅ `/alerts/escalations` | `useAlertingWorkspace()` | List of escalation policies with step previews. |
| `EscalationDetailPage.tsx` | ✅ `/alerts/escalations/:policyId` | alerting API | Escalation policy step editor. |
| `ChannelsPage.tsx` (exports `AlertTemplatesPage`) | ✅ `/alerts/templates` | `AlertTemplate`/`AlertSeverity` types | Notification message template management. |
| `SilencesPage.tsx` | ✅ `/alerts/silences` | `useSilenceMutations`, `useSilences` | Time-boxed suppression window management (create/list/delete). |
| `RoutingRulesPage.tsx` | ✅ `/alerts/routing` | `AlertRoutingRule` type, `alerting-ui` components | Match-alerts-to-connector routing rule management. |
| `AlertMetricsPage.tsx` | ✅ `/alerts/metrics` | `useAlertMetrics`, `METRIC_GRANULARITIES` | Rolled-up firing/delivery counters. |
| `DeadLettersPage.tsx` (exports `DeadLettersPage`, routed as `AlertDeadLettersPage`) | ✅ `/alerts/dead-letters` | `DeadLetterStatusPill`, `AlertDeadLetter` type | Org-level failed-batch retry/discard UI. |
| `IncidentsPage.tsx` | ❌ **not routed** | `useAlertIncidents`, `IncidentStateBadge` | Fully implemented, real-data incident list — appears to be an earlier/alternate implementation superseded by `AlertEventsPage`. No route references it anywhere in the router. |
| `IncidentDetailPage.tsx` | ❌ **not routed** | shared `observe` UI kit (Tabs, JsonViewer, etc.) | Fully implemented incident detail view, superseded by `AlertEventDetailPage`. Not reachable from any route. |
| `ChannelDetailPage.tsx` | ❌ **not routed** | `observe` UI kit | Per-channel detail/edit view — orphaned; the live routing sends `/alerts/channels/:channelId` straight to a redirect (`../templates`) instead of this component. |

**Finding: three fully-built, real (non-mock) page components are dead code** — `IncidentsPage.tsx`, `IncidentDetailPage.tsx`, `ChannelDetailPage.tsx`. They compile and presumably still work, but nothing in `protected-routes.tsx` points to them. This is the frontend's version of the backend's dead-code findings (§9.3, §9.6) — configuration/code that looks live but has no execution path. Low risk (unreachable code doesn't affect running behavior) but worth cleaning up or re-wiring, since a future maintainer editing `IncidentsPage.tsx` under the assumption it's the live incidents screen would be editing dead code.

### 12.4 Project-scoped alert pages (`src/pages/workspaces/`, under `/p/:projectPublicId/*`)

These are a **separate set of pages** from the org-level `/alerts/*` section above — scoped to a single project, reached via the project shell (`ProjectShellPage`), not the "Act" nav section.

| File | Route | Backing hook | Purpose | Notes |
|---|---|---|---|---|
| `ProjectAlertsPage.tsx` | `alerts` | `useProjectAlerts`, `useProjectAlertingStatus`, `useNotificationEntitlement` | Project-scoped incident feed with status/severity/search filters, entitlement banner. | Real implementation, uses `toIncidentView` mapper; clicking a row navigates to `/alerts/:incidentId` — i.e. it hands off to the **org-level** `AlertEventDetailPage`, not a project-scoped detail page. |
| `ProjectThresholdsPage.tsx` | `alert-rules` | Org alert-policy hooks + `findSubscriptionForPolicy`/`extractOverride` helpers | Project view of org-level rules, showing per-project subscription/override state. | This is the page that's closest to exposing the "effective rule" concept from §4 of this audit — it explicitly models `ProjectSubscription`/`ProjectOverride`, which is encouraging, but it's independent of whatever `resolveEffectiveRule()` on the backend actually computes; whether this UI's override model is wire-compatible with the backend's binding-resolution model was not verified in this audit and should be checked before trusting this page as an accurate "what will actually fire" view. |
| `ProjectAlertChannelsPage.tsx` | `alert-channels` | `ProjectAlertChannel`/`AlertChannelBody` types | Project-level notification channel configuration (create/edit channel form). |
| `ProjectAlertRoutesPage.tsx` | `routes` | project alert-route hooks | List of project-scoped alert routing rules. |
| `AlertRouteWizardPage.tsx` | `routes/:routeId` | `useAlertRouteMutations`, `useAlertRoute` | 3-step wizard to create/edit a single alert route (basic info → match conditions → targets/throttling). | **Finding: ships with a hardcoded mock connector list** (`mockConnectors`, 3 fake entries — Slack/PagerDuty/Webhook — with a comment `// Mock connectors until we have useConnectors hook`, confirmed directly in the file). This means the "Delivery Targets" step in this wizard does not reflect a project's real connectors; anyone using this wizard today is selecting from fake data, and any route saved through it will reference connector IDs (`conn_1`, `conn_2`, `conn_3`) that do not exist in the real connector table. This is a functional gap, not just a cosmetic one — it should be fixed (wire to a real `useConnectors` hook) before this wizard is considered usable. |
| `AlertDeliveryLogsPage.tsx` | `deliveries` | `useAlertDeliveries` (from `@/modules/projects/hooks/`, **not** `@/modules/alerting/hooks/`) | Delivery attempt history per route/connector/status/latency. |
| `DeadLetterQueuePage.tsx` | `dlq` | `useDeadLetterQueue`, `useDeadLetterMutations` (from `@/modules/projects/hooks/`) | Project-scoped DLQ with replay/discard/purge actions. |
| `MemberAlertPreferencesPage.tsx` | `preferences` | member notification preference hooks, `quietHoursOf` helper | Per-member notification preferences (quiet hours, channel opt-in/out). |

**Finding: two structurally separate dead-letter-queue implementations exist.** The org-level `/alerts/dead-letters` (`DeadLettersPage.tsx`, backed by `@/modules/alerting/api` types like `AlertDeadLetter`) and the project-level `/p/:projectPublicId/dlq` (`DeadLetterQueuePage.tsx`, backed by an entirely different hook module `@/modules/projects/hooks/useDeadLetters`) are two independent UIs, using two independent API/hook layers, apparently for what should conceptually be the same underlying dead-letter data (or possibly two genuinely different dead-letter concepts — legacy batch dead letters vs. connector delivery dead letters, per the backend audit's finding that `alert_notification_ledger`/connector dead-letter state and the legacy `alert_events`/batch dead-letter tables are separate systems). This mirrors the backend's dual-fingerprint/dual-schema pattern (§5.1, §9.2) and should be reconciled or explicitly documented as intentionally two different concepts, since right now there is no way to tell from the frontend alone whether this is by design or accidental duplication.

**Finding: legacy path redirects exist for the pre-rename project pages** (`ProjectShellPage` children, confirmed in `protected-routes.tsx:373-376`): `alert-thresholds` → `../alert-rules`, `thresholds` → `../alert-rules`, `channels` → `../alert-channels`. This confirms `alert-rules`/`alert-channels` are the current names after at least one prior rename; harmless, but indicates naming churn consistent with the "Templates vs Channels" confusion noted in §12.2.

### 12.5 Summary of frontend-specific issues found

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | `AlertRouteWizardPage` uses a hardcoded mock connector list instead of real project connectors | **High** (functional — produces routes referencing nonexistent connector IDs) | Wire to a real `useConnectors`/connector-listing hook scoped to the current project before this wizard is used in production. |
| 2 | Three fully-implemented pages (`IncidentsPage`, `IncidentDetailPage`, `ChannelDetailPage`) are unreachable dead code | Low | Either delete them or confirm they're intentionally kept as a reference/rollback and document why. |
| 3 | Two independent dead-letter-queue UIs/hook layers (org-level vs project-level) with no visible reconciliation | Medium | Confirm whether these map to genuinely distinct backend concepts; if not, consolidate to one implementation. |
| 4 | `AlertEventDetailPage` renders `event.autoResolveAt`, a value the backend never acts on (§5.6/§9.6 of this audit) | Medium (UX correctness) | Either implement the backend auto-resolve sweep, or remove/annotate this UI field as informational-only until it is. |
| 5 | Redundant routing: `/alerts` and `/alerts/incidents` both render `AlertEventsPage`; `/alerts/:incidentId` catch-all duplicates `/alerts/incidents/:incidentId` | Low | Collapse to one canonical path set; keep the other as an explicit redirect if backward-compatible links are needed. |
| 6 | No UI anywhere exposes the *effective* (post-binding-resolution) rule — `AlertRulesPage`/`AlertRuleDetailPage` only show the raw configured rule, matching the backend API gap in §4/§10.7 | Medium | Once the backend adds an effective-rule endpoint (recommended in §10.7), surface it in `AlertRuleDetailPage`, ideally alongside `ProjectThresholdsPage`'s existing subscription/override UI. |
| 7 | Naming inconsistency between "Templates" (nav label, route path) and "Channels" (file name, component export name) for the same page | Low | Rename the file/export to match the route (`AlertTemplatesPage.tsx`) for maintainability. |

*No frontend code was modified during this audit.*

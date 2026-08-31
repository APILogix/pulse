# 22 — Final Forensic Verdict

## AUTOMATION SYSTEM STATUS

**Automation module: NOT PRODUCTION READY.**
**Alerting module: PRODUCTION READY WITH CONDITIONS** (per already-completed hardening work, with several already-documented gaps still open, none newly discovered as blocking in this pass beyond what prior docs already flagged).

The automation verdict is driven by a single, live-verified fact: the runtime tables it depends on for claiming inbox events, creating runs, and claiming execution steps do not have the columns the code requires, confirmed by a direct read-only query against the project's own live database. This is not a theoretical risk — it is a proven blocker. Everything downstream of that (condition evaluation, action execution, retries, idempotency) is sound *as code* but cannot currently run end-to-end against the real deployed system.

## Top 10 Problems (ranked by real production impact)

1. Automation runtime schema/code mismatch — automation cannot process events, create runs, or execute steps against the live database today (root-cause #1, live-verified).
2. 17 of 26 automation action types are hardcoded no-ops that report "succeeded" — silent, misleading non-execution (root-cause #3).
3. No test exercises the real SQL that would have caught #1 — false confidence from a passing test suite (root-cause #2, live-verified — 29/29 tests passed while testing none of the broken SQL).
4. Fingerprint migration for in-flight alerts never written — a known deploy blocker from the prior hardening report, still open (root-cause #12).
5. 9 more automation action types are unreachable because no integrations are wired into `automation.module.ts` (root-cause #4).
6. Automation action idempotency key computed but never forwarded to downstream integrations — real duplicate-side-effect risk once any real integration is wired (root-cause #5).
7. No per-tenant rate limiting/backpressure in either subsystem beyond automation's `maxRunsPerHour` — a noisy tenant can consume shared capacity (root-cause #8).
8. Lookback/aggregation condition fields decorative; absence/inactivity alert rules structurally cannot fire — largest remaining alerting correctness gap per the hardening report's own words (root-cause #13).
9. Possible double-retry path for failed automation steps — two independent retry mechanisms with non-colliding dedup keys (root-cause #6).
10. `alert.correlate`/`notification.digest` queues are dead (producer with no consumer) — a smaller but real gap (root-cause #7).

## Top 10 Fixes (ranked by leverage)

1. Ship the missing automation runtime migration (unblocks the entire subsystem — highest leverage fix in this audit).
2. Add a real-schema integration test for the claim/lock/retry SQL (prevents this exact failure mode from recurring silently).
3. Change `not_implemented` results to a visibly distinct run/step status (small change, large trust impact).
4. Ship the fingerprint migration for alerting (unblocks a known-flagged deploy risk).
5. Wire real integrations for the 9 conditionally-implemented action types + forward idempotency keys.
6. Add per-tenant rate/concurrency caps to both subsystems' dispatch paths.
7. Resolve or confirm-safe the double-retry path for automation steps.
8. Enforce (or remove) `max_notifications_per_hour`/`throttle_duration_seconds` in alerting.
9. Remove or implement `alert.correlate`/`notification.digest`.
10. Address the alerting lookback/aggregation/absence-rule gaps per the hardening report's own existing plan.

## What already works (verified, not assumed)

- Automation's orchestration logic (workflow lifecycle, cooldown/rate-limit atomicity, sequential step claiming, approval gating, dedup keys) is well-designed and correct **as written in code** — the failure is entirely in the schema layer beneath it, not the application logic.
- Alerting's evaluation, decision, delivery, and locking mechanisms are sound, live-re-verified in several places in this audit (SSRF protection, `FOR UPDATE SKIP LOCKED` claim queries, secrets encryption).
- Tenant scoping via `organization_id` filters is consistently applied across both modules' query layers, spot-checked extensively.
- Ingestion is architecturally isolated from both alerting and automation — neither can slow down the telemetry critical path.

## What does not work (exact evidence)

- Automation runtime claim/lock/retry SQL against the live database — confirmed via live `information_schema.columns` query.
- 17 hardcoded-stub action types — confirmed via direct read of `action-runner.ts`'s `notImplementedActions` array.
- `alert.correlate`/`notification.digest` — confirmed via full-tree grep for `pgboss.work` registrations.

## What is unknown (explicitly, not guessed)

- Whether the live database gap (root-cause #1) is a genuine oversight or whether some other, undiscovered migration path applies these columns in some environments but not the one this audit connected to.
- Whether the double-retry path (root-cause #6) actually manifests in practice — code supports it, no live trace was captured.
- DST/timezone edge-case correctness of `nextCronOccurrence` — not fixture-tested in this pass.
- Real external-provider delivery behavior (SMTP, Slack, PagerDuty) — never exercised live in this or any prior audit reviewed.
- Exact type-coercion edge cases in automation's `gt/gte/lt/lte`/`between` operators.

## Highest-risk failure modes (concrete scenarios)

1. A customer builds a workflow expecting a webhook to fire on an event. The workflow runs, reports "succeeded," and no webhook is ever sent — the customer has no signal that anything is wrong.
2. A customer relies on the automation `/events` API expecting near-real-time trigger processing; every event silently accumulates in `automation_events_inbox` with no worker able to successfully claim it, because the claim query throws against the live schema.
3. An alerting rule configured with a lookback window behaves as if the lookback setting doesn't exist (because it doesn't, functionally) — alert firing timing is different from what the user configured, with no error surfaced.
4. A deploy of the alerting fingerprint change (if it happens before the migration in root-cause #12 is written) causes in-flight alerts to silently stop matching their historical dedup/resolve keys.

## Recommended Target Architecture

See `19-recommended-target-architecture.md` — summary: preserve the existing pg-boss/Postgres-based orchestration architecture for both subsystems; close the schema gap; make unimplemented actions visibly distinct from successful ones; add per-tenant backpressure; wire real integrations where the product requires them.

## Implementation Roadmap

See `20-optimization-roadmap.md` for the full P0-P3 breakdown.

---

This verdict is based on static code analysis, prior-audit cross-referencing, and one live read-only database query plus one live test-suite execution — both explicitly documented above with their exact results. No throughput, latency, or production-usage numbers are claimed anywhere in this document set, per the audit's non-negotiable fabrication rule.

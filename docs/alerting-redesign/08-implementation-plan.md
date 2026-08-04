# Phase 17 — Incremental Implementation Plan

Ten increments. Each one compiles, ships independently, is feature-flagged, and preserves backward
compatibility. Every increment documents the nine required dimensions.

Legend for module paths (all under `pulse/src/`):
`A` = `modules/alerting`, `C` = `modules/connectors`, `I` = `modules/ingestion`, `P` = `modules/projects`,
`B` = `modules/billing`, `W` = `shared/workers`.

---

## Increment 1 — Stabilize schema ownership (no behaviour change)

- **Modules:** new `A/runtime/` (Log DB repositories), `A/config/` (primary repositories). Split
  `A/repository.ts` into `AlertConfigRepository` + `AlertRuntimeRepository`. `C/repository.ts` split
  likewise. Inject pools explicitly; delete implicit `pool` imports from evaluator/runtime paths.
- **DB:** L1, L3, L6 (`*_v2` typed runtime tables); P7 (rate/circuit tables). No drops.
- **Workers:** none added. `W/main.ts` passes `logDB.getPrimaryPool()` into alerting/connector
  runtime repos. Boot assertion: runtime pool must see `events_requests` and `alert_events_v2`.
- **Queues:** unchanged.
- **API:** unchanged.
- **Migration:** additive DDL + `ALERTING_V2_WRITE` flag (default off).
- **Rollback:** flag off; drop `*_v2`.
- **Scalability:** removes the hidden single-pool coupling; enables independent Log DB scaling.
- **Ops:** new metric `alerting_runtime_pool_target{db}` to prove which DB is being written.
- **Failure recovery:** dual-write means a v2 write failure logs and does not fail the request.
- **Testing:** repository contract tests against both pools via testcontainers; a boundary test
  asserting no file in `A/runtime` imports `config/database.js`.

## Increment 2 — Rule bindings + Effective Rule Resolution (dormant)

- **Modules:** `A/config/bindings.repository.ts`, `A/policy/resolve-rule.ts` (pure fold),
  `A/policy/resolve-threshold.ts`.
- **DB:** P1–P3, P12 backfill.
- **Workers:** none.
- **Queues:** none.
- **API:** `GET/POST/PATCH/DELETE /organizations/:orgId/alerting/rules/:ruleId/bindings`;
  `GET …/rules/:ruleId/effective?projectId=&environment=&service=&endpoint=` returns the resolved
  rule **with its trace** (this is the debugging surface architects will actually use).
- **Migration:** backfill produces behaviour-identical bindings (see `07-migration-plan.md` §3).
- **Rollback:** delete backfilled bindings; resolver unused by evaluators yet.
- **Scalability:** resolution is pure and cached; O(depth ≤ 5) per rule.
- **Ops:** `alert_binding_conflicts_total` when two equal-depth bindings tie-break.
- **Failure recovery:** resolver is pure — no recovery needed.
- **Testing:** property tests on the fold (inherit/override/disable/merge, all orderings); the exact
  worked example from the brief as a golden test (org 5% → A disable → B 2% → prod 1% → /payment 0.5%
  yields one rule at 0.5%).

## Increment 3 — Alert Policy Engine (shadow mode)

- **Modules:** `A/policy/` — `policy.engine.ts`, `channel.resolver.ts`, `connector.resolver.ts`,
  `recipient.resolver.ts`, `maintenance.resolver.ts`, `entitlement.resolver.ts`, `usage.policy.ts`,
  `escalation.resolver.ts`, `correlation.policy.ts`, `policy.cache.ts`, `types.ts`.
- **DB:** P4, P5, P6, P8, P13; L1.
- **Workers:** shadow hook inside the existing batch processor — resolve a policy, log the diff
  against the legacy decision, deliver using the legacy path.
- **Queues:** unchanged.
- **API:** `POST /alerting/policy/simulate` (dry-run an `AlertCandidate`, returns the full policy +
  trace). Invaluable for support.
- **Migration:** additive.
- **Rollback:** remove the shadow hook (single call site).
- **Scalability:** per-org config snapshot cached 30s keyed by `config_version`; steady state is
  ~1–3 queries per org per 30s regardless of alert volume.
- **Ops:** `alert_policy_resolve_seconds` histogram, `alert_policy_shadow_diff_total{field}`.
- **Failure recovery:** shadow failures are caught and logged; legacy path unaffected.
- **Testing:** golden-file tests per stage; determinism test (same input ⇒ identical `policyId`);
  the 24h shadow diff gate from `07-migration-plan.md` §9.6.

## Increment 4 — Transactional outbox + relay

- **Modules:** `I/pipeline/telemetry-writer.ts` (accept an external client), `I/pipeline/outbox.ts`,
  `I/pipeline/event-processor.ts` (wrap in one transaction), new `A/outbox/relay.worker.ts`.
- **DB:** L2 (+ partitions via L7).
- **Workers:** ingestion worker writes outbox rows; alerting worker runs the relay.
- **Queues:** new `telemetry.persisted`.
- **API:** unchanged.
- **Migration:** `OUTBOX_ENABLED` flag; when off, no outbox rows are written.
- **Rollback:** flag off. Unpublished rows are pruned by the partition manager.
- **Scalability:** only `fast_path` signals are relayed 1:1; everything else aggregates to tick hints,
  so outbox volume is a small fraction of telemetry volume. Relay is shard-free (SKIP LOCKED).
- **Ops:** `telemetry_outbox_lag_seconds`, `telemetry_outbox_unpublished`, relay throughput.
- **Failure recovery:** at-least-once with dedup downstream; reconcile alarms on rows unpublished >5m.
- **Testing:** rollback test (aborted tx ⇒ zero outbox rows ⇒ zero alerts); crash-after-commit test;
  duplicate SDK delivery test (confirmed-inserted-only ⇒ no phantom alert).

## Increment 5 — Decision Engine + notification jobs

- **Modules:** new `A/decision/decision.engine.ts`, `A/decision/state-machine.ts`,
  `A/runtime/notification-jobs.repository.ts`, `A/runtime/ledger.repository.ts`.
- **DB:** L3 (jobs, ledger, state), L4 (usage ledger).
- **Workers:** new `alert.decide` consumer.
- **Queues:** `alert.decide`, `notification.route`.
- **API:** existing ack/resolve/silence endpoints repoint to `alert_event_state` behind the read flag.
- **Migration:** dual-write; legacy batch processor still authoritative until step 6.
- **Rollback:** `ALERTING_V2_READ=false`.
- **Scalability:** one transaction per alert; `FOR UPDATE` only on the single state row, so contention
  is per-alert-key, not per-org.
- **Ops:** `alert_decide_seconds`, `alert_dedup_hits_total`, `alert_suppressed_total{reason}`.
- **Failure recovery:** whole step is one tx; retried job is a no-op via `uq_alert_events_idem`.
- **Testing:** concurrency test (two workers, same alert key, one fire); idempotency test (replay the
  same job 10× ⇒ one alert, one job set, one usage row).

## Increment 6 — Router + connector isolation

- **Modules:** new `A/routing/notification.router.ts`; `C/delivery/*` reduced to transport;
  delete recipient/routing/subscription logic from `C`. Add the import-boundary lint rule.
- **DB:** L6 additions (`notification_job_id`, `channel_kind`, `idempotency_key`, `connector_dead_letters`).
- **Workers:** seven `connector.<provider>` consumers replace `connector-send-<type>`; `connector.retry`,
  `connector.dlq`.
- **Queues:** the Phase 15 topology.
- **API:** `POST /connectors/dead-letters/:id/replay`, `GET /connectors/dead-letters`.
- **Migration:** run old and new send queues in parallel for one release; the router targets new queues
  only when `ALERTING_V2_READ=true`.
- **Rollback:** router falls back to publishing legacy `connector-send-<type>`.
- **Scalability:** per-provider queues mean a Slack outage cannot block email; connector workers scale
  per provider.
- **Ops:** per-queue depth/latency, `connector_dlq_total{provider,category}`.
- **Failure recovery:** real DLQ table with replay (fixes audit C6).
- **Testing:** contract test that a connector worker given only a `NotificationJob` can deliver;
  static test that `C/**` does not import `A/**`.

## Increment 7 — Global rate limit + single circuit breaker

- **Modules:** `C/runtime.ts` (local limiter demoted to pre-filter), new `C/runtime/global-guards.ts`.
- **DB:** P7 tables + the atomic UPSERT statement.
- **Workers:** connector workers consume tokens from the DB bucket.
- **Queues:** unchanged.
- **API:** `GET /connectors/:id/health` exposes circuit state.
- **Migration:** `CONNECTOR_GLOBAL_LIMITS=true` flag; off = today's behaviour.
- **Rollback:** flag off.
- **Scalability:** one UPSERT per send (index-only, single row) — cheap; removes the
  limit×process-count bug.
- **Ops:** `connector_rate_denied_total`, `connector_circuit_state{connector}`.
- **Failure recovery:** if the bucket UPSERT fails, fall back to the local limiter and alarm (never
  block delivery on a metering failure).
- **Testing:** N-process concurrency test asserting the global limit holds; circuit open/half-open/close
  transitions.

## Increment 8 — Window Engine + Fast Engine (cutover)

- **Modules:** new `A/evaluation/fast.engine.ts`, `A/evaluation/window.engine.ts`,
  `A/evaluation/metric-registry.ts` (absorbs all SQL from `A/evaluator/rule-evaluator.ts` **and**
  `P/alerts/thresholds/threshold.worker.ts`), `A/evaluation/tier-scheduler.ts`.
- **DB:** L3 `alert_rule_eval_state`; P14 threshold backfill.
- **Workers:** `alert.evaluate.fast`, `alert.evaluate.window` (5 tiers × shards), `alert.reconcile`.
- **Queues:** as above; old `alert.evaluate-rules` becomes `alert.reconcile`.
- **API:** rule create/update validates `evaluation_interval_seconds` against
  `alerting.window_tier_seconds`.
- **Migration:** flags `FAST_ENGINE_ENABLED`, `WINDOW_ENGINE_ENABLED`,
  `PROJECT_THRESHOLD_WORKER_ENABLED=false` last.
- **Rollback:** disable new engines, re-enable the scheduled evaluator and threshold worker (both kept
  on disk for one release).
- **Scalability:** query grouping by `(metric, scope, lookback)` replaces per-condition queries — the
  single biggest cost reduction at millions of events/day. Sharding adds linear throughput.
- **Ops:** `alert_eval_tick_seconds{tier}`, `alert_eval_rules_due{tier}`, `alert_fast_latency_seconds`
  (commit→decide), plus SLO alerting on the fast path exceeding 500ms.
- **Failure recovery:** watermarks only advance on success; reconcile re-evaluates stale rules and
  restarts dead tier tickers.
- **Testing:** parity harness replaying 7 days of telemetry through old and new evaluators and
  asserting identical fire/recover sets; latency benchmark for the fast path.

## Increment 9 — Entitlements + usage accounting

- **Modules:** new `A/entitlements/guard.ts`, `A/usage/usage.recorder.ts`,
  `A/usage/rollup.worker.ts`; `B/internal/service.ts` gains a transactional `adjustResourceTx`.
- **DB:** P9, P10, P11; L4.
- **Workers:** `alert.usage-rollup`.
- **Queues:** one new cron queue.
- **API:** entitlement guards on rule/connector/channel/escalation/silence writes;
  `GET /alerting/policy-decisions`.
- **Migration:** `ENTITLEMENTS_ENFORCED` flag; initial deploy runs in **report-only** mode (log what
  would be denied) so no customer is broken by suddenly-enforced limits.
- **Rollback:** flag back to report-only.
- **Scalability:** entitlements read from the 30s policy cache; quota counters read from existing
  aggregates.
- **Ops:** `alert_policy_denied_total{reason,feature_key}`, `alert_quota_exhausted_total`.
- **Failure recovery:** unknown entitlement ⇒ allow `critical`, deny others, alarm (documented
  asymmetry in `06-entitlements-and-usage.md` §3).
- **Testing:** per-plan matrix tests; suppressed/duplicate/retry never billable; rollup idempotency
  under redelivery; report-only mode emits zero denials.

## Increment 10 — Escalation, preferences, correlation

- **Modules:** `A/escalation/escalation.worker.ts` (rewritten to consume `policy_snapshot`),
  `A/preferences/*` (+ `user_notification_preferences`), `A/correlation/correlate.worker.ts`,
  `A/routing/digest.worker.ts`.
- **DB:** L5; P8.
- **Workers:** `alert.escalate`, `alert.correlate`, `notification.digest`.
- **Queues:** three new.
- **API:** user preference CRUD (vacation, mute), incident list/detail, correlation group detail.
- **Migration:** additive; the existing escalation sweep is replaced only when
  `ESCALATION_V2=true`.
- **Rollback:** flag off restores the current sweep.
- **Scalability:** correlation is advisory and off the delivery path; digests collapse N alerts into 1
  notification, directly reducing provider spend.
- **Ops:** `alert_escalation_steps_total`, `alert_incidents_open`, `alert_digest_collapsed_total`.
- **Failure recovery:** escalation reads the immutable snapshot, so a config edit mid-incident cannot
  corrupt an in-flight escalation.
- **Testing:** the brief's escalation scenario (Slack → 5m → PagerDuty → 10m → SMS) as an
  integration test with a fake clock; quiet-hours/vacation suppression tests; correlation noise-
  reduction test.

---

## Cross-cutting testing strategy

| Layer | Approach |
|---|---|
| Unit | Pure functions: rule fold, threshold resolution, channel/connector resolution, fingerprinting, backoff, quiet hours. Injected `Clock`. |
| Contract | Repository tests per pool via `@testcontainers/postgresql`, one container per DB role. |
| Integration | Full pipeline on containers: ingest → outbox → fast engine → policy → decide → route → fake provider. |
| Parity | Replay real telemetry through legacy and v2 engines; assert identical outcomes (gates Increment 8). |
| Concurrency | N workers on the same alert key / same connector; assert exactly-once notification and global rate limit. |
| Failure injection | Kill workers mid-transaction, drop provider connections, force DLQ, verify no loss and no duplicates. |
| Load | 1M events/day equivalent (≈12 events/s sustained, 200/s burst); assert fast path p99 <500ms and window tiers do not fall behind. |
| Migration | Run every `.up.sql` then `.down.sql` against a seeded snapshot; assert schema and row-count equality. |

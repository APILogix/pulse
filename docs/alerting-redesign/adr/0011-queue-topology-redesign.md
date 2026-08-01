# ADR-0011 — Queue Topology Redesign

Status: Proposed · Date: 2026-07-31

## Context

Current alerting/connector queues (all pg-boss, primary DB):

`alert.evaluate-rules`, `alert.form-batches`, `alert.process-batch` (retry 3, dead-letter
`alert-dead-letter`), `alert.escalation-sweep`, `alert.auto-resolve`, `alert.orphan-sweep`,
`alert.dead-letter-retry`, `alert.cleanup`; `connector-send` plus per-type `connector-send-<type>`,
`connector-health-check`, `connector-test`, `connector-secret-rotation`, `connector-oauth-refresh`,
`connector-cleanup`, `connector-dead-letter-retry`, `connector-delivery-retry`.

Alerting and connector workers are both registered in the single general worker process
(`shared/workers/main.ts`) alongside billing, auth, analytics, and org cleanup.

## Problem

1. Pipeline stages are not separable: `alert.process-batch` performs routing, policy, persistence, and
   fan-out, so it cannot be scaled or rate-limited per concern.
2. Batch-oriented flow adds latency and couples unrelated events into one job's fate.
3. No queue exists for event-driven evaluation, so a fast path is impossible.
4. All alerting and connector work shares one process with billing/auth/analytics: a provider outage or
   an alert storm competes with unrelated background work.
5. Naming is inconsistent (`alert.x` dotted vs `connector-x` hyphenated), which makes dashboards and
   alerting-on-alerting harder than it should be.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Keep the batch pipeline, add one fast queue** | Rejected. Leaves the monolithic `process-batch` and its mixed responsibilities as the main path. |
| **B. One queue per rule type** | Rejected. Rule types change; the pipeline stages do not. Wrong axis of decomposition. |
| **C. One queue per pipeline stage, one queue per provider, split worker processes** | **Chosen.** |

## Decision

Stage-aligned topology, consistent dotted naming:

```text
telemetry.persisted
  ├─▶ alert.evaluate.fast
  └─▶ alert.evaluate.window   (5 cadence tiers × shards, singleton per tier+shard)
        ↓  (Policy Engine runs in-process — no queue hop, see ADR-0002)
      alert.decide
        ├─▶ notification.route ─▶ connector.{email,slack,discord,teams,pagerduty,webhook,sms}
        │                              └─▶ connector.retry ─▶ connector.dlq
        ├─▶ alert.escalate
        └─▶ alert.correlate
      alert.reconcile   (cron backstop: missed ticks, orphans, auto-resolve, outbox lag)
      alert.usage-rollup, alert.partition-maintenance, alert.dlq
```

Key parameters (full table in `01-target-architecture.md` §4): `alert.decide` retry 5 with exponential
backoff and jitter, dead-letter `alert.dlq`; provider queues use `retryLimit: 0` because retry is
table-driven via `next_retry_at` (preserving today's proven mechanism) and dead-letter to
`connector.dlq`; sub-minute window tiers are self-rescheduling singletons (`startAfter`), since pg-boss
cron is minute-granular and `setInterval` would not survive a restart; tiers shard on
`hashtext(organization_id) % N` with a distinct `singletonKey` per shard so adding processes adds
throughput without double-evaluating a rule.

Process split: a dedicated **alerting worker** role (evaluation, decision, routing, escalation,
correlation, reconciliation, rollups) and a dedicated **connector worker** role (transport, retry, DLQ,
health, OAuth, cleanup). The general worker keeps billing/auth/analytics/org cleanup.

Retained from today: `FOR UPDATE SKIP LOCKED` for every claim; singleton keys on all crons; bulk
queries and bounded concurrency; per-provider send queues (already present as
`connector-send-<type>`, now first-class).

## Consequences

Positive: each stage scales independently; a Slack outage cannot delay email or evaluation; the fast
path has its own queue and its own latency SLO; per-queue depth/latency dashboards map 1:1 to pipeline
stages, making bottlenecks obvious; consistent naming; horizontal scaling is adding processes, not
reconfiguring.

Negative: more queues (~20 vs ~16) and two more process roles to deploy and monitor; more pg-boss job
rows in the primary DB (mitigated by pg-boss archive/retention settings); operators must learn the new
names during the overlap period.

## Migration Impact

Additive and reversible. New queues are created on worker boot (`createQueue` is idempotent). Old
queues keep running in parallel for one release; `notification.route` publishes to legacy
`connector-send-<type>` when `ALERTING_V2_READ=false`, so the routing switch is a flag, not a
migration. `alert.evaluate-rules` is renamed in role only — it becomes `alert.reconcile` while keeping
its schedule, so the backstop never has a gap. Unscheduling old crons happens last, after new tiers are
verified to be advancing watermarks.

## Future Considerations

- Per-tenant queue partitioning (`alert.decide.shard-N`) if one organization can saturate a stage.
- Priority lanes within `notification.route` for `critical` severity, in addition to job priority.
- Backpressure signalling from provider queue depth into the Policy Engine, so a saturated transport
  degrades to digest mode instead of accumulating unbounded jobs.
- pg-boss job archival tuning per queue once real volumes are known.

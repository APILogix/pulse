# ADR-0001 — Hybrid Alert Evaluation Architecture

Status: Proposed · Date: 2026-07-31 · Supersedes: minute-cron-only evaluation

## Context

Today all alerting is driven by one pg-boss cron queue, `alert.evaluate-rules`, at minute
granularity. It selects due rules (`last_evaluated_at` watermark), runs one bounded SQL query per
condition against the persisted `events_*` tables, and fires through `EventsService.ingestEvent`.
`ProjectThresholdWorker` runs in the same tick over `project_usage_minute`.

## Problem

1. Minimum alert latency is the cron period plus batch-forming latency — routinely 60–120s. A crash,
   OOM, or security event is discovered up to two minutes late, which is not competitive with
   Datadog/Sentry-class products.
2. Cost scales with *rules × conditions*, not with *events*: every rule re-queries a window even when
   no relevant telemetry arrived.
3. There is no mechanism that reacts to a single event, so single-event rules
   (`alert_condition_type = 'static'`) are defined in the enum but unimplementable.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Faster cron** (e.g. every 10s for all rules) | Rejected. Multiplies query load by 6× for all rules to help a small subset. pg-boss cron is minute-granular anyway. |
| **B. Streaming engine** (Kafka/Flink, materialized windows) | Rejected. Violates the explicit no-Kafka constraint and adds an operational tier the team does not run. |
| **C. Evaluate inline in the ingestion worker** | Rejected. Breaks separation of concerns; couples ingest latency to alert/provider latency; an alert storm would throttle telemetry acceptance. |
| **D. Hybrid: event-driven fast engine + tiered window engine + cron reconciliation** | **Chosen.** |

## Decision

Two engines, one shared downstream pipeline.

- **Fast Engine** consumes `telemetry.persisted` (fed by the transactional outbox) and evaluates
  single-event predicates in memory against a cached per-org rule index. Target <500ms
  commit→provider. Applies to unhandled exceptions, crashes, OOM, cron failures, deployment
  failures, security events, authentication failures, heartbeat loss.
- **Window Engine** evaluates rolling-window metrics on five cadence tiers (5s, 15s, 30s, 60s, 300s).
  Sub-minute tiers use a self-rescheduling pg-boss singleton (`startAfter`), not `setInterval`, so
  cadence survives restarts. Tiers are sharded by `hashtext(organization_id) % N`.
- Queries are grouped by `(metric, scope, lookback)` so many rules share one query.
- The existing scheduled evaluator is retained as `alert.reconcile`: missed-tick recovery, orphan
  closure, auto-resolve, and outbox-lag alarming.

## Consequences

Positive: critical alerts drop from ~60–120s to sub-second; window cost becomes proportional to
distinct metric/window groups rather than rule count; `static` conditions become implementable;
sub-minute cadence is achievable without Redis.

Negative: two evaluation code paths to maintain; the fast path depends on the outbox and its relay;
tier tickers need liveness monitoring (mitigated by reconciliation restarting dead tiers); more
queues to operate.

## Migration Impact

Additive. Engines ship behind `FAST_ENGINE_ENABLED` / `WINDOW_ENGINE_ENABLED`. The legacy evaluator
and `ProjectThresholdWorker` remain on disk and runnable for one release. Increment 8 gates cutover on
a parity harness that replays seven days of telemetry through both implementations and requires
identical fire/recover sets. Rollback is a flag flip plus restart.

## Future Considerations

- Materialized rolling aggregates (continuous aggregates) for the busiest metrics if T1/T2 query cost
  becomes the bottleneck.
- Per-tenant tier admission driven by `alerting.window_tier_seconds` so free tiers cannot buy 5s
  cadence.
- If a streaming tier is ever adopted, the Fast Engine's `AlertCandidate` contract is already the
  natural seam — only its input source would change.

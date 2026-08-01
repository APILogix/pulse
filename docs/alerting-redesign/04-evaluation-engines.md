# Phases 5, 6 — Hybrid Evaluation Engines and the Transactional Outbox

## 1. Transactional outbox (Phase 6)

Today the ingestion worker persists telemetry and nothing tells alerting about it; alerting discovers
data by polling on a minute cron. The outbox replaces discovery with notification, without ever
publishing before commit.

`EventProcessor.process` becomes transactional:

```ts
await telemetryTx(async (tx) => {
  const result = await this.writer.writeBatchDetailed(scoped, tx);   // events_* inserts
  await this.outbox.enqueue(tx, buildOutboxRows(result.insertedRows)); // SAME transaction
  return result;
});
// only AFTER commit:
pgNotify('telemetry_outbox');   // best-effort wake-up for the relay
```

Rules:
- Only rows the writer **confirmed inserted** produce outbox rows, so duplicate SDK deliveries do not
  create phantom alerts (this reuses the existing `ON CONFLICT DO NOTHING` + `RETURNING` behaviour).
- If the transaction rolls back, no outbox row exists ⇒ **no phantom alerts**.
- If the process crashes after commit but before `pg_notify`, the relay's 200ms poll finds the row ⇒
  **no lost alerts**.
- `fast_path` is set only for signal kinds that require sub-second reaction. Everything else is
  aggregated to a tick hint, which is what keeps the outbox from becoming a 1:1 copy of telemetry.

### Outbox Relay worker

```text
loop:
  rows = LOGDB: SELECT ... FROM telemetry_outbox
         WHERE published_at IS NULL
         ORDER BY fast_path DESC, created_at
         LIMIT 500 FOR UPDATE SKIP LOCKED
  publish rows → PRIMARY pg-boss: telemetry.persisted   (bulk insert)
  LOGDB: UPDATE telemetry_outbox SET published_at = now()
  wait on pg_notify('telemetry_outbox') OR 200ms
```

At-least-once by design; exactly-once effect is provided by `uq_alert_events_idem` in the Decision
Engine. This is the only place where the two databases are bridged, and it is a one-way, idempotent
bridge (ADR-0003).

## 2. Fast Engine (Phase 5)

Purpose: single-event evaluation, target **<500ms** from telemetry commit to provider hand-off.

Triggers on `fast_path` signals:

| Signal | Detection source |
|---|---|
| Unhandled exception / crash | `events_errors` severity `error`/`fatal`, `attributes.handled = false` |
| OOM | `events_logs`/`events_errors` pattern match (`out of memory`) |
| Heartbeat lost | `events_cron_checkins` missing beyond schedule (evaluated by window tier `60s`, escalated to fast when a monitor is marked critical) |
| Cron failed | `events_cron_checkins.status = 'error'` |
| Deployment failure | `events_messages` with `attributes.kind = 'deployment'` and failure status |
| Security event | `events_logs` with security category |
| Authentication failure | `events_logs`/`events_requests` 401/403 burst flag on the event itself |

Algorithm (no window queries — that is the point):

1. Load the org's **fast rule index** from the policy config cache: rules whose single condition is a
   single-event predicate (`condition_type = 'static'` or threshold with `lookback_minutes IS NULL`).
2. Match the event's attributes against predicates in memory. No SQL per event.
3. For each match, build an `AlertCandidate` with
   `idempotencyKey = sha256(ruleId : bindingId : eventId)`.
4. Call the Policy Engine (in-process, cache-warm).
5. Publish `alert.decide` with the frozen policy.

Batch shape: the relay delivers up to 20 outbox rows per job; the engine groups by org so the config
cache is hit once per org per batch.

New condition support required for single-event rules: `condition_type = 'static'` already exists in
the `alert_condition_type` enum but has no evaluator — the Fast Engine is its implementation, so no
new enum value is needed.

## 3. Window Engine (Phase 5)

Purpose: rolling-window evaluation. This is the successor to today's `AlertRuleEvaluator` +
`ProjectThresholdWorker`, and it inherits **all** of their metric SQL unchanged.

Cadence tiers, chosen per rule from `evaluation_interval_seconds`:

| Tier | Interval | Driver | Typical rules |
|---|---|---|---|
| T1 | 5s | self-rescheduling ticker (`sendAfter`) | availability, 5xx rate on critical endpoints |
| T2 | 15s | ticker | error rate, latency p95 |
| T3 | 30s | ticker | latency p99, degraded rate |
| T4 | 60s | pg-boss cron `* * * * *` | traffic, logs, cron failures, inactivity |
| T5 | 300s | pg-boss cron `*/5 * * * *` | AI cost/credits, volume spike/drop, apdex |

pg-boss cron is minute-granular, so sub-minute tiers use a **self-rescheduling singleton**: the T1/T2/T3
worker finishes a tick and enqueues its own next run with `startAfter = <interval>` and a
`singletonKey` of `window-<tier>-<shard>`. That yields true 5s cadence without Redis and without a
process-local `setInterval` (which would not survive a restart).

Sharding: `WHERE hashtext(organization_id::text) % $shardCount = $shard`. Shard count is env-driven;
each shard is a separate singleton key so adding worker processes adds throughput without
double-evaluating a rule.

Metric registry (consolidates both current evaluators — nothing dropped):

| Metric | Source | Notes |
|---|---|---|
| `errors.count`, `errors.rate` | `events_errors`, `events_requests` | as today |
| `requests.count`, `requests.latency.avg/p95/p99`, `requests.error_rate`, `requests.degraded_rate`, `requests.inactivity_minutes` | `events_requests` | as today |
| `logs.error_count`, `logs.matches` | `events_logs` | log pattern normalized to `count >= 1`, `LIMIT` guard retained |
| `cron.failures` | `events_cron_checkins` | as today |
| `ai.requests.failed`, `ai.duration.p95`, `ai.credits.used`, `ai.cost.usd`, `ai.tokens.used` | `ai_usage_logs` | as today |
| `metrics.<name>` | `events_metrics` | avg/sum/count/max/min/p99 |
| `usage.total_events`, `usage.errors`, `usage.requests`, `usage.failed_notifications`, `usage.rate_limit_usage`, `usage.connector_deliveries` | `project_usage_minute` | **from `ProjectThresholdWorker`** |
| `apdex` | `events_requests` | from threshold worker (500ms/2000ms buckets) |
| `traffic.spike_pct`, `traffic.drop_pct` | `project_usage_minute` | current vs previous window |
| `failed_notification_rate`, `ingestion_error_rate`, `rate_limit_usage` | `project_usage_minute` | ratios, from threshold worker |

Per-tick algorithm:

1. Claim due rules for the shard (`enabled`, not deleted, watermark elapsed), oldest-first, bounded.
2. Group rules by `(metric, scope, lookback)` and issue **one** query per group rather than per rule —
   this is the key scalability change versus today's per-condition query. A group covers all rules
   that read the same metric over the same window for the same scope.
3. Evaluate predicates in memory against the group result.
4. Consecutive-breach counting and cooldown are preserved, but move out of
   `alert_rules.metadata` (a mutable JSONB write per rule per tick — a hot-row hazard at 5s cadence)
   into a dedicated `alert_rule_eval_state` row per (rule_id, binding_id, scope hash) in Log DB.
5. Emit `AlertCandidate`s → Policy Engine → `alert.decide`.
6. Advance the watermark only on success (unchanged fail-open semantics).

`alert_rule_eval_state` (LOGDB):

```sql
CREATE TABLE alert_rule_eval_state (
  scope_hash          VARCHAR(64) PRIMARY KEY,   -- sha256(rule_id:binding_id:scope tuple)
  organization_id     UUID NOT NULL,
  rule_id             UUID NOT NULL,
  binding_id          UUID,
  consecutive_breaches INTEGER NOT NULL DEFAULT 0,
  is_breaching        BOOLEAN NOT NULL DEFAULT FALSE,
  last_evaluated_at   TIMESTAMPTZ,
  last_fired_at       TIMESTAMPTZ,
  last_recovered_at   TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rule_eval_state_rule ON alert_rule_eval_state (rule_id);
```

This also removes the current write contention on `alert_rules` (which is otherwise a
read-mostly config table being written every tick).

## 4. Reconciliation (the old scheduled evaluator)

`alert.reconcile` runs every minute and is the safety net, not the primary path:

- Re-evaluates window rules whose watermark is older than 3× their interval (missed ticks).
- Finds `telemetry_outbox` rows with `published_at IS NULL AND created_at < now() - 5 min` and alarms.
- Closes orphaned `alert_event_state` rows stuck in `pending` beyond a threshold.
- Auto-resolves stale `firing` alerts (today's `alert.auto-resolve`, folded in).
- Recomputes recovery for rules whose breach state cleared while a worker was down.

Keeping this preserves today's guarantee that a worker restart cannot permanently lose an alert.

## 5. Recovery / no-loss matrix

| Failure | Consequence | Recovery |
|---|---|---|
| Ingestion tx rollback | no telemetry, no outbox row | nothing to recover (correct) |
| Crash after commit, before notify | outbox row unpublished | relay poll picks it up |
| Relay crash mid-publish | row published, not marked | re-published; dedup by `uq_alert_events_idem` |
| Fast engine crash | `telemetry.persisted` job retried (5×) | then `alert.dlq`; reconcile alarms |
| Window tier worker dies | tier singleton ticker stops | cron T4/T5 keep running; `alert.reconcile` re-evaluates stale watermarks and restarts the ticker |
| Decision engine crash mid-tx | tx rolls back | job retried; idempotency key prevents duplicates |
| Policy Engine exception | candidate fails | `alert.decide` never receives a partial policy; job retried; on repeated failure DLQ with the trace attached |

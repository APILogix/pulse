# ADR-0007 — Alert Decision Engine Responsibilities

Status: Proposed · Date: 2026-07-31 · Related: ADR-0002

## Context

`AlertBatchProcessor` currently does everything after an event is persisted as `pending`: authorization
re-check, routing-rule resolution, rule-action resolution, connector/route resolution, project
subscription and channel eligibility filtering, throttle evaluation, payload building, optional AI
enrichment, connector job enqueueing, delivery-attempt logging, escalation initialization, batch
bookkeeping, and status updates.

## Problem

1. It mixes policy, orchestration, persistence, and fan-out in one component, making it the riskiest
   file in the module to change.
2. Delivery outcome tracking is broken: attempts are recorded as `queued` and the true result lands in
   a different table in a different database with no join key.
3. Batch-level status updates mean a single event's failure is folded into a batch summary rather than
   an alert state machine.
4. There is no explicit alert state machine — statuses are set ad hoc in several places.
5. Nothing prevents a re-driven batch from double-notifying beyond the batch's own terminal-status
   guard.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Refactor the batch processor in place** | Rejected. The coupling is structural; incremental edits keep policy and transport in one file. |
| **B. Split into many small workers** (one queue per concern: dedup, cooldown, suppress, route) | Rejected. Each hop adds latency and a partial-failure state; dedup and state transition must be atomic, so splitting them would require distributed coordination. |
| **C. One Decision Engine performing mechanics only, consuming a pre-resolved policy** | **Chosen.** |

## Decision

The Decision Engine consumes `{ candidate, EffectiveAlertPolicy }` and performs **only mechanics**,
all inside **one Log DB transaction**:

1. Honour the policy decision (`drop` / `denied` / `suppress` / `delay`) — recording an event for
   auditability in every case, and never counting usage for suppressed, denied, or duplicate outcomes.
2. Fingerprint + deduplicate against `alert_event_state` (`SELECT … FOR UPDATE`).
3. Apply cooldown from the policy.
4. Advance the alert state machine
   (`pending → firing → acknowledged → resolved`, plus `suppressed`, `silenced`, `expired`, `error`).
5. Append `alert_events`, upsert `alert_event_state`, append `alert_event_history`.
6. Create `alert_notification_jobs` = `policy.channels × policy.recipients`, each with a unique
   idempotency key `sha256(alert_key : channel_kind : recipient_ref : escalation_step : attempt_epoch)`.
7. Append `alert_notification_ledger` (throttle accounting), `alert_metrics`, and `alert_usage_events`
   per `policy.usage`.

Then, **after commit**, publish `notification.route` (job ids only) and optionally `alert.correlate`.

It explicitly does **not**: resolve rules, thresholds, recipients, channels, connectors, entitlements,
quiet hours, maintenance windows, or escalation definitions. Those are already decided.

`expired` is introduced as a new terminal state so auto-resolve-by-TTL is distinguishable from a real
resolution; archival is partition detach, not a status.

## Consequences

Positive: atomic alert creation (event + jobs + usage are all-or-nothing); exactly-once notification by
construction via the unique idempotency key; per-alert state instead of batch summaries; `FOR UPDATE`
on one state row means contention is per alert key, not per organization; the component is small enough
to reason about and test.

Negative: a long-lived transaction per alert (bounded — all reads happen before it opens); the batch
abstraction is retained only for the legacy path during migration, so two paths coexist for a release;
`alert_event_state` becomes a hot table requiring index discipline.

## Migration Impact

Increment 5 introduces the engine behind `ALERTING_V2_READ`. During dual-write both the legacy batch
processor and the Decision Engine write their own runtime rows; the verification gates assert
`alert_notification_jobs` reconcile 1:1 with `connector_deliveries` terminal states and that no
`alert_generated` usage row exists for a suppressed or duplicate alert. Rollback is a flag flip; the
batch processor remains on disk and functional.

Existing API endpoints (acknowledge, resolve, silence-from-event, deliveries) keep their shapes; they
repoint from `alert_events` mutations to `alert_event_state` behind the same flag.

## Future Considerations

- The state machine is the natural place to add SLA timers (time-to-acknowledge, time-to-resolve).
- Once correlation matures, the Decision Engine can consult an open correlation group to suppress
  member notifications without changing its contract (the policy already carries the intent).
- If per-alert transactions ever become a throughput limit, batching *within one organization* is safe
  because idempotency keys are global, not per-transaction.

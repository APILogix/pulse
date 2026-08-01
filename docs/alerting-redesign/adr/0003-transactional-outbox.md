# ADR-0003 — Transactional Outbox in the Log DB with a One-Way Relay

Status: Proposed · Date: 2026-07-31

## Context

The ingestion worker persists telemetry into the Log DB `events_*` tables and increments usage.
Alerting learns about new telemetry only by polling those tables on a minute cron. pg-boss lives in the
**primary** database; telemetry lives in the **Log DB**.

## Problem

1. To react quickly, something must publish a job when telemetry is persisted.
2. Publishing before commit risks **phantom alerts** (alert for telemetry that rolled back).
3. Publishing after commit in a separate step risks **lost alerts** (crash between commit and publish).
4. pg-boss and telemetry are in different databases, so a naive "insert job in the same transaction"
   is impossible — PostgreSQL has no cross-database transaction.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Publish to pg-boss before/inside the telemetry write** | Rejected. Cross-DB, non-transactional, produces phantom alerts on rollback. |
| **B. Publish after commit, best effort** | Rejected. Loses alerts on crash between commit and publish — unacceptable for an alerting product. |
| **C. Move pg-boss into the Log DB** | Rejected. pg-boss is the queue for billing, auth, org, analytics, and ingestion; relocating it is a far larger blast radius than the problem warrants, and it would put queue churn on the telemetry database. |
| **D. Move telemetry into the primary DB** | Rejected. Destroys the Log DB separation the platform is built on and puts append-heavy partitioned telemetry on the control plane. |
| **E. Outbox table in the Log DB, committed with the telemetry write, drained by a relay that publishes to pg-boss** | **Chosen.** |
| **F. Postgres logical replication / `pg_logical` decoding of `events_*`** | Rejected for now. Operationally heavier, harder to filter to `fast_path` signals, and couples alerting to physical table layout. Noted as a future option. |

## Decision

- `telemetry_outbox` lives in the **Log DB** and is inserted in the **same transaction** as the
  `events_*` rows, using only rows the writer confirmed inserted (`ON CONFLICT DO NOTHING … RETURNING`).
  Rollback ⇒ no outbox row ⇒ no phantom alert.
- After commit, the worker issues `pg_notify('telemetry_outbox')` as a best-effort wake-up.
- The **Outbox Relay** (alerting worker) claims rows with `FOR UPDATE SKIP LOCKED`, publishes
  `telemetry.persisted` to pg-boss in the primary DB, then marks `published_at`. Crash between publish
  and mark ⇒ re-publish ⇒ absorbed by `uq_alert_events_idem` in the Decision Engine.
- Only `fast_path = TRUE` signals are relayed per-event. All other telemetry is aggregated into
  per-(org, project, signal) tick hints, so the outbox never becomes a 1:1 copy of telemetry.
- This relay is the **only** bridge between the two databases, and it is one-way and idempotent.

Delivery semantics: **at-least-once publication, exactly-once effect.**

## Consequences

Positive: no lost alerts, no phantom alerts, fast path is event-driven (200ms poll only as a safety
net), and the two-database boundary stays intact with a single, well-understood crossing point.

Negative: one more table and one more worker; the outbox needs partition maintenance and lag
monitoring; `fast_path` classification becomes a correctness-relevant decision (a signal wrongly
excluded is slow, not lost — reconciliation still catches it).

## Migration Impact

Additive: L2 creates the table; the ingestion change is guarded by `OUTBOX_ENABLED` (default off). With
the flag off the ingestion transaction is byte-for-byte today's behaviour. Turning it on starts
populating the outbox; the Fast Engine is enabled separately. Rollback is flag-off plus restart, and
unpublished rows are pruned by the partition manager.

## Future Considerations

- If outbox write amplification ever matters, switch `fast_path` rows to `UNLOGGED` staging plus
  synchronous relay, accepting the documented loss window only for non-critical signals.
- Logical decoding (option F) becomes attractive if a second consumer (e.g. real-time streaming to
  customers) needs the same feed.
- The same outbox pattern should be reused for any future "react to a write" requirement instead of
  adding more cross-DB publishes.

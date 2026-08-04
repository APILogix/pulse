# ADR-0006 — Log DB vs Primary DB Ownership

Status: Proposed · Date: 2026-07-31

## Context

The platform runs two PostgreSQL databases: the primary control plane and the Log DB. The audit found
the boundary is currently ambiguous for alerting and connectors:

- `alert_events`, `alert_delivery_attempts`, `alert_throttle_windows`, `connector_deliveries`,
  `connector_delivery_attempts` are each defined **twice** with incompatible schemas — a rich typed
  version in the control plane and a generic partitioned version in the Log DB.
- Application repositories use the **primary** pool for tables the current Log DB migrations create.
- Ingestion writes `events_*` via `logDB`, while the alert evaluator reads `events_*` via the primary
  pool. This only works when the Log DB falls back to `DATABASE_URL`.

## Problem

1. Nobody can state which database is authoritative for an alert event.
2. If `LOG_DB_PRIMARY` is ever a genuinely separate database, telemetry-driven alerting silently stops
   working (the evaluator queries a database with no telemetry).
3. If the runtime pool ever resolves the generic Log DB tables, alerting breaks silently: the code
   expects `fingerprint`, `created_at`, `correlation_id`, `event_ids`, and a `sent` status that the
   generic schema does not have.
4. Alert truth is split: `alert_delivery_attempts` says `queued` while the real outcome is in
   `connector_deliveries`, with no join key and no reconciliation.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Put everything in the primary DB** | Rejected. Puts append-heavy, partitioned, high-volume runtime data on the control plane; conflicts with the platform's Log DB strategy and retention design. |
| **B. Put everything in the Log DB** | Rejected. Configuration needs FKs to `organizations`/`projects`/`users`, transactional writes with billing, and mutability — none of which belongs in an append-oriented analytics store. |
| **C. Keep the current ambiguity and fix only the code** | Rejected. The defect is in the data model: two schemas share one name. Code cannot disambiguate that safely. |
| **D. Explicit split: primary owns configuration/identity, Log DB owns runtime/event data** | **Chosen.** |

## Decision

**Primary DB owns all mutable configuration and identity.** Organizations, projects, environments,
users, members, API keys; `alert_rules` + conditions + actions + **bindings** + **revisions**; routing
rules, notification routes, connector routes, **channel bindings**; silences and **maintenance
windows**; escalation policies and steps; templates; connector configs, credentials, secret versions,
OAuth states; all notification preferences; plans, features, entitlements, usage counters; the global
connector guards (`connector_rate_buckets`, `connector_circuit_state`); pg-boss.

**Log DB owns only runtime/event data, append-oriented.** Telemetry `events_*`; `telemetry_outbox`;
`alert_events`, `alert_event_history`, `alert_rule_executions`, `alert_rule_eval_state`,
`alert_acknowledgments`, `alert_notification_jobs`, `alert_notification_ledger`,
`alert_delivery_attempts`, `alert_dead_letter_events`, `alert_metrics`, `alert_usage_events`,
`alert_correlation_groups`, `alert_incidents`; `connector_deliveries`,
`connector_delivery_attempts`, `connector_health_checks`, `connector_test_runs`,
`connector_audit_logs`, `connector_dead_letters`.

Enforcing rules:

- **No repository may span both pools.** `AlertConfigRepository` (primary) and
  `AlertRuntimeRepository` (Log DB) are separate classes with separate injected pools.
- All telemetry reads use an injected `telemetryPool`. A boot-time assertion fails fast if the
  alerting runtime pool cannot see `events_requests` — this converts audit finding B1 from a silent
  failure into a startup crash.
- Runtime rows carry a `policy_snapshot` so history stays explainable after configuration is edited or
  deleted (there can be no cross-DB FK).
- Global guards live in the **primary** DB precisely because they must be transactional and global; a
  rate bucket in an append-oriented store would be wrong.

**One deliberate exception to append-only:** `alert_event_state` is a mutable projection holding the
current lifecycle state of an alert (status, ack, escalation cursor). An alert genuinely has a state
machine; modelling it as pure append would require folding history on every read of the hottest path
(dedup and escalation claims). It is narrow, carries the `updated_at` trigger, and is fully rebuildable
from `alert_events` + `alert_event_history`. Everything else in the Log DB is insert-only.

## Consequences

Positive: an unambiguous answer to "where does this live"; typed runtime schemas with real idempotency
constraints; no accidental cross-DB queries; retention by partition detach; the Log DB can scale
independently of the control plane.

Negative: no referential integrity between runtime and config (accepted, mitigated by snapshots); the
Decision Engine's transaction covers only Log DB writes, so config reads must happen before it opens;
two migration trees to keep in step; developers must know which pool a repository uses.

## Migration Impact

Executed via the `_v2` + view-swap strategy in the migration plan: create typed tables, dual-write,
verify with row-count and sampled content gates, swap names (leaving compatibility views), then drop
`_legacy` only in release N+3 after a full retention window with zero reads. Nothing is dropped in the
first three steps, so every stage is reversible.

## Future Considerations

- Read replicas for the Log DB to serve dashboards without competing with alert evaluation.
- If the Log DB is sharded per region, `organization_id` is already the natural shard key on every
  runtime table.
- A periodic integrity job should report runtime rows whose `rule_id`/`connector_id` no longer exist,
  as an operational signal rather than a constraint.

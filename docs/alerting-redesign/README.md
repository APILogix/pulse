# Pulse Alerting Platform — Enterprise Redesign

Status: **Architecture LOCKED. Implementation in progress — Increment 1 of 10 complete.**
See `PROGRESS.md` for the per-increment record and `09-implementation-status.md` for the baseline
audit of what existed before implementation started.

Constraints honoured throughout: **PostgreSQL + pg-boss only**. No Redis, no Kafka, no RabbitMQ.
Existing capabilities are preserved unless explicitly replaced by something superior; every removal
is recorded in `00-inconsistency-register.md` with its replacement.

## Documents

| Doc | Phase(s) | Contents |
|---|---|---|
| `00-inconsistency-register.md` | 1 | Every audit inconsistency, its resolution, and blast radius |
| `01-target-architecture.md` | 1, 2, 15 | Pipeline, separation of concerns, DB ownership matrix, queue topology |
| `02-data-model.md` | 1–4, 9–11, 14 | Full DDL design: rule bindings, outbox, runtime tables, channels, usage, correlation |
| `03-policy-engine.md` | 18 | Alert Policy Engine spec + immutable `EffectiveAlertPolicy` contract |
| `04-evaluation-engines.md` | 5, 6 | Fast engine, Window engine, transactional outbox, reconciliation |
| `05-decision-and-delivery.md` | 7, 8, 9, 12, 13 | Decision Engine, connector isolation, channel resolution, escalation, preferences |
| `06-entitlements-and-usage.md` | 10, 11 | Entitlement enforcement points, billing-safe usage ledger |
| `07-migration-plan.md` | 16 | Ordered migrations, rolling deploy, rollback, zero downtime |
| `08-implementation-plan.md` | 17 | Per-increment: modules, DB, workers, queues, API, rollback, scale, ops, tests |
| `09-implementation-status.md` | — | Honest audit of implementation state |
| `PROGRESS.md` | 17 | Per-increment execution record, verification, outstanding work, technical debt |
| `DEVIATIONS.md` | — | Deviations found during implementation (N = naming, D = design conflict) |
| `adr/` | 15 | 11 Architecture Decision Records |

## The redesigned pipeline

```text
Telemetry (SDK)
  ↓
Ingestion Worker            (never knows about alerts or connectors)
  ↓ persist events_* + telemetry_outbox  ← SAME transaction, Log DB
  ↓
Outbox Relay               (Log DB → pg-boss, at-least-once + idempotency key)
  ↓ telemetry.persisted
  ├─▶ Fast Evaluation Engine     (single-event, <500ms target)
  └─▶ Window Evaluation Engine   (rolling windows, 5s…300s tiers)
        ↓ AlertCandidate
  Alert Policy Engine       (LIBRARY: stateless, deterministic, cache-friendly)
        ↓ EffectiveAlertPolicy (immutable)
  Alert Decision Engine     (alert.decide worker: fingerprint, dedup, state machine, persist)
        ↓ NotificationJob
  Notification Router       (notification.route worker: job → transport queue)
        ↓
  Connector Workers         (connector.email | slack | discord | teams | pagerduty | webhook | sms)
        ↓                    TRANSPORT ONLY — no rules, no recipients, no routing
  Providers
        ↓ failure
  connector.retry → connector.dlq
```

## Non-negotiable invariants

1. Connector workers receive a `NotificationJob` and nothing else. They never query rules,
   recipients, routes, entitlements, or preferences.
2. Evaluation engines never resolve delivery. They emit an `AlertCandidate`.
3. Ingestion workers never reference the alerting or connectors modules.
4. Exactly one **effective** rule executes per (rule, scope) after inheritance resolution.
5. Nothing is published to a queue before the producing transaction commits.
6. Every downstream stage consumes only the `EffectiveAlertPolicy` — no re-querying business rules.
7. Suppressed alerts are never billed. Usage is only counted after the delivery decision.

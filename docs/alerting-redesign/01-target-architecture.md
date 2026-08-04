# Phases 1, 2, 15 — Target Architecture, Ownership Matrix, Queue Topology

## 1. Layer contract (separation of concerns)

Each layer has exactly one job and one input contract. Violating a contract is a build-breaking
review failure, enforced by module boundaries (no cross-imports) and an ESLint import rule.

| Layer | Input | Output | MUST NOT |
|---|---|---|---|
| Ingestion Worker | `IngestJobPayload` | `events_*` rows + `telemetry_outbox` rows | import alerting or connectors; evaluate rules; send notifications |
| Outbox Relay | `telemetry_outbox` rows | `telemetry.persisted` jobs | interpret telemetry semantics beyond routing keys |
| Fast Evaluation Engine | `telemetry.persisted` | `AlertCandidate` | resolve recipients, channels, connectors |
| Window Evaluation Engine | cron tick | `AlertCandidate` | resolve recipients, channels, connectors |
| **Alert Policy Engine** | `AlertCandidate` | `EffectiveAlertPolicy` (immutable) | evaluate telemetry; send; call providers; manage retries |
| Alert Decision Engine | `EffectiveAlertPolicy` | `alert_events` + `NotificationJob`s | re-resolve business rules |
| Notification Router | `NotificationJob` | transport-queue job | make policy decisions |
| Connector Worker | `NotificationJob` | provider call + delivery record | query rules, recipients, routing, entitlements |

`AlertCandidate` (what evaluators produce — deliberately dumb):

```ts
interface AlertCandidate {
  organizationId: string;
  projectId: string | null;
  environment: string | null;
  service: string | null;
  endpoint: string | null;
  ruleId: string | null;          // null for raw signal candidates (fast engine)
  signalKind: string;             // 'error' | 'cron_checkin' | 'error_rate' | 'latency_p95' | ...
  observedValue: number | null;
  thresholdHint: number | null;
  severityHint: AlertSeverity;
  occurredAt: Date;
  sourceEventIds: string[];
  evidence: Record<string, unknown>;  // window bounds, condition outcomes, sample payload
  idempotencyKey: string;             // deterministic; drives exactly-once decisioning
}
```

## 2. Process topology

Four process roles, each independently scalable. Roles map to existing npm scripts where possible.

| Process | Role | Registers |
|---|---|---|
| API (`start:prod`) | HTTP only | ingestion gateway, alerting/connector CRUD, entitlement guards |
| Ingestion worker (`start:ingestion`) | telemetry persistence | `ingest.*`, `ingest.dlq-intake`, `ingest.usage-rollup` |
| **Alerting worker (new role `alerting`)** | evaluation + decision + routing | `telemetry.persisted`, `alert.evaluate.fast`, `alert.evaluate.window`, `alert.decide`, `notification.route`, `alert.escalate`, `alert.reconcile`, `alert.correlate`, `alert.usage-rollup`, `alert.partition-maintenance` |
| Connector worker (new role `connectors`) | transport only | `connector.email|slack|discord|teams|pagerduty|webhook|sms`, `connector.retry`, `connector.dlq`, `connector.health`, `connector.oauth-refresh`, `connector.cleanup` |

Rationale for splitting alerting and connectors out of the single general worker: a connector
provider outage must not slow rule evaluation, and evaluation load must not starve delivery. The
existing general worker keeps billing/auth/analytics/org-cleanup.

## 3. Database ownership matrix (Phase 2 — final)

### Primary DB owns ALL mutable configuration and identity

| Domain | Tables |
|---|---|
| Identity/tenancy | `organizations`, `projects`, `project_environments`, `users`, `project_members`, `project_api_keys` |
| Rule definition | `alert_rules`, `alert_rule_conditions`, `alert_rule_actions`, **`alert_rule_bindings`** (new), **`alert_rule_revisions`** (new) |
| Thresholds | `project_alert_thresholds` (legacy, read-only during transition → folded into bindings) |
| Routing/policy config | `alert_routing_rules`, `notification_routes`, `connector_routes`, **`alert_channel_bindings`** (new) |
| Suppression config | `alert_silences`, **`alert_maintenance_windows`** (new, recurring) |
| Escalation config | `alert_escalation_policies`, `alert_escalation_steps` |
| Templates | `alert_templates` |
| Connector config | `connector_configs`, `connector_credentials`, `connector_secret_versions`, `connector_oauth_states` |
| Preferences | `project_notification_preferences`, `project_member_alert_channel_preferences`, `project_connector_subscriptions`, **`user_notification_preferences`** (new: vacation mode, temp mute) |
| Commerce | `plans`, `billing_features`, `plan_feature_entitlements`, `organization_feature_overrides`, `organization_subscriptions`, `organization_usage_current_period`, `usage_daily_counters` |
| Global runtime guards | **`connector_rate_buckets`**, **`connector_circuit_state`** (new; must be transactional + global) |
| Queue | `pgboss.*` |

### Log DB owns ONLY runtime/event data — append-oriented

| Domain | Tables |
|---|---|
| Telemetry | `events_errors`, `events_requests`, `events_logs`, `events_metrics`, `events_spans`, `events_traces`, `events_messages`, `events_profiles`, `events_replays`, `events_cron_checkins` |
| Outbox | **`telemetry_outbox`** (new) |
| Alert runtime | `alert_events` (append), **`alert_event_state`** (the single mutable projection), `alert_event_history`, `alert_rule_executions`, `alert_metrics`, `alert_acknowledgments`, **`alert_notification_ledger`** (replaces throttle windows), **`alert_notification_jobs`**, `alert_delivery_attempts`, `alert_dead_letter_events`, **`alert_usage_events`** |
| Correlation | **`alert_correlation_groups`**, **`alert_incidents`** |
| Connector runtime | `connector_deliveries`, `connector_delivery_attempts`, `connector_health_checks`, `connector_test_runs`, `connector_audit_logs`, **`connector_dead_letters`** |

Rules: no mutable configuration in Log DB; no cross-DB foreign keys; runtime rows carry a
`policy_snapshot` so history remains explainable after configuration changes or deletion.

**The one deliberate exception to "append-only":** `alert_event_state` holds the current lifecycle
state of an alert (status, ack, escalation cursor). An alert has a genuine state machine; modelling it
as pure append would force a fold on every read of a hot path. It is a narrow projection, carries the
`updated_at` trigger, and is rebuildable from `alert_events` + `alert_event_history`. See ADR-0006.

## 4. Queue topology (Phase 15 — final)

| Queue | Producer | Consumer | Concurrency | Priority | Singleton | Retry | Backoff | Expire | Dead-letter |
|---|---|---|---|---|---|---|---|---|---|
| `telemetry.persisted` | Outbox relay | Fast dispatcher | 16 / batch 20 | signal urgency | no | 5 | exp+jitter | 300s | `alert.dlq` |
| `alert.evaluate.fast` | Fast dispatcher | Fast engine | 16 / batch 10 | severity | no | 3 | exp | 120s | `alert.dlq` |
| `alert.evaluate.window` | cron tiers | Window engine | 8 / batch 1 | tier | per tier+shard | 2 | exp | 600s | `alert.dlq` |
| `alert.decide` | both engines | Decision engine | 12 / batch 10 | severity | no | 5 | exp+jitter | 900s | `alert.dlq` |
| `notification.route` | Decision engine | Router | 12 / batch 20 | severity | no | 5 | exp | 900s | `alert.dlq` |
| `connector.email` … `connector.sms` (7) | Router | Connector workers | per-provider env | `CONNECTOR_PRIORITY` | no | 0 (table-driven) | n/a | `CONNECTOR_SEND_EXPIRE_SECONDS` | `connector.dlq` |
| `connector.retry` | retry sweep | Dispatcher | 8 | severity | yes (sweep) | 0 | table-driven | 600s | `connector.dlq` |
| `connector.dlq` | any terminal failure | DLQ intake | 2 / batch 10 | — | no | 5 | exp | 3600s | — |
| `alert.escalate` | Decision engine + cron | Escalation worker | 8 | severity | yes (sweep) | 3 | exp | 600s | `alert.dlq` |
| `alert.correlate` | Decision engine | Correlation worker | 4 / batch 20 | — | no | 3 | exp | 300s | `alert.dlq` |
| `alert.reconcile` | cron `*/1` | Reconciliation (old scheduled evaluator) | 4 | low | yes | 2 | exp | 900s | `alert.dlq` |
| `alert.usage-rollup` | cron `*/1` | Usage rollup | 1 | low | yes | 3 | exp | 300s | — |
| `alert.partition-maintenance` | cron daily | Partition manager | 1 | low | yes | 3 | exp | 3600s | — |
| `alert.dlq` | any | DLQ intake | 2 | — | no | 5 | exp | 3600s | — |

Window tiers are separate schedules on `alert.evaluate.window` with `singletonKey =
window-<tier>-<shard>`: `5s`, `15s`, `30s` (driven by a self-rescheduling ticker because pg-boss cron
is minute-granular), `60s`, `300s` (native cron). Sharding is by `hashtext(organization_id) % N` so the
tier scales horizontally without double-evaluating a rule.

### Dependency graph

```text
ingest.<type> ──▶ events_* + telemetry_outbox (one tx)
                        │
              outbox relay (claim SKIP LOCKED)
                        ▼
              telemetry.persisted ──▶ alert.evaluate.fast ──┐
              cron tiers ──────────▶ alert.evaluate.window ─┤
                                                            ▼
                                              [Policy Engine library]
                                                            ▼
                                                     alert.decide
                                                     │        │
                                        notification.route   alert.escalate
                                                     │        │  alert.correlate
                                                     ▼        ▼
                                   connector.<provider> ×7
                                          │ fail
                                   connector.retry ──▶ connector.dlq
              alert.reconcile ──▶ (backstop: re-evaluates windows, closes orphans)
```

## 5. Latency budget (fast path, target <500ms end-to-end)

| Stage | Budget |
|---|---|
| Telemetry commit → outbox row visible | 0ms (same tx) |
| Outbox relay claim + publish | ≤50ms (200ms poll floor, `LISTEN/NOTIFY` wake-up) |
| `telemetry.persisted` pickup | ≤50ms |
| Fast engine match (config cache hit) | ≤30ms |
| Policy Engine resolve (in-process, cached) | ≤20ms |
| `alert.decide` persist + job creation | ≤100ms |
| `notification.route` → provider queue | ≤50ms |
| Connector send (provider RTT excluded) | ≤100ms |

The relay uses `pg_notify` on outbox insert so the fast path is event-driven, with a 200ms polling
floor as the safety net. No polling loop is the sole trigger for anything on the fast path.

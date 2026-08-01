# Phases 10, 11 — Entitlement Enforcement and Billing-Safe Usage

## 1. What already exists (do not rebuild)

The audit confirmed a complete, well-modelled commerce stack that is simply **not called**:

- `billing_features`, `plan_feature_entitlements`, `organization_feature_overrides`,
  `v_effective_entitlements`, `has_feature()`, `get_effective_integer_feature()`.
- Seeded alerting features: `alerting.enabled|rules|threshold|anomaly|composite|scheduled_mute|
  maintenance_windows|deduplication|escalation_policies|on_call|incident_timeline`,
  `ai.alert_prioritization`, `ai.alert_deduplication`, `integrations.email|slack|discord|
  microsoft_teams|webhook|pagerduty|opsgenie`, `quota.alert_rules`, `quota.notification_channels`,
  `quota.incidents`, `quota.integrations`.
- A working hard-limit engine: `billing/internal/service.ts adjustResource()` →
  `QUOTA_HARD_LIMIT` (409), exposed at `POST|DELETE /usage/resources`.

The redesign **wires** this rather than replacing it.

## 2. Missing feature keys (new seed migration)

| Feature key | Type | Behaviour | Reason |
|---|---|---|---|
| `quota.connectors` | integer | hard_limit | referenced by `RESOURCE_FEATURE_KEYS` but never seeded |
| `channels.sms` | boolean | none | SMS provider exists with no entitlement |
| `channels.managed_smtp` | boolean | none | gates Pulse-managed SMTP fallback |
| `quota.alerts_daily` | integer | throttle | "Daily Alert Limit" requirement |
| `quota.alerts_monthly` | integer | overage | "Monthly Alert Limit" requirement |
| `quota.notification_sends_monthly` | integer | overage | delivery-based billing |
| `alerting.fast_engine` | boolean | none | gate sub-second evaluation to paid tiers |
| `alerting.window_tier_seconds` | integer | none | minimum allowed cadence per plan (5/15/30/60/300) |

Plan values (seed, aligned with the existing ladder):

| Feature | Free | Starter | Growth | Business | Enterprise |
|---|---|---|---|---|---|
| `alerting.enabled` | false | true | true | true | true |
| `quota.alert_rules` | 5 | 10 | 50 | 250 | 1000 |
| `quota.connectors` | 1 | 3 | 10 | 50 | 500 |
| `quota.notification_channels` | 2 | 10 | 50 | 250 | 1000 |
| `quota.alerts_daily` | 50 | 500 | 5 000 | 50 000 | −1 (unlimited) |
| `quota.alerts_monthly` | 1 000 | 10 000 | 100 000 | 1 000 000 | −1 |
| `channels.sms` | false | false | false | true | true |
| `integrations.slack` | false | true | true | true | true |
| `integrations.webhook` | false | true | true | true | true |
| `integrations.pagerduty` | false | false | true | true | true |
| `channels.managed_smtp` | true | true | true | true | true |
| `alerting.fast_engine` | false | false | true | true | true |
| `alerting.window_tier_seconds` | 300 | 60 | 30 | 15 | 5 |
| `alerting.escalation_policies` | false | false | true | true | true |
| `alerting.composite` | false | false | true | true | true |
| `alerting.on_call` | false | false | false | true | true |
| `alerting.incident_timeline` | false | false | false | true | true |

`channels.managed_smtp = true` on Free is deliberate: a free org must still be able to receive its
own alerts by email, otherwise the 19 default presets are useless (audit finding D6). Free is limited
by `quota.alerts_daily`, not by having no transport.

## 3. Enforcement points (three layers, fail-closed at write, fail-open never for money)

### Layer 1 — API write path (reject immediately)

| Operation | Check | Error |
|---|---|---|
| `POST /alerting/rules`, `…/rules/templates/:key` | `alerting.enabled` + `alerting.rules` + `quota.alert_rules` | 403 `FEATURE_NOT_AVAILABLE` / 409 `QUOTA_HARD_LIMIT` |
| rule uses composite conditions | `alerting.composite` | 403 |
| rule sets `evaluation_interval_seconds` below plan floor | `alerting.window_tier_seconds` | 422 with the allowed minimum |
| `POST /connectors` | `quota.connectors` + `integrations.<provider>` | 403 / 409 |
| `POST /alerting/escalation-policies` | `alerting.escalation_policies` | 403 |
| `POST` silence/maintenance window | `alerting.maintenance_windows` / `alerting.scheduled_mute` | 403 |
| `POST` channel binding | `quota.notification_channels` + `channels.<kind>` | 403 / 409 |

Implementation: a single `AlertEntitlementGuard` Fastify preHandler wrapping the existing
`batchCheckEntitlements` pattern already proven in the automation module, plus a call to the existing
`adjustResource(+1)` inside the same transaction as the insert. On rollback the counter rolls back too,
which is why it must be transactional rather than a separate HTTP call to `/usage/resources`.

Counter decrement on delete (`adjustResource(-1)`) fixes the drift the audit implies (`connectors_used`
never written at all today).

### Layer 2 — Policy Engine (stage 10, per alert)

Runs on cached entitlements; never queries per alert in steady state.

- Channel-level: drop channels whose `integrations.*` / `channels.*` feature is false, recording the
  reason in the trace and in `policy.entitlement.deniedChannels`.
- Volume-level: `quota.alerts_daily` / `quota.alerts_monthly` are read from the usage counters. When
  exhausted, behaviour depends on `usage_behavior`:
  - `hard_limit` → `decision = 'denied'` (event recorded, nothing sent, nothing billed)
  - `throttle` → only `critical`/`error` severities pass
  - `overage` → deliver and bill overage
- If every channel is denied → `decision = 'denied'` with reason `entitlement`.

Critical-path safety: an entitlement lookup failure **must not** silently deliver or silently drop. The
resolver returns `unknown`, which is treated as *allow for `critical` severity, deny otherwise*, and
raises a metric. This is a deliberate, documented asymmetry: never lose a critical page over a billing
read, never leak paid channels to free orgs at scale.

### Layer 3 — Connector worker (last-resort guard)

The worker verifies only that the job's `connectorId` belongs to the job's `organizationId` and that
the connector is active. It does **not** evaluate entitlements (that would violate connector
isolation). This is a tenancy guard, not a policy guard.

## 4. Usage accounting (Phase 11)

### What is counted, and when

| Counter | Counted at | Billable | Notes |
|---|---|---|---|
| `alert_generated` | Decision Engine step 12 (after fire decision) | yes | only for `kind='fired'` |
| `alert_suppressed` | suppression path | **no** | requirement: never charge suppressed |
| duplicates | dedup path | **no** | folded into `duplicate_count` |
| `alert_delivered` | connector worker on provider success | yes | per notification job |
| `alert_failed` | connector worker terminal failure | **no** | failures are not sold |
| `connector_send` | per provider call | yes | one per job, not per attempt |
| `delivery_retry` | per retry attempt | **no** | requirement: retries ignored |
| `email_sent` / `slack_message` / `sms_sent` / `webhook_call` / `discord_message` / `teams_message` / `pagerduty_event` | connector worker success | yes | channel-specific for per-channel pricing |

Nothing is counted before the delivery decision, which is exactly why `alert_generated` is written in
the Decision Engine **after** suppression/dedup/entitlement branches, not at candidate creation.

### Pipeline

```text
alert_usage_events (LOGDB, append-only, unique idempotency_key)
   ↓ alert.usage-rollup (cron 1m, singleton)
   ↓ aggregate billable rows → usage_counter_staging (PRIMARY, counter_type 'billing:alerts:*')
   ↓ existing flush_usage_counters() / increment_event_usage()
   ↓ organization_usage_current_period + usage_daily_counters
```

Atomicity and transactional guarantees:
- The ledger insert is inside the Decision Engine's Log DB transaction (alerts) or the connector's
  delivery transaction (deliveries) — so a usage row cannot exist for an alert that was rolled back.
- The rollup mirrors the ingestion rollup that the audit verified: `DELETE … RETURNING` inside a
  transaction, staging preserved on failure, so a crash re-processes rather than loses.
- `uq_alert_usage_idem` makes the rollup safe against at-least-once redelivery.

New counter columns on `usage_daily_counters` and `organization_usage_current_period`:
`alerts_generated`, `alerts_delivered`, `notification_sends`, `emails_sent`, `slack_messages`,
`sms_sent`, `webhook_calls`, `alerts_suppressed` (recorded for analytics, `billable=false`).

## 5. Observability of enforcement

Every denial is observable, because silent denials are the worst failure mode for alerting:

- `alert_events(kind='suppressed')` with `policy_snapshot.trace` naming the exact stage and feature key.
- Prometheus counters: `alert_policy_denied_total{reason,feature_key}`,
  `alert_quota_exhausted_total{feature_key}`, `alert_channel_unavailable_total{channel,reason}`.
- An org-visible API (`GET /alerting/policy-decisions`) returns recent denials so a customer can see
  "your Slack alert was not sent because your plan does not include Slack" instead of silence.

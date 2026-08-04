# ADR-0010 — Usage Metering and Entitlement Enforcement Strategy

Status: Proposed · Date: 2026-07-31

## Context

The audit verified a complete commerce stack: `billing_features`, `plan_feature_entitlements`,
`organization_feature_overrides`, `v_effective_entitlements`, `has_feature()`,
`get_effective_integer_feature()`, seeded alerting/integration/quota features, and a working
hard-limit engine (`adjustResource()` → `QUOTA_HARD_LIMIT` 409) exposed at `/usage/resources`.

It also verified that **none of it is called** from the alerting or connectors modules, that nothing is
metered when an alert is generated or delivered, and that `alert_rules_used` / `connectors_used` are
never written. `quota.connectors` is referenced in code but never seeded; there is no SMS feature key
and no daily/monthly alert limit.

## Problem

1. Plans are unenforceable: a Free organization (where `alerting.enabled = false`) can create unlimited
   rules and connectors and receive unlimited notifications.
2. No revenue signal exists for the most expensive part of the product (outbound notifications, SMS in
   particular).
3. Enforcing limits naively would immediately break existing customers who are already over their plan.
4. Metering at the wrong point would charge for suppressed alerts, duplicates, and retries.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Count at candidate creation** | Rejected. Charges for alerts that are then suppressed, deduplicated, or denied. Directly violates "never charge for suppressed alerts". |
| **B. Count in the connector worker only** | Rejected. Loses "alerts generated" entirely, and retries would inflate counts unless carefully excluded. |
| **C. Count synchronously in the billing tables from the hot path** | Rejected. Puts control-plane writes on the alert path and creates contention on one row per organization. |
| **D. Append-only usage ledger in the Log DB, rolled up into existing billing counters** | **Chosen.** |

## Decision

### Metering points

| Counter | Written where | Billable |
|---|---|---|
| `alert_generated` | Decision Engine, **after** suppression/dedup/cooldown/entitlement branches | yes |
| `alert_suppressed` | suppression path (recorded for analytics) | **no** |
| duplicates | dedup path (`duplicate_count++`) | **no** |
| `alert_delivered`, `connector_send`, `email_sent`, `slack_message`, `sms_sent`, `webhook_call`, `discord_message`, `teams_message`, `pagerduty_event` | connector worker on provider success | yes |
| `alert_failed` | connector worker terminal failure | **no** |
| `delivery_retry` | each retry attempt | **no** |

Nothing is counted before the delivery decision, which is why `alert_generated` is written in the
Decision Engine transaction rather than by the evaluators.

### Mechanism

`alert_usage_events` (Log DB, append-only, partitioned, `uq_alert_usage_idem`) is written inside the
same transaction as the alert (Decision Engine) or the delivery (connector worker). A cron
`alert.usage-rollup` aggregates billable rows into the **existing** `usage_counter_staging`
(`billing:alerts:*`), which the proven `flush_usage_counters()` / `increment_event_usage()` path already
drains transactionally with staging preserved on failure. Reusing that machinery rather than inventing
a second rollup is deliberate.

### Enforcement, in three layers

1. **API write path** — `AlertEntitlementGuard` checks feature booleans and integer quotas, and calls a
   new **transactional** `adjustResourceTx(+1)` inside the same transaction as the insert (so a rolled
   back create cannot leak a counter). Deletes decrement.
2. **Policy Engine stage 10** — per-alert channel entitlements and daily/monthly volume limits, read
   from the 30s config cache. `hard_limit` → `denied`; `throttle` → only `critical`/`error` pass;
   `overage` → deliver and bill.
3. **Connector worker** — tenancy check only (connector belongs to the job's organization and is
   active). Never entitlements, to preserve connector isolation.

### Fail-mode asymmetry (deliberate)

If an entitlement read fails, the resolver returns `unknown`, which **allows `critical` severity and
denies everything else**, and raises a metric. Rationale: never lose a critical page because of a
billing read, and never leak paid channels at scale. This asymmetry is documented rather than emergent.

### Rollout without breaking customers

`ENTITLEMENTS_ENFORCED` ships in **report-only** mode: every would-be denial is logged and counted but
nothing is blocked. Overage is quantified per organization, plans/overrides are adjusted or customers
are notified, and only then is enforcement switched on.

### Missing keys added

`quota.connectors`, `channels.sms`, `channels.managed_smtp`, `quota.alerts_daily`,
`quota.alerts_monthly`, `quota.notification_sends_monthly`, `alerting.fast_engine`,
`alerting.window_tier_seconds`.

## Consequences

Positive: plans become real; per-channel counters enable SMS/notification-based pricing; suppressed,
duplicate, failed, and retried work is never billed; the ledger is auditable and replay-safe;
report-only mode makes enforcement non-breaking.

Negative: one more ledger table and rollup job; usage is eventually consistent (up to ~1 minute), so
limits can be exceeded slightly at the boundary (accepted — the alternative is synchronous counters on
the hot path); denial paths must be observable or customers experience silence, hence the required
metrics and the `GET /alerting/policy-decisions` endpoint.

## Migration Impact

P9–P11 add feature keys, plan values, and counter columns (all additive, idempotent upserts). L4 adds
the ledger. Increment 9 wires enforcement in report-only mode. Rollback is returning the flag to
report-only; the ledger keeps accruing harmlessly and can be truncated.

## Future Considerations

- Prepaid notification credit pools, mirroring the existing AI credit model.
- Cost attribution per project/team from the same ledger (the columns already exist).
- Soft-limit warnings at 80% via the alerting platform itself (dogfooding).
- Per-channel unit pricing driven by the ledger's channel-specific counters.

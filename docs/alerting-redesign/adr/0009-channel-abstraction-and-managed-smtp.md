# ADR-0009 — Channel Abstraction and Managed SMTP Fallback

Status: Proposed · Date: 2026-07-31

## Context

`alert_rule_actions` binds an action directly to a `connector_id` and/or `route_id`.
`AlertBatchProcessor.isDeliverAction()` requires one of them to be non-null for an action to deliver.
The 19 seeded default presets create a `notify` action with `action_conditions = {channel: 'in_app',
audience: 'org_members'}` and **no** connector or route.

## Problem

1. Out of the box, the default presets can never deliver externally: the action has no connector, so
   `isDeliverAction()` is false and the event either produces nothing or ends in `error`. Every new
   organization gets 19 rules that look configured but cannot notify.
2. Rules break when a connector is deleted (`ON DELETE SET NULL` silently disables delivery).
3. A rule cannot express intent ("page me on Slack") independently of infrastructure ("connector
   `abc-123`"), so rules cannot be templated, shared across projects, or inherited cleanly.
4. There is no fallback: if the Slack connector is missing, nothing is sent and nothing explains why.
5. There is no platform-provided transport, so an organization with zero connectors is unreachable.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Keep connector ids on actions, require setup wizards** | Rejected. Does not fix inheritance (a child scope would inherit a connector id that may not apply), nor default-preset delivery, nor fallback. |
| **B. Introduce connector groups** (action → group → connectors) | Partially good, but a group is still infrastructure. It does not express "email" as an intent, and plan-based gating would sit awkwardly on groups. |
| **C. Rules request abstract channel kinds; the Policy Engine resolves transport** | **Chosen.** |

## Decision

Rules request **channels**, never connectors.

- `notification_channel_kind ∈ {in_app, email, slack, discord, teams, pagerduty, webhook, sms}`,
  defined identically in both databases so payloads translate 1:1.
- Bindings carry `requested_channels` (e.g. `["slack","email"]`).
- `alert_channel_bindings` (primary, org/project scoped) maps a channel kind to a concrete
  `connector_id`, or to `use_managed_fallback`, with `priority` and an optional
  `fallback_channel_kind`.
- The Policy Engine's Channel + Connector Resolution stages produce an ordered, concrete channel plan.

Resolution chain (per channel):

```text
email     → active email connector (org SMTP)  → else managed SMTP (if entitled) → else unavailable
slack     → active slack connector             → else fallback_channel_kind (if policy allows) → else unavailable
pagerduty → entitlement integrations.pagerduty → active connector → else denied/unavailable
```

**Managed SMTP** is a platform-operated transport used when an organization has no email connector. It
is gated by a new `channels.managed_smtp` entitlement which is granted on **every** plan including
Free — because otherwise the default presets remain undeliverable, which is the actual defect. Volume is
controlled by `quota.alerts_daily`, not by withholding transport.

Legacy `alert_rule_actions.connector_id` / `route_id` are **retained** (nullable, deprecated) for one
release; the backfill derives `requested_channels` from each connector's provider so current delivery
targets are unchanged.

## Consequences

Positive: default presets deliver on day one; rules survive connector deletion and rotation; rules
become portable across projects and inheritable (a channel intent is scope-independent, a connector id
is not); fallback chains are explicit and explainable; plan gating attaches naturally to channel kinds;
a new provider needs no rule changes.

Negative: one more indirection to understand and to render in the UI; managed SMTP means the platform
now sends on behalf of customers, which brings deliverability, SPF/DKIM, reputation, and abuse concerns;
misconfigured priority could route to an unexpected connector (mitigated by the policy trace).

## Migration Impact

Additive. P4 creates `alert_channel_bindings`; P13 backfills one binding per existing connector plus a
managed-SMTP email binding for every organization lacking an email connector. Because the backfill
derives channels from existing connector providers, resolution yields the same connectors that are
used today — verified by the Policy Engine shadow-mode diff on connector-set equality before cutover.
Rollback deletes the backfilled bindings; actions still carry their connector ids.

## Future Considerations

- Managed Slack app and managed webhook signing as additional platform transports.
- Per-channel rendering templates keyed by `channel_kind` rather than `connector_type`.
- Deliverability controls for managed SMTP: dedicated IP pools, bounce/complaint handling, and
  automatic downgrade to `in_app` for repeatedly bouncing addresses.
- Abuse protection: managed SMTP must be rate-limited per organization independently of connector
  limits.

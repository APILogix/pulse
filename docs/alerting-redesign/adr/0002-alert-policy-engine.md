# ADR-0002 — Alert Policy Engine as an In-Process Library

Status: Proposed · Date: 2026-07-31

## Context

Business policy is currently scattered. `AlertBatchProcessor` resolves routing rules, rule actions,
connector routes, project subscriptions, channel eligibility, throttling, and escalation
initialization — inside the same component that also performs delivery fan-out. The evaluator decides
cooldown and dedup. Entitlements are decided nowhere. Connector workers implicitly participate by
holding provider knowledge.

## Problem

1. No single place answers "why was this alert delivered to these people on these channels?"
2. Business rules are re-queried at multiple stages, so a config change mid-flight can produce
   inconsistent behaviour within one alert.
3. Delivery components cannot be tested without a database full of rules.
4. Adding entitlements, inheritance, quiet hours, or correlation means editing the batch processor
   again, which is already the largest and riskiest file in the module.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Keep logic in the batch processor, add cases** | Rejected. Compounds the existing coupling; the file already mixes policy, orchestration, and transport. |
| **B. Policy Engine as its own pg-boss queue** (`alert.policy.resolve`) | Rejected for the fast path. Adds a claim+publish+poll hop (~100–200ms p99) to a 500ms budget, plus a new failure surface, for a component that is pure. Also absent from the agreed queue topology. |
| **C. Policy Engine as a database function / SQL view** | Rejected. Inheritance folding, quiet-hour timezone math, and fallback chains are awkward and untestable in SQL; caching would be impossible. |
| **D. Stateless in-process library invoked by both engines** | **Chosen.** |

## Decision

`modules/alerting/policy/` exposes `AlertPolicyEngine.resolve(candidate) → EffectiveAlertPolicy`.

- Pure: no writes, no provider calls, no queue publication.
- Deterministic: output depends only on `(candidate, config snapshot, injected clock)`.
  `policyId = sha256(resolved content)` makes two resolutions comparable.
- Twelve ordered stages: rule → threshold → scope → actions → maintenance → correlation → recipients
  → channels → connectors → entitlements → usage → escalation.
- Returns a deeply frozen object plus a `trace[]` of every stage decision, persisted on the alert
  event as `policy_snapshot`.
- Config is read through a per-org snapshot cache keyed by `(organizationId, config_version)`, TTL 30s.
- Maintenance is evaluated **before** recipients so suppressed alerts cost nothing and are provably
  non-billable.

Boundary is preserved by construction rather than by process isolation: the engine has no DB write
capability and no transport dependency injected, so it *cannot* send or persist even by mistake.

## Consequences

Positive: one auditable answer per alert; downstream stages become mechanical; policy is unit-testable
with plain fixtures; `POST /alerting/policy/simulate` gives support a dry-run tool; caching makes
per-alert config cost ~zero at millions of events/day.

Negative: "library" means the boundary is enforced by review + lint rather than by a network hop; a
slow policy resolution directly adds to evaluator latency (bounded by the 20ms budget and cache);
cache staleness up to 30s for config edits (acceptable, and bypassed by `config_version` bump).

## Migration Impact

Increment 3 ships the engine in **shadow mode**: it resolves a policy for every live alert and logs a
structured diff against the legacy batch-processor decision, while delivery still uses the legacy
path. A 24-hour zero-diff window on connector-set equality gates cutover (verification gate 6 in the
migration plan). Removing the shadow hook is a one-line rollback.

## Future Considerations

- If policy resolution ever needs to be shared with a non-Node service, promote it to an internal RPC
  while keeping the same `EffectiveAlertPolicy` contract.
- AI prioritization plugs in as an additional stage that may only *annotate* (`ai_priority_score`),
  never override entitlement or maintenance outcomes.
- The `trace[]` is the natural input for a future "explain this alert" UI.

# ADR-0004 — Rule Inheritance via Scope Bindings

Status: Proposed · Date: 2026-07-31

## Context

`alert_rules` has a single nullable `project_id`. A rule is therefore either organization-wide
(`NULL`) or bound to exactly one project. `project_alert_thresholds` separately carries a nullable
`environment_id`. There is no service or endpoint scope anywhere, and no code that layers scopes.

## Problem

Verified in the audit:

1. One rule cannot target multiple projects.
2. A project cannot **disable** an inherited organization rule.
3. A project cannot **override** an organization threshold; it can only create an unrelated second
   rule — and then *both* evaluate and *both* can fire.
4. An org-wide rule aggregates across all projects, so one noisy project can mask another, and an
   opted-out project still contributes to the aggregate.
5. No environment/service/endpoint precision.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Widen `alert_rules`** with `environment`, `service`, `endpoint`, `parent_rule_id`, `mode` | Rejected. Conflates *definition* with *scope behaviour*; one rule would need N duplicated rows per scope, and "disable at project A" would still require a sentinel row that looks like a real rule. |
| **B. Copy-on-override** (materialize a child rule per project) | Rejected. Duplicates definitions, so an org-level threshold edit silently fails to reach children; exactly the duplicate-evaluation problem the brief forbids. |
| **C. Generic policy documents** (JSONB rule trees) | Rejected. Loses relational validation, indexing, and the existing normalized conditions/actions that already work well. |
| **D. Separate `alert_rule_bindings` table carrying scope + mode + sparse overrides** | **Chosen.** |

## Decision

The rule **definition** stays in `alert_rules` / `alert_rule_conditions` / `alert_rule_actions`
(organization-owned). Scope behaviour moves to `alert_rule_bindings`:

- `scope_type ∈ {organization, project, environment, service, endpoint}` with a matching
  `scope_level ∈ 0..4`, and a CHECK constraint enforcing the correct shape per level.
- `mode ∈ {inherit, override, disable}`; `action_mode ∈ {inherit, merge, replace}`.
- Sparse overrides: `NULL` means inherit, so a binding only states what it changes
  (`severity`, `cooldown_seconds`, `consecutive_breaches`, `threshold_overrides` JSONB keyed by
  condition `field_path`, `requested_channels`, `recipient_overrides`, `escalation_policy_id`).
- Unique index on `(rule_id, scope_type, project_id, environment, service, endpoint)`
  `NULLS NOT DISTINCT WHERE deleted_at IS NULL` — one live binding per scope.

**Effective Rule Resolution:** select prefix-matching bindings for the evaluation context, order by
`scope_level ASC`, fold deepest-wins per field, apply `disable` (re-enablable by a deeper
`override, enabled=true`), then tie-break at equal depth by `priority DESC`, `scope_level DESC`,
`created_at ASC`. The result is **exactly one** effective rule; parents are never evaluated separately.

## Consequences

Positive: satisfies the brief's example precisely (org 5% → A disable → B 2% → prod 1% → `/payment`
0.5% yields only the 0.5% rule); one rule serves many scopes without duplication; org-level edits
propagate automatically; scope ladder extends to service/endpoint; resolution is O(≤5) and cacheable.

Negative: reading "what will fire for project X" now requires resolution rather than a single row —
mitigated by `GET /rules/:id/effective` returning the resolved rule plus trace; a new concept for
users to learn; equal-depth ties need documented, deterministic rules (they are).

## Migration Impact

Behaviour-preserving by design. The backfill creates one `organization/inherit` binding for every
org-wide rule and one `project/override` binding for every project-scoped rule, which resolves to
exactly today's semantics. **No customer sees a change until they create a new binding.** Rollback is
`DELETE FROM alert_rule_bindings WHERE notes = 'backfill:v2'`. Legacy `alert_rules.project_id` remains
populated and is only deprecated (comment) in release N+2, never dropped in this plan.

## Future Considerations

- Team-scoped bindings (`scope_type = 'team'`) slot in as level 1.5 if teams become first-class.
- Tag/label-selector scoping (`service =~ pattern`) as an alternative to exact service matching.
- Rule dependencies (suppress B while A is firing) are deliberately out of scope here and are modelled
  as composite rules in ADR-0007's correlation layer instead of as binding relationships.

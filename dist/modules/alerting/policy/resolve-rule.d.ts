/**
 * Effective Rule Resolution (pure).
 *
 * Architecture: docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *               docs/alerting-redesign/02-data-model.md §1
 *               docs/alerting-redesign/03-policy-engine.md §3 (stages 1–3)
 *
 * ADR-0004 defines the algorithm this file implements, verbatim:
 *
 *   1. Select all live bindings of the rule whose scope tuple is a PREFIX MATCH of the
 *      evaluation context. Order by scope_level ASC.
 *   2. Fold in order, deepest wins per field. NULL means "inherit", so it never overwrites.
 *   3. mode='disable' sets enabled=false. A DEEPER binding with mode='override',
 *      enabled=true re-enables it.
 *   4. action_mode: inherit keeps parent actions, merge unions parent+child, replace
 *      discards parent actions.
 *   5. Tie-break at equal depth: higher priority, then scope_level DESC, then created_at ASC.
 *   6. The result is ONE effective rule. The evaluator never evaluates the parent copy again.
 *
 * Product rule: an organization binding is a subscribable catalog rule for projects. It
 * applies to organization-scope evaluation, but a project is not forced into it unless it
 * has its own matching project/environment/service/endpoint binding. Use mode='inherit'
 * for a plain project subscription.
 *
 * This module is PURE: no database, no clock, no environment. That is what makes rule
 * inheritance testable as a truth table rather than as an integration scenario.
 */
import type { AlertRuleRow, AlertRuleConditionRow, AlertSeverity } from '../rules/rules.types.js';
export type AlertScopeType = 'organization' | 'project' | 'environment' | 'service' | 'endpoint';
export type AlertBindingMode = 'inherit' | 'override' | 'disable';
export type AlertActionMergeMode = 'inherit' | 'merge' | 'replace';
/** Precedence ladder. Higher wins. Mirrors alert_rule_bindings.scope_level. */
export declare const SCOPE_LEVEL: Readonly<Record<AlertScopeType, 0 | 1 | 2 | 3 | 4>>;
/** A row of alert_rule_bindings. */
export interface AlertRuleBindingRow {
    id: string;
    organization_id: string;
    rule_id: string;
    scope_type: AlertScopeType;
    scope_level: number;
    project_id: string | null;
    environment: string | null;
    service: string | null;
    endpoint: string | null;
    mode: AlertBindingMode;
    enabled: boolean;
    priority: number;
    severity: AlertSeverity | null;
    cooldown_seconds: number | null;
    deduplication_window_seconds: number | null;
    auto_resolve_after_minutes: number | null;
    evaluation_interval_seconds: number | null;
    consecutive_breaches: number | null;
    threshold_overrides: Record<string, unknown>;
    action_mode: AlertActionMergeMode;
    requested_channels: string[] | null;
    recipient_overrides: Record<string, unknown> | null;
    escalation_policy_id: string | null;
    notes: string | null;
    created_at: Date;
    deleted_at: Date | null;
}
/** The scope an evaluation is happening in. Absent fields mean "not scoped that deep". */
export interface EvaluationScope {
    organizationId: string;
    projectId?: string | null;
    environment?: string | null;
    service?: string | null;
    endpoint?: string | null;
}
/** One step of the resolution, retained so any decision can be explained. */
export interface RuleResolutionTraceEntry {
    bindingId: string | null;
    scopeType: AlertScopeType;
    scopeLevel: number;
    mode: AlertBindingMode | 'base';
    applied: string[];
    note?: string;
}
export interface EffectiveRule {
    ruleId: string;
    organizationId: string;
    /** The deepest binding that contributed, or null when only the rule's own values applied. */
    bindingId: string | null;
    resolvedScopeType: AlertScopeType;
    resolvedScopeLevel: number;
    enabled: boolean;
    severity: AlertSeverity;
    cooldownSeconds: number;
    deduplicationWindowSeconds: number;
    evaluationIntervalSeconds: number;
    autoResolveAfterMinutes: number | null;
    consecutiveBreaches: number;
    /** Conditions with `threshold_overrides` applied by field_path. */
    conditions: AlertRuleConditionRow[];
    /** Channel kinds requested by the winning scope chain. */
    requestedChannels: string[];
    actionMode: AlertActionMergeMode;
    recipientOverrides: Record<string, unknown> | null;
    escalationPolicyId: string | null;
    trace: RuleResolutionTraceEntry[];
}
/**
 * Whether a binding's scope tuple is a prefix match of the evaluation context.
 *
 * Organization always matches. Deeper scopes match only when the context specifies the
 * same value — a binding for `environment='production'` does not apply to an evaluation
 * with no environment, and never applies to a different environment.
 */
export declare function bindingMatchesScope(binding: AlertRuleBindingRow, scope: EvaluationScope): boolean;
/**
 * Deterministic ordering for the fold: shallowest first so deeper scopes overwrite.
 *
 * Equal depth is possible (e.g. two `service` bindings on the same project cannot both
 * match, but a `service` and an `endpoint` binding can tie after filtering). ADR-0004 §5
 * fixes the tie-break so resolution never depends on row order from the database.
 */
export declare function compareBindings(a: AlertRuleBindingRow, b: AlertRuleBindingRow): number;
/**
 * Resolve exactly one effective rule for an evaluation scope.
 *
 * @param rule       the rule definition (organization-owned)
 * @param conditions the rule's conditions, in order
 * @param bindings    every binding for this rule; non-matching and soft-deleted rows are
 *                    filtered here so callers may pass the raw query result
 * @param scope      the evaluation context
 */
export declare function resolveEffectiveRule(rule: AlertRuleRow, conditions: AlertRuleConditionRow[], bindings: AlertRuleBindingRow[], scope: EvaluationScope): EffectiveRule;
/**
 * True when two equal-depth bindings tied and the tie-break had to decide.
 * Surfaced so `alert_binding_conflicts_total` can be incremented by the caller.
 */
export declare function hasEqualDepthConflict(bindings: AlertRuleBindingRow[], scope: EvaluationScope): boolean;
//# sourceMappingURL=resolve-rule.d.ts.map
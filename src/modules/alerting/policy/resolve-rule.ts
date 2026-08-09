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
import type {
  AlertRuleRow,
  AlertRuleConditionRow,
  AlertSeverity,
} from '../rules/rules.types.js';

export type AlertScopeType = 'organization' | 'project' | 'environment' | 'service' | 'endpoint';
export type AlertBindingMode = 'inherit' | 'override' | 'disable';
export type AlertActionMergeMode = 'inherit' | 'merge' | 'replace';

/** Precedence ladder. Higher wins. Mirrors alert_rule_bindings.scope_level. */
export const SCOPE_LEVEL: Readonly<Record<AlertScopeType, 0 | 1 | 2 | 3 | 4>> = {
  organization: 0,
  project: 1,
  environment: 2,
  service: 3,
  endpoint: 4,
};

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

export interface EffectiveRuleResolutionOptions {
  /** Runtime evaluation requires an explicit project binding for project scopes. */
  requireProjectSubscription?: boolean;
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
export function bindingMatchesScope(
  binding: AlertRuleBindingRow,
  scope: EvaluationScope,
): boolean {
  if (binding.organization_id !== scope.organizationId) return false;
  if (binding.project_id !== null && binding.project_id !== (scope.projectId ?? null)) return false;
  if (binding.environment !== null && binding.environment !== (scope.environment ?? null)) return false;
  if (binding.service !== null && binding.service !== (scope.service ?? null)) return false;
  if (binding.endpoint !== null && binding.endpoint !== (scope.endpoint ?? null)) return false;
  return true;
}

/**
 * Deterministic ordering for the fold: shallowest first so deeper scopes overwrite.
 *
 * Equal depth is possible (e.g. two `service` bindings on the same project cannot both
 * match, but a `service` and an `endpoint` binding can tie after filtering). ADR-0004 §5
 * fixes the tie-break so resolution never depends on row order from the database.
 */
export function compareBindings(a: AlertRuleBindingRow, b: AlertRuleBindingRow): number {
  if (a.scope_level !== b.scope_level) return a.scope_level - b.scope_level;
  if (a.priority !== b.priority) return b.priority - a.priority;
  const at = a.created_at instanceof Date ? a.created_at.getTime() : new Date(a.created_at).getTime();
  const bt = b.created_at instanceof Date ? b.created_at.getTime() : new Date(b.created_at).getTime();
  if (at !== bt) return at - bt;
  return a.id.localeCompare(b.id);
}

function applyThresholdOverrides(
  conditions: AlertRuleConditionRow[],
  overrides: Record<string, unknown>,
): AlertRuleConditionRow[] {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return conditions;
  return conditions.map((condition) =>
    Object.prototype.hasOwnProperty.call(overrides, condition.field_path)
      ? { ...condition, threshold_value: overrides[condition.field_path] }
      : condition,
  );
}

/**
 * Resolve exactly one effective rule for an evaluation scope.
 *
 * @param rule       the rule definition (organization-owned)
 * @param conditions the rule's conditions, in order
 * @param bindings    every binding for this rule; non-matching and soft-deleted rows are
 *                    filtered here so callers may pass the raw query result
 * @param scope      the evaluation context
 */
export function resolveEffectiveRule(
  rule: AlertRuleRow,
  conditions: AlertRuleConditionRow[],
  bindings: AlertRuleBindingRow[],
  scope: EvaluationScope,
  options: EffectiveRuleResolutionOptions = {},
): EffectiveRule {
  const matching = bindings
    .filter((binding) => binding.deleted_at === null && bindingMatchesScope(binding, scope))
    .sort(compareBindings);
  const requiresProjectSubscription = Boolean(scope.projectId)
    && !matching.some((binding) => binding.scope_level > SCOPE_LEVEL.organization)
    && (options.requireProjectSubscription === true
      || matching.some((binding) => binding.scope_type === 'organization'));

  // Start from the rule's own values. A rule with no bindings resolves to exactly the
  // behaviour it has today — this is what makes the P12 backfill behaviour-identical.
  const effective: EffectiveRule = {
    ruleId: rule.id,
    organizationId: rule.organization_id,
    bindingId: null,
    resolvedScopeType: 'organization',
    resolvedScopeLevel: 0,
    enabled: rule.enabled,
    severity: rule.severity,
    cooldownSeconds: rule.cooldown_seconds,
    deduplicationWindowSeconds: rule.deduplication_window_seconds,
    evaluationIntervalSeconds: rule.evaluation_interval_seconds,
    autoResolveAfterMinutes: rule.auto_resolve_after_minutes,
    consecutiveBreaches: toConsecutiveBreaches(rule),
    conditions,
    requestedChannels: [],
    actionMode: 'inherit',
    recipientOverrides: null,
    escalationPolicyId: null,
    trace: [{
      bindingId: null,
      scopeType: 'organization',
      scopeLevel: 0,
      mode: 'base',
      applied: ['rule defaults'],
      note: `rule "${rule.name}"`,
    }],
  };

  let thresholdOverrides: Record<string, unknown> = {};

  for (const binding of matching) {
    const applied: string[] = [];

    // Step 3: disable stops the rule here; a deeper override may re-enable it.
    if (binding.mode === 'disable') {
      effective.enabled = false;
      applied.push('enabled=false (disable)');
    } else if (binding.mode === 'override') {
      if (effective.enabled !== binding.enabled) applied.push(`enabled=${binding.enabled}`);
      effective.enabled = binding.enabled;
    }

    // Step 2: sparse scalar overrides — NULL never overwrites.
    if (binding.severity !== null) { effective.severity = binding.severity; applied.push('severity'); }
    if (binding.cooldown_seconds !== null) {
      effective.cooldownSeconds = binding.cooldown_seconds; applied.push('cooldownSeconds');
    }
    if (binding.deduplication_window_seconds !== null) {
      effective.deduplicationWindowSeconds = binding.deduplication_window_seconds;
      applied.push('deduplicationWindowSeconds');
    }
    if (binding.evaluation_interval_seconds !== null) {
      effective.evaluationIntervalSeconds = binding.evaluation_interval_seconds;
      applied.push('evaluationIntervalSeconds');
    }
    if (binding.auto_resolve_after_minutes !== null) {
      effective.autoResolveAfterMinutes = binding.auto_resolve_after_minutes;
      applied.push('autoResolveAfterMinutes');
    }
    if (binding.consecutive_breaches !== null) {
      effective.consecutiveBreaches = binding.consecutive_breaches;
      applied.push('consecutiveBreaches');
    }

    // Threshold overrides accumulate per field_path, deepest scope winning each key.
    const overrideKeys = Object.keys(binding.threshold_overrides ?? {});
    if (overrideKeys.length > 0) {
      thresholdOverrides = { ...thresholdOverrides, ...binding.threshold_overrides };
      applied.push(`thresholds[${overrideKeys.join(',')}]`);
    }

    // Step 4: action/channel merge semantics.
    if (binding.action_mode !== 'inherit') {
      effective.actionMode = binding.action_mode;
      applied.push(`actionMode=${binding.action_mode}`);
    }
    if (binding.requested_channels !== null) {
      effective.requestedChannels = binding.action_mode === 'merge'
        ? [...new Set([...effective.requestedChannels, ...binding.requested_channels])]
        : [...binding.requested_channels];
      applied.push('requestedChannels');
    }
    if (binding.recipient_overrides !== null) {
      effective.recipientOverrides = binding.action_mode === 'merge' && effective.recipientOverrides
        ? { ...effective.recipientOverrides, ...binding.recipient_overrides }
        : { ...binding.recipient_overrides };
      applied.push('recipientOverrides');
    }
    if (binding.escalation_policy_id !== null) {
      effective.escalationPolicyId = binding.escalation_policy_id;
      applied.push('escalationPolicyId');
    }

    // Step 6: the deepest contributing binding identifies the resolved scope.
    effective.bindingId = binding.id;
    effective.resolvedScopeType = binding.scope_type;
    effective.resolvedScopeLevel = binding.scope_level;

    effective.trace.push({
      bindingId: binding.id,
      scopeType: binding.scope_type,
      scopeLevel: binding.scope_level,
      mode: binding.mode,
      applied,
    });
  }

  if (requiresProjectSubscription) {
    effective.enabled = false;
    effective.bindingId = null;
    effective.resolvedScopeType = 'project';
    effective.resolvedScopeLevel = SCOPE_LEVEL.project;
    effective.trace.push({
      bindingId: null,
      scopeType: 'project',
      scopeLevel: SCOPE_LEVEL.project,
      mode: 'disable',
      applied: ['enabled=false (project not subscribed)'],
      note: options.requireProjectSubscription === true
        ? 'runtime evaluation requires a matching project subscription binding'
        : 'organization rule requires a matching project subscription binding',
    });
  }

  effective.conditions = applyThresholdOverrides(conditions, thresholdOverrides);
  return effective;
}

/**
 * Consecutive-breach count carried on the rule today.
 *
 * Preserves the existing evaluator contract: `metadata.consecutiveBreachesRequired` first,
 * then `annotations.consecutiveBreaches`, else 1.
 */
function toConsecutiveBreaches(rule: AlertRuleRow): number {
  const fromMetadata = (rule.metadata ?? {})['consecutiveBreachesRequired'];
  const fromAnnotations = (rule.annotations ?? {})['consecutiveBreaches'];
  for (const candidate of [fromMetadata, fromAnnotations]) {
    const value = typeof candidate === 'number'
      ? candidate
      : typeof candidate === 'string' ? Number(candidate) : NaN;
    if (Number.isInteger(value) && value >= 1) return value;
  }
  return 1;
}

/**
 * True when two equal-depth bindings tied and the tie-break had to decide.
 * Surfaced so `alert_binding_conflicts_total` can be incremented by the caller.
 */
export function hasEqualDepthConflict(
  bindings: AlertRuleBindingRow[],
  scope: EvaluationScope,
): boolean {
  const matching = bindings
    .filter((binding) => binding.deleted_at === null && bindingMatchesScope(binding, scope));
  const seen = new Set<number>();
  for (const binding of matching) {
    if (seen.has(binding.scope_level)) return true;
    seen.add(binding.scope_level);
  }
  return false;
}

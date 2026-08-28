import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_PRESETS } from '../../src/modules/alerting/evaluator/presets.js';
import { AlertCatalogSnapshot, tierForFieldPath, type RuntimeRuleRow } from '../../src/modules/alerting/runtime/rule-catalog.js';
import { SCOPE_LEVEL, type AlertRuleBindingRow } from '../../src/modules/alerting/policy/resolve-rule.js';
import type { AlertRuleConditionRow } from '../../src/modules/alerting/rules/rules.types.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const PROJECT = '00000000-0000-4000-8000-000000000002';
const RULE = '00000000-0000-4000-8000-000000000003';

function runtimeRule(overrides: Partial<RuntimeRuleRow> = {}): RuntimeRuleRow {
  const now = new Date();
  return {
    id: RULE,
    organization_id: ORG,
    name: 'Fatal exception',
    description: null,
    severity: 'critical',
    enabled: true,
    evaluation_interval_seconds: 1,
    cooldown_seconds: 300,
    auto_resolve_after_minutes: 60,
    deduplication_window_seconds: 3600,
    deduplication_key_template: '{{rule_id}}',
    grouping_enabled: false,
    grouping_key_template: null,
    grouping_wait_seconds: 300,
    labels: {},
    annotations: {},
    metadata: {},
    created_by: '00000000-0000-4000-8000-000000000004',
    updated_by: null,
    enabled_at: now,
    disabled_at: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    project_id: null,
    preset_key: 'fatal_exception_fast',
    is_default: false,
    last_evaluated_at: null,
    current_revision: 1,
    ...overrides,
  };
}

function condition(): AlertRuleConditionRow {
  return {
    id: '00000000-0000-4000-8000-000000000005',
    rule_id: RULE,
    condition_type: 'threshold',
    condition_group_id: null,
    field_path: 'errors.fatal',
    operator: 'eq',
    threshold_value: true,
    lookback_minutes: 0,
    aggregate_function: null,
    is_required: true,
    order_index: 0,
    created_at: new Date(),
  };
}

function binding(projectId = PROJECT): AlertRuleBindingRow {
  return {
    id: '00000000-0000-4000-8000-000000000006',
    organization_id: ORG,
    rule_id: RULE,
    scope_type: 'project',
    scope_level: SCOPE_LEVEL.project,
    project_id: projectId,
    environment: null,
    service: null,
    endpoint: null,
    mode: 'inherit',
    enabled: true,
    priority: 100,
    severity: null,
    cooldown_seconds: null,
    deduplication_window_seconds: null,
    auto_resolve_after_minutes: null,
    evaluation_interval_seconds: null,
    consecutive_breaches: null,
    threshold_overrides: {},
    action_mode: 'inherit',
    requested_channels: null,
    recipient_overrides: null,
    escalation_policy_id: null,
    notes: null,
    created_at: new Date(),
    deleted_at: null,
  };
}

describe('alert runtime rule catalog', () => {
  /**
   * Preset-set integrity.
   *
   * The hard-coded count (was 35) went stale as presets were added and this test
   * failed for months while asserting nothing useful. What actually matters is
   * that preset keys are UNIQUE and that every preset is classifiable into a
   * runtime tier - a duplicate key silently overwrites a rule during seeding, and
   * an unclassifiable preset is never evaluated by any tier. Both are asserted
   * against the live array rather than a magic number, so adding a preset no
   * longer breaks the suite.
   */
  it('keeps every default preset key unique', () => {
    const keys = DEFAULT_ALERT_PRESETS.map((preset) => preset.presetKey);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(duplicates).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
    // Sanity floor: the catalog should never silently empty out.
    expect(keys.length).toBeGreaterThanOrEqual(35);
  });

  /**
   * Field-path classification must never CONTRADICT a preset's declared tier.
   *
   * How the two interact: `listRulesForTier()` selects a rule when
   * `evaluation_category` matches OR the field path prefix matches. So a preset
   * with an explicit category still works even if its path is unregistered
   * (`tierForFieldPath` → null). That is tolerated.
   *
   * What is NOT tolerated is a path that resolves to a DIFFERENT tier than the
   * preset declares - that means the rule can be picked up by two tiers reading
   * two different data sources, so it either double-fires or reads a payload that
   * has no such field.
   */
  it('never derives a tier that contradicts a preset declared category', () => {
    const conflicts = DEFAULT_ALERT_PRESETS
      .map((preset) => ({
        key: preset.presetKey,
        fieldPath: preset.condition.fieldPath,
        declared: preset.evaluationCategory === 'fast' ? 'fast' : 'analytics',
        derived: tierForFieldPath(preset.condition.fieldPath),
      }))
      // null is acceptable (evaluation_category carries the rule); a non-null
      // disagreement is not.
      .filter((row) => row.derived !== null
        && (row.derived === 'fast' ? 'fast' : 'analytics') !== row.declared);

    expect(conflicts, `presets whose field path contradicts their category: ${JSON.stringify(conflicts)}`)
      .toEqual([]);
  });

  it('registers every FAST preset field path in the tier prefix map', () => {
    // Fast-tier paths must be registered, because inferEvaluationCategory()
    // defaults an unregistered path to 'analytics'. A user-created rule on such a
    // path would land on the window tier, whose rollup tables have no such
    // column, so hasRelevantMetrics would skip it and the rule would never fire.
    // Analytics paths are exempt: 'analytics' is already the default, so an
    // unregistered analytics path still routes correctly.
    const unregistered = DEFAULT_ALERT_PRESETS
      .filter((preset) => preset.evaluationCategory === 'fast')
      .filter((preset) => tierForFieldPath(preset.condition.fieldPath) !== 'fast')
      .map((preset) => `${preset.presetKey} (${preset.condition.fieldPath})`);

    expect(unregistered, `fast presets missing from TIER_FIELD_PREFIXES.fast: ${unregistered.join(', ')}`)
      .toEqual([]);
  });

  it('classifies instant event dependencies', () => {
    expect(tierForFieldPath('errors.unhandled')).toBe('fast');
    expect(tierForFieldPath('errors.fatal')).toBe('fast');
    expect(tierForFieldPath('logs.oom')).toBe('fast');
    expect(tierForFieldPath('cron.failed')).toBe('fast');
    expect(tierForFieldPath('logs.security')).toBe('fast');
    expect(tierForFieldPath('heartbeat.lost')).toBe('fast');
    expect(tierForFieldPath('deployment.failed')).toBe('fast');
    expect(tierForFieldPath('connector.failure')).toBe('fast');
  });

  it('classifies short-window rollup dependencies', () => {
    expect(tierForFieldPath('errors.rate')).toBe('window');
    expect(tierForFieldPath('requests.5xx_rate')).toBe('window');
    expect(tierForFieldPath('requests.latency.p95')).toBe('window');
    expect(tierForFieldPath('ai.requests.failed')).toBe('window');
    expect(tierForFieldPath('cron.failure_rate')).toBe('window');
    expect(tierForFieldPath('ai.failure_rate')).toBe('window');
  });

  it('classifies operational and expensive AI dependencies', () => {
    expect(tierForFieldPath('metrics.cpu.usage')).toBe('operational');
    expect(tierForFieldPath('metrics.memory.usage')).toBe('operational');
    expect(tierForFieldPath('queue.backlog')).toBe('operational');
    expect(tierForFieldPath('service.health')).toBe('operational');
    expect(tierForFieldPath('endpoint.health')).toBe('operational');
    expect(tierForFieldPath('ai.cost.usd')).toBe('ai');
    expect(tierForFieldPath('ai.credits.used')).toBe('ai');
  });

  it('requires a matching project subscription before runtime evaluates an org rule', () => {
    const snapshot = new AlertCatalogSnapshot(
      ORG,
      'fast',
      [runtimeRule()],
      new Map([[RULE, [condition()]]]),
      new Map([[RULE, []]]),
    );

    expect(snapshot.resolveRulesForScope({ organizationId: ORG, projectId: PROJECT })).toEqual([]);
  });

  it('does not evaluate org-level rules for project when not subscribed', () => {
    const snapshot = new AlertCatalogSnapshot(
      ORG,
      'fast',
      [runtimeRule({ is_default: true })],
      new Map([[RULE, [condition()]]]),
      new Map([[RULE, []]]),
    );

    const resolved = snapshot.resolveRulesForScope({ organizationId: ORG, projectId: PROJECT });
    expect(resolved).toHaveLength(0);
  });

  it('returns the effective rule when a project is subscribed by binding', () => {
    const snapshot = new AlertCatalogSnapshot(
      ORG,
      'fast',
      [runtimeRule()],
      new Map([[RULE, [condition()]]]),
      new Map([[RULE, [binding()]]]),
    );

    const resolved = snapshot.resolveRulesForScope({ organizationId: ORG, projectId: PROJECT });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.effective.bindingId).toBe(binding().id);
    expect(resolved[0]?.effective.conditions[0]?.field_path).toBe('errors.fatal');
  });
});

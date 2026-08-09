import { describe, expect, it } from 'vitest';
import { evaluateRule } from '../../src/modules/alerting/evaluator.js';
import { SCOPE_LEVEL, resolveEffectiveRule, type AlertRuleBindingRow } from '../../src/modules/alerting/policy/resolve-rule.js';
import type { AlertRuleConditionRow, AlertRuleRow } from '../../src/modules/alerting/rules/rules.types.js';

const organizationId = '11111111-1111-1111-1111-111111111111';
const projectA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const projectB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const projectC = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const rule = {
  id: '99999999-9999-4999-8999-999999999999',
  organization_id: organizationId,
  name: 'High error rate',
  description: null,
  severity: 'error',
  enabled: true,
  evaluation_interval_seconds: 60,
  cooldown_seconds: 600,
  auto_resolve_after_minutes: 30,
  deduplication_window_seconds: 3600,
  deduplication_key_template: null,
  grouping_enabled: false,
  grouping_key_template: null,
  grouping_wait_seconds: 300,
  labels: {},
  annotations: {},
  metadata: {},
  created_by: 'user-1',
  updated_by: null,
  enabled_at: null,
  disabled_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
  deleted_at: null,
  project_id: null,
  preset_key: 'high_error_rate',
  is_default: true,
  last_evaluated_at: null,
} as AlertRuleRow;

const condition = {
  id: '88888888-8888-4888-8888-888888888888',
  rule_id: rule.id,
  condition_type: 'threshold',
  condition_group_id: null,
  field_path: 'errors.rate',
  operator: 'gte',
  threshold_value: 5,
  lookback_minutes: 5,
  aggregate_function: null,
  sub_query: {},
  is_required: true,
  order_index: 0,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
} as AlertRuleConditionRow;

function binding(
  id: string,
  projectId: string,
  mode: 'inherit' | 'override' | 'disable',
  thresholdOverrides: Record<string, unknown> = {},
): AlertRuleBindingRow {
  return {
    id,
    organization_id: organizationId,
    rule_id: rule.id,
    scope_type: 'project',
    scope_level: SCOPE_LEVEL.project,
    project_id: projectId,
    environment: null,
    service: null,
    endpoint: null,
    mode,
    enabled: mode !== 'disable',
    priority: 100,
    severity: null,
    cooldown_seconds: null,
    deduplication_window_seconds: null,
    auto_resolve_after_minutes: null,
    evaluation_interval_seconds: null,
    consecutive_breaches: null,
    threshold_overrides: thresholdOverrides,
    action_mode: 'inherit',
    requested_channels: null,
    recipient_overrides: null,
    escalation_policy_id: null,
    notes: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    deleted_at: null,
  };
}

describe('canonical alerting acceptance scenario', () => {
  it('isolates inherited, overridden, and disabled project behavior', () => {
    const bindings = [
      binding('binding-a', projectA, 'inherit'),
      binding('binding-b', projectB, 'override', { 'errors.rate': 2 }),
      binding('binding-c', projectC, 'disable'),
    ];
    const evaluate = (projectId: string, errorRate: number): boolean => {
      const effective = resolveEffectiveRule(
        rule,
        [condition],
        bindings,
        { organizationId, projectId },
        { requireProjectSubscription: true },
      );
      if (!effective.enabled) return false;
      return evaluateRule({ errors: { rate: errorRate } }, effective.conditions.map((item) => ({
        id: item.id,
        conditionGroupId: item.condition_group_id,
        fieldPath: item.field_path,
        operator: item.operator,
        thresholdValue: item.threshold_value,
        isRequired: item.is_required,
      }))).matched;
    };

    expect(evaluate(projectA, 3)).toBe(false);
    expect(evaluate(projectB, 3)).toBe(true);
    expect(evaluate(projectC, 10)).toBe(false);
    expect(rule).toMatchObject({ severity: 'error' });
    expect(condition.threshold_value).toBe(5);
  });
});

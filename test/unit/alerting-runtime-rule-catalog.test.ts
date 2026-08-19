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
  it('keeps the canonical default runtime preset set at 35 rules', () => {
    const keys = DEFAULT_ALERT_PRESETS.map((preset) => preset.presetKey);
    expect(keys).toHaveLength(35);
    expect(new Set(keys).size).toBe(35);
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

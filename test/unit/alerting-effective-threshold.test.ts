/**
 * Increment 2 — threshold resolution (ADR-0005: thresholds as a rule layer).
 *
 * Architecture: docs/alerting-redesign/adr/0005-effective-rule-and-threshold-resolution.md
 *               docs/alerting-redesign/02-data-model.md §2
 *
 * The mapping asserted here is what the P14 backfill will rely on, so a wrong entry would
 * silently lose a customer's configured threshold. Every one of the 13 seeded threshold keys
 * is covered.
 */
import { describe, expect, it } from 'vitest';
import {
  THRESHOLD_PRESET_MAP,
  mapComparisonOperator,
  resolveAllEffectiveThresholds,
  resolveEffectiveThreshold,
  translateLegacyThreshold,
  type LegacyThresholdRow,
} from '../../src/modules/alerting/policy/resolve-threshold.js';
import type { EffectiveRule } from '../../src/modules/alerting/policy/resolve-rule.js';
import type { AlertRuleConditionRow } from '../../src/modules/alerting/rules/rules.types.js';

/** The 13 keys seeded per project by 04_projects/012. */
const SEEDED_THRESHOLD_KEYS = [
  'latency_p50', 'latency_p75', 'latency_p90', 'latency_p95', 'latency_p99',
  'error_rate', 'apdex', 'event_volume_spike', 'event_volume_drop',
  'failed_notification_rate', 'ingestion_error_rate', 'rate_limit_usage', 'ai_usage_cost',
] as const;

function condition(fieldPath: string, threshold: unknown, extra: Partial<AlertRuleConditionRow> = {}) {
  return {
    id: `cond-${fieldPath}`,
    rule_id: 'rule-1',
    condition_type: 'threshold',
    condition_group_id: null,
    field_path: fieldPath,
    operator: 'gte',
    threshold_value: threshold,
    lookback_minutes: 5,
    aggregate_function: null,
    sub_query: {},
    is_required: true,
    order_index: 0,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...extra,
  } as AlertRuleConditionRow;
}

function effectiveRule(conditions: AlertRuleConditionRow[], overrides: Partial<EffectiveRule> = {}): EffectiveRule {
  return {
    ruleId: 'rule-1',
    organizationId: 'org-1',
    bindingId: null,
    resolvedScopeType: 'organization',
    resolvedScopeLevel: 0,
    enabled: true,
    severity: 'error',
    cooldownSeconds: 600,
    deduplicationWindowSeconds: 3600,
    evaluationIntervalSeconds: 60,
    autoResolveAfterMinutes: 30,
    consecutiveBreaches: 1,
    conditions,
    requestedChannels: [],
    actionMode: 'inherit',
    recipientOverrides: null,
    escalationPolicyId: null,
    trace: [],
    ...overrides,
  };
}

function legacyRow(overrides: Partial<LegacyThresholdRow> = {}): LegacyThresholdRow {
  return {
    id: 'threshold-1',
    organization_id: 'org-1',
    project_id: 'project-1',
    environment_id: null,
    threshold_key: 'error_rate',
    metric_name: 'error_rate',
    severity: 'error',
    comparison_operator: '>=',
    threshold_value: '5.00000',
    evaluation_window_minutes: 5,
    cooldown_minutes: 15,
    consecutive_breaches: 1,
    enabled: true,
    ...overrides,
  };
}

describe('threshold preset mapping (ADR-0005)', () => {
  it.each(SEEDED_THRESHOLD_KEYS)('maps seeded key %s', (key) => {
    const mapping = THRESHOLD_PRESET_MAP[key];
    expect(mapping, `threshold_key "${key}" must be mapped or the backfill loses it`).toBeDefined();
    expect(mapping!.presetKey.length).toBeGreaterThan(0);
    expect(mapping!.fieldPath.length).toBeGreaterThan(0);
  });

  it('covers every seeded key and adds none that are unseeded by accident', () => {
    expect(Object.keys(THRESHOLD_PRESET_MAP).sort()).toEqual([...SEEDED_THRESHOLD_KEYS].sort());
  });

  it('flags only the percentiles the evaluator cannot yet compute', () => {
    const flagged = Object.entries(THRESHOLD_PRESET_MAP)
      .filter(([, m]) => m.requiresEngineSupport)
      .map(([key]) => key)
      .sort();

    expect(flagged).toEqual(['latency_p50', 'latency_p75', 'latency_p90']);
  });

  it('routes p95/p99 to field paths the evaluator already supports', () => {
    expect(THRESHOLD_PRESET_MAP.latency_p95!.fieldPath).toBe('requests.latency.p95');
    expect(THRESHOLD_PRESET_MAP.latency_p99!.fieldPath).toBe('requests.latency.p99');
    expect(THRESHOLD_PRESET_MAP.latency_p95!.requiresEngineSupport).toBeUndefined();
  });
});

describe('comparison operator mapping', () => {
  it.each([
    ['>', 'gt'], ['>=', 'gte'], ['<', 'lt'], ['<=', 'lte'], ['=', 'eq'], ['!=', 'neq'],
  ])('%s → %s', (input, expected) => {
    expect(mapComparisonOperator(input)).toBe(expected);
  });

  it('returns null for an unknown operator rather than guessing', () => {
    expect(mapComparisonOperator('~')).toBeNull();
  });
});

describe('legacy threshold translation (P14 backfill contract)', () => {
  it('maps every documented field exactly as ADR-0005 specifies', () => {
    const translated = translateLegacyThreshold(legacyRow({
      threshold_value: '2.5', cooldown_minutes: 15,
      consecutive_breaches: 3, evaluation_window_minutes: 10,
    }));

    expect(translated.presetKey).toBe('high_error_rate');
    expect(translated.thresholdOverrides).toEqual({ 'errors.rate': 2.5 });
    expect(translated.cooldownSeconds).toBe(900);      // 15 * 60
    expect(translated.consecutiveBreaches).toBe(3);
    expect(translated.lookbackMinutes).toBe(10);
    expect(translated.operator).toBe('gte');
    expect(translated.unmapped).toBe(false);
  });

  it('uses project scope when environment_id is null and environment scope otherwise', () => {
    expect(translateLegacyThreshold(legacyRow({ environment_id: null })).scopeType).toBe('project');
    expect(translateLegacyThreshold(legacyRow({ environment_id: 'env-1' })).scopeType).toBe('environment');
  });

  it('translates a disabled threshold into mode=disable, not a dropped row', () => {
    const translated = translateLegacyThreshold(legacyRow({ enabled: false }));

    expect(translated.mode).toBe('disable');
    expect(translated.enabled).toBe(false);
    // The value is still carried, so re-enabling restores the original threshold.
    expect(translated.thresholdOverrides).toEqual({ 'errors.rate': 5 });
  });

  it('parses NUMERIC values returned by pg as strings', () => {
    const translated = translateLegacyThreshold(legacyRow({ threshold_value: '0.85000' }));
    expect(translated.thresholdOverrides).toEqual({ 'errors.rate': 0.85 });
  });

  it('reports an unmapped threshold_key instead of silently producing an empty override', () => {
    const translated = translateLegacyThreshold(legacyRow({ threshold_key: 'something_new' }));

    expect(translated.unmapped).toBe(true);
    expect(translated.presetKey).toBe('');
    expect(translated.thresholdOverrides).toEqual({});
  });

  it('marks percentile keys as needing engine support', () => {
    expect(translateLegacyThreshold(legacyRow({ threshold_key: 'latency_p90' })).requiresEngineSupport)
      .toBe(true);
    expect(translateLegacyThreshold(legacyRow({ threshold_key: 'latency_p95' })).requiresEngineSupport)
      .toBe(false);
  });
});

describe('effective threshold read-out', () => {
  it('returns the resolved condition for a field path', () => {
    const rule = effectiveRule([condition('errors.rate', 0.5)], {
      cooldownSeconds: 120, consecutiveBreaches: 2,
    });

    const threshold = resolveEffectiveThreshold(rule, 'errors.rate');

    expect(threshold).toEqual({
      fieldPath: 'errors.rate',
      operator: 'gte',
      value: 0.5,
      lookbackMinutes: 5,
      aggregateFunction: null,
      consecutiveBreaches: 2,
      cooldownSeconds: 120,
      enabled: true,
    });
  });

  it('returns null for an unconfigured metric (never zero)', () => {
    const rule = effectiveRule([condition('errors.rate', 5)]);
    expect(resolveEffectiveThreshold(rule, 'requests.latency.p95')).toBeNull();
  });

  it('propagates enabled=false from a disabled effective rule', () => {
    const rule = effectiveRule([condition('errors.rate', 5)], { enabled: false });
    expect(resolveEffectiveThreshold(rule, 'errors.rate')!.enabled).toBe(false);
  });

  it('yields exactly one threshold per field path for a composite rule', () => {
    const rule = effectiveRule([
      condition('errors.rate', 1),
      condition('requests.latency.p95', 2000),
    ]);

    const all = resolveAllEffectiveThresholds(rule);

    expect(all).toHaveLength(2);
    expect(all.map((t) => t.fieldPath)).toEqual(['errors.rate', 'requests.latency.p95']);
    // One value per path — the duplicate-evaluation problem ADR-0005 removes.
    expect(new Set(all.map((t) => t.fieldPath)).size).toBe(all.length);
  });

  it('carries the aggregate function through', () => {
    const rule = effectiveRule([
      condition('metrics.cpu.usage', 85, { aggregate_function: 'avg' }),
    ]);
    expect(resolveEffectiveThreshold(rule, 'metrics.cpu.usage')!.aggregateFunction).toBe('avg');
  });
});

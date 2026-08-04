/**
 * Threshold resolution (pure) — thresholds as a rule layer.
 *
 * Architecture: docs/alerting-redesign/adr/0005-effective-rule-and-threshold-resolution.md
 *               docs/alerting-redesign/02-data-model.md §2
 *
 * ADR-0005 replaces the parallel `project_alert_thresholds` engine with ONE resolution path:
 * a threshold is a rule binding carrying `threshold_overrides`. This module provides
 *
 *   1. `THRESHOLD_PRESET_MAP` — the threshold_key → (preset rule, condition field_path)
 *      mapping used by the P14 backfill, and
 *   2. `resolveEffectiveThreshold` — read the single effective threshold for a metric out of
 *      an already-resolved effective rule, so nothing re-derives it downstream.
 *
 * Pure: no database, no clock, no environment.
 */
import type { EffectiveRule } from './resolve-rule.js';
import type { ConditionOperator } from '../rules/rules.types.js';

/** Aggregate functions supported by `alert_rule_conditions.aggregate_function`. */
export type ThresholdAggregate = 'avg' | 'sum' | 'count' | 'max' | 'min' | 'p99';

export interface ThresholdPresetMapping {
  /** Preset rule that owns this threshold's condition. */
  presetKey: string;
  /** `alert_rule_conditions.field_path` the override is keyed by. */
  fieldPath: string;
  aggregateFunction?: ThresholdAggregate;
  /**
   * True when the evaluator has no SQL mapping for this field path yet. The P14 backfill
   * must REPORT these rather than silently dropping a customer's threshold; the metric
   * registry gains them in Increment 8.
   */
  requiresEngineSupport?: boolean;
}

/**
 * The 13 seeded `project_alert_thresholds` keys, mapped onto preset rules.
 *
 * Verified against the seed list in
 * `04_projects/012_create_project_alerting_and_routing.up.sql`.
 */
export const THRESHOLD_PRESET_MAP: Readonly<Record<string, ThresholdPresetMapping>> = {
  error_rate:               { presetKey: 'high_error_rate',            fieldPath: 'errors.rate' },
  latency_p95:              { presetKey: 'high_latency_p95',           fieldPath: 'requests.latency.p95' },
  latency_p99:              { presetKey: 'high_latency_p99',           fieldPath: 'requests.latency.p99' },
  apdex:                    { presetKey: 'apdex_low',                  fieldPath: 'apdex' },
  event_volume_spike:       { presetKey: 'traffic_spike',              fieldPath: 'traffic.spike_pct' },
  event_volume_drop:        { presetKey: 'traffic_drop',               fieldPath: 'traffic.drop_pct' },
  failed_notification_rate: { presetKey: 'failed_notification_rate',   fieldPath: 'failed_notification_rate' },
  ingestion_error_rate:     { presetKey: 'ingestion_error_rate',       fieldPath: 'ingestion_error_rate' },
  rate_limit_usage:         { presetKey: 'rate_limit_pressure',        fieldPath: 'rate_limit_usage' },
  ai_usage_cost:            { presetKey: 'ai_cost_spike',              fieldPath: 'ai.cost.usd' },
  // Percentiles the current evaluator has no SQL for. Mapped so the value is preserved and
  // reported, not lost; the metric registry must implement them before they can fire.
  latency_p50: {
    presetKey: 'latency_percentile', fieldPath: 'requests.latency.p50',
    aggregateFunction: 'avg', requiresEngineSupport: true,
  },
  latency_p75: {
    presetKey: 'latency_percentile', fieldPath: 'requests.latency.p75',
    aggregateFunction: 'avg', requiresEngineSupport: true,
  },
  latency_p90: {
    presetKey: 'latency_percentile', fieldPath: 'requests.latency.p90',
    aggregateFunction: 'avg', requiresEngineSupport: true,
  },
};

/** Legacy `project_alert_thresholds` row, as the backfill reads it. */
export interface LegacyThresholdRow {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string | null;
  threshold_key: string;
  metric_name: string;
  severity: string;
  comparison_operator: string;
  threshold_value: string | number;
  evaluation_window_minutes: number;
  cooldown_minutes: number;
  consecutive_breaches: number;
  enabled: boolean;
}

/** Comparison operators used by `project_alert_thresholds` → condition operators. */
const OPERATOR_MAP: Readonly<Record<string, ConditionOperator>> = {
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  '=': 'eq',
  '!=': 'neq',
};

export function mapComparisonOperator(operator: string): ConditionOperator | null {
  return OPERATOR_MAP[operator] ?? null;
}

/** The binding a legacy threshold row translates into (input shape, not a DB row). */
export interface TranslatedThresholdBinding {
  presetKey: string;
  scopeType: 'project' | 'environment';
  projectId: string;
  /** Environment SLUG; the backfill resolves it from `environment_id`. */
  environmentId: string | null;
  mode: 'override' | 'disable';
  enabled: boolean;
  severity: string;
  cooldownSeconds: number;
  consecutiveBreaches: number;
  lookbackMinutes: number;
  thresholdOverrides: Record<string, number>;
  operator: ConditionOperator | null;
  requiresEngineSupport: boolean;
  /** Set when the threshold_key has no preset mapping — the backfill must report it. */
  unmapped: boolean;
}

/**
 * Translate one legacy threshold row into a binding.
 *
 * Value mapping is exactly as specified in ADR-0005:
 *   threshold_value            → threshold_overrides[fieldPath]
 *   cooldown_minutes * 60      → cooldown_seconds
 *   consecutive_breaches       → consecutive_breaches
 *   evaluation_window_minutes  → condition lookback_minutes
 *   enabled = false            → mode 'disable'
 *   environment_id present     → environment scope, else project scope
 */
export function translateLegacyThreshold(row: LegacyThresholdRow): TranslatedThresholdBinding {
  const mapping = THRESHOLD_PRESET_MAP[row.threshold_key];
  const value = typeof row.threshold_value === 'number'
    ? row.threshold_value
    : Number(row.threshold_value);

  return {
    presetKey: mapping?.presetKey ?? '',
    scopeType: row.environment_id === null ? 'project' : 'environment',
    projectId: row.project_id,
    environmentId: row.environment_id,
    mode: row.enabled ? 'override' : 'disable',
    enabled: row.enabled,
    severity: row.severity,
    cooldownSeconds: row.cooldown_minutes * 60,
    consecutiveBreaches: row.consecutive_breaches,
    lookbackMinutes: row.evaluation_window_minutes,
    thresholdOverrides: mapping && Number.isFinite(value)
      ? { [mapping.fieldPath]: value }
      : {},
    operator: mapComparisonOperator(row.comparison_operator),
    requiresEngineSupport: mapping?.requiresEngineSupport === true,
    unmapped: mapping === undefined,
  };
}

export interface EffectiveThreshold {
  fieldPath: string;
  operator: ConditionOperator;
  value: unknown;
  lookbackMinutes: number | null;
  aggregateFunction: string | null;
  consecutiveBreaches: number;
  cooldownSeconds: number;
  enabled: boolean;
}

/**
 * Read the single effective threshold for a metric out of a resolved effective rule.
 *
 * Returns `null` when the rule has no condition for that field path — callers must treat
 * that as "not configured", never as zero.
 */
export function resolveEffectiveThreshold(
  effective: EffectiveRule,
  fieldPath: string,
): EffectiveThreshold | null {
  const condition = effective.conditions.find((c) => c.field_path === fieldPath);
  if (!condition) return null;

  return {
    fieldPath: condition.field_path,
    operator: condition.operator,
    value: condition.threshold_value,
    lookbackMinutes: condition.lookback_minutes,
    aggregateFunction: condition.aggregate_function,
    consecutiveBreaches: effective.consecutiveBreaches,
    cooldownSeconds: effective.cooldownSeconds,
    enabled: effective.enabled,
  };
}

/**
 * Every effective threshold on a resolved rule, in condition order.
 *
 * A rule may carry several conditions (composite rules), so a single scope can produce
 * several thresholds — but each field path yields exactly ONE value, which is the
 * duplicate-evaluation problem ADR-0005 removes.
 */
export function resolveAllEffectiveThresholds(effective: EffectiveRule): EffectiveThreshold[] {
  return effective.conditions.map((condition) => ({
    fieldPath: condition.field_path,
    operator: condition.operator,
    value: condition.threshold_value,
    lookbackMinutes: condition.lookback_minutes,
    aggregateFunction: condition.aggregate_function,
    consecutiveBreaches: effective.consecutiveBreaches,
    cooldownSeconds: effective.cooldownSeconds,
    enabled: effective.enabled,
  }));
}

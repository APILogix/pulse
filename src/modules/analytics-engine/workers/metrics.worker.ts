/**
 * analytics.metrics — custom metric series summary.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.6
 * Metrics: docs/analytics/10-analytics-catalog.md §6
 *
 * Reads  : events_metrics (excluding the reserved runtime.* namespace, which
 *          belongs to analytics.runtime)
 * Writes : metric_series_1m
 */

import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
import { AGG, defineSimpleRollupWorker } from './base.js';

const SOURCE = 'events_metrics';
const TABLE = 'metric_series_1m';

/** Reserved prefix owned by analytics.runtime — excluded here to avoid double ownership. */
export const RUNTIME_METRIC_PREFIX = 'runtime.';
const NOT_RUNTIME = `COALESCE(e.metric_name, '') NOT LIKE '${RUNTIME_METRIC_PREFIX}%'`;

const COLUMNS = [
  'organization_id',
  'project_id',
  'environment',
  'bucket',
  'entity_key',
  'entity_label',
  'metric_type',
  'unit',
  'service',
  'point_count',
  'value_sum',
  'value_min',
  'value_max',
  'value_last',
  'value_last_at',
  'value_p50',
  'value_p95',
  'value_p99',
  'tag_cardinality',
  'sample_count',
] as const;

export function createMetricsWorker(
  watermarks: AnalyticsWatermarkRepository,
): AnalyticsWorkerSpec {
  return defineSimpleRollupWorker(
    {
      id: 'analytics.metrics',
      tier: 'standard',
      window: '1m',
      source: SOURCE,
      table: TABLE,
      shape: 'B',
      columns: COLUMNS,
      entityKeyExpr: "COALESCE(e.metric_name, 'unknown')",
      entityLabelExpr: "COALESCE(e.metric_name, 'unknown')",
      where: NOT_RUNTIME,
      concurrency: 3,
      description:
        'Per custom metric series: point count, sum/min/max, last value, percentiles (SDK-supplied when present) and tag cardinality.',
      aggregates: () => [
        'MIN(e.metric_type)',
        'MIN(COALESCE(e.metric_unit, e.unit))',
        'MIN(e.service)',
        AGG.count(),
        AGG.sum('e.value'),
        'MIN(e.value)',
        'MAX(e.value)',
        // Last value within the bucket, resolved without a window function so the
        // statement stays a single grouped aggregate.
        '(ARRAY_AGG(e.value ORDER BY e.timestamp DESC))[1]',
        'MAX(e.timestamp)',
        // Prefer SDK-computed percentiles; fall back to the observed distribution.
        `COALESCE(AVG(e.p50), ${AGG.percentile('e.value', 0.5)})`,
        `COALESCE(AVG(e.p95), ${AGG.percentile('e.value', 0.95)})`,
        `COALESCE(AVG(e.p99), ${AGG.percentile('e.value', 0.99)})`,
        "COUNT(DISTINCT COALESCE(e.tags::text, '{}'))::int",
        AGG.count(),
      ],
    },
    watermarks,
  );
}

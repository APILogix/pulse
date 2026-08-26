/**
 * analytics.services — per service health.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.3
 * Metrics: docs/analytics/10-analytics-catalog.md §3
 *
 * Reads  : events_requests
 * Writes : service_metrics_1m
 *
 * availability_pct and health_score are stored (not derived at read time)
 * because the service fleet tiles and the SLO worker both consume them, and one
 * server-side formula is the whole point of the catalog.
 */

import { histogramSql } from '../histogram.js';
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
import { AGG, defineSimpleRollupWorker } from './base.js';
import { applySketchPass } from './sketches.js';

const TABLE = 'service_metrics_1m';
const SOURCE = 'events_requests';
const ENTITY_KEY = "COALESCE(e.service, 'unknown')";

const COLUMNS = [
  'organization_id',
  'project_id',
  'environment',
  'bucket',
  'entity_key',
  'entity_label',
  'total_count',
  'error_count',
  'client_error_count',
  'apdex_satisfied_count',
  'apdex_tolerating_count',
  'span_count',
  'error_group_count',
  'availability_pct',
  'health_score',
  'release_current',
  'latency_sum_ms',
  'latency_max_ms',
  'latency_p50_ms',
  'latency_p75_ms',
  'latency_p90_ms',
  'latency_p95_ms',
  'latency_p99_ms',
  'latency_hist',
  'unique_users_exact',
  'sample_count',
] as const;

export function createServicesWorker(
  watermarks: AnalyticsWatermarkRepository,
): AnalyticsWorkerSpec {
  return defineSimpleRollupWorker(
    {
      id: 'analytics.services',
      tier: 'live',
      window: '1m',
      source: SOURCE,
      table: TABLE,
      shape: 'B',
      columns: COLUMNS,
      entityKeyExpr: ENTITY_KEY,
      entityLabelExpr: ENTITY_KEY,
      concurrency: 4,
      description:
        'Per service volume, error rate, availability, apdex counters, latency percentiles and the composite health score.',
      aggregates: (config) => {
        const tolerating = config.apdexThresholdMs * 4;
        // availability = successful share; health = catalog health.score formula.
        const availability =
          '(COUNT(*) FILTER (WHERE e.status_code < 500 OR e.status_code IS NULL))::numeric * 100.0 / NULLIF(COUNT(*), 0)';
        const errorRate =
          '(COUNT(*) FILTER (WHERE e.status_code >= 500))::numeric * 100.0 / NULLIF(COUNT(*), 0)';
        const p95 = AGG.percentile('e.duration_ms', 0.95);
        const latencyScore = `GREATEST(0, 100 - COALESCE(${p95}, 0) / 10)`;

        return [
          AGG.count(),
          AGG.filterCount('e.status_code >= 500'),
          AGG.filterCount('e.status_code BETWEEN 400 AND 499'),
          AGG.filterCount(`e.duration_ms <= ${config.apdexThresholdMs}`),
          AGG.filterCount(`e.duration_ms > ${config.apdexThresholdMs} AND e.duration_ms <= ${tolerating}`),
          // Span volume is owned by analytics.spans; kept at 0 here so the
          // column has exactly one writer per docs/analytics/07 §4.
          '0::bigint',
          '0::int',
          `ROUND(COALESCE(${availability}, 100)::numeric, 4)`,
          `ROUND((0.40 * COALESCE(${availability}, 100) + 0.35 * (100 - COALESCE(${errorRate}, 0)) + 0.25 * ${latencyScore})::numeric, 2)`,
          'MIN(e.release)',
          AGG.sum('e.duration_ms'),
          AGG.max('e.duration_ms'),
          AGG.percentile('e.duration_ms', 0.5),
          AGG.percentile('e.duration_ms', 0.75),
          AGG.percentile('e.duration_ms', 0.9),
          p95,
          AGG.percentile('e.duration_ms', 0.99),
          histogramSql('e.duration_ms'),
          AGG.distinct('e.user_id'),
          AGG.count(),
        ];
      },
      afterWrite: async (client, slice, ctx) => {
        await applySketchPass(
          client,
          {
            source: SOURCE,
            subjectColumn: 'user_id',
            targetTable: TABLE,
            targetColumn: 'unique_users_hll',
            window: '1m',
            shape: 'B',
            entityKeyExpr: ENTITY_KEY,
            maxRows: ctx.config.batchMaxRows,
          },
          {
            orgId: slice.orgId,
            ingestStart: slice.ingestStart,
            ingestEnd: slice.ingestEnd,
            recomputeFrom: slice.recomputeFrom,
          },
        );
      },
    },
    watermarks,
  );
}

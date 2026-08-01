/**
 * analytics.releases — per-release traffic, reliability and latency.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.16
 * Metrics: docs/analytics/10-analytics-catalog.md §12
 *
 * Reads  : events_requests
 * Writes : release_metrics_1h
 *
 * The verdict/comparison row (`release_comparison`) is computed from these
 * rollups by a second statement, so the release dashboard's hardcoded
 * COMPARISON table can be deleted (docs/analytics/02-dummy-data-audit.md §1).
 */

import { histogramSql } from '../histogram.js';
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
import { AGG, defineSimpleRollupWorker, type RollupStatement } from './base.js';

const SOURCE = 'events_requests';
const TABLE = 'release_metrics_1h';
const COMPARISON_TABLE = 'release_comparison';
const ENTITY = "COALESCE(e.release, 'unknown')";

const COLUMNS = [
  'organization_id',
  'project_id',
  'environment',
  'bucket',
  'entity_key',
  'entity_label',
  'release',
  'request_count',
  'error_count',
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

/**
 * Current-vs-baseline verdict per release.
 *
 * Baseline = the release with the most traffic in the trailing 7 days excluding
 * the release under evaluation. Verdict thresholds come from
 * docs/analytics/10-analytics-catalog.md §12 (`releases.verdict`).
 */
function comparisonStatement(orgId: string): RollupStatement {
  const sql = `
    INSERT INTO ${COMPARISON_TABLE} (
      organization_id, project_id, environment, release, baseline_release,
      request_count, baseline_request_count,
      error_rate_pct, baseline_error_rate_pct, error_rate_delta_pct,
      latency_p95_ms, baseline_latency_p95_ms, p95_delta_ms,
      throughput_delta_pct, new_error_groups, verdict, first_seen_at, computed_at
    )
    WITH windowed AS (
      SELECT organization_id, project_id, environment, entity_key AS release,
             SUM(request_count)::bigint AS request_count,
             SUM(error_count)::bigint   AS error_count,
             MAX(latency_p95_ms)        AS latency_p95_ms,
             MIN(bucket)                AS first_seen_at
        FROM ${TABLE}
       WHERE organization_id = $1
         AND bucket >= NOW() - INTERVAL '7 days'
       GROUP BY organization_id, project_id, environment, entity_key
    ),
    ranked AS (
      SELECT w.*,
             (SELECT b.release
                FROM windowed b
               WHERE b.organization_id = w.organization_id
                 AND b.project_id      = w.project_id
                 AND b.environment     = w.environment
                 AND b.release        <> w.release
               ORDER BY b.request_count DESC
               LIMIT 1) AS baseline_release
        FROM windowed w
    ),
    joined AS (
      SELECT r.*,
             b.request_count   AS baseline_request_count,
             b.error_count     AS baseline_error_count,
             b.latency_p95_ms  AS baseline_latency_p95_ms
        FROM ranked r
        LEFT JOIN windowed b
               ON b.organization_id = r.organization_id
              AND b.project_id      = r.project_id
              AND b.environment     = r.environment
              AND b.release         = r.baseline_release
    )
    SELECT organization_id,
           project_id,
           environment,
           release,
           baseline_release,
           request_count,
           COALESCE(baseline_request_count, 0),
           ROUND(error_count * 100.0 / NULLIF(request_count, 0), 4)                     AS error_rate_pct,
           ROUND(baseline_error_count * 100.0 / NULLIF(baseline_request_count, 0), 4)   AS baseline_error_rate_pct,
           ROUND(
             (error_count * 100.0 / NULLIF(request_count, 0))
             - (baseline_error_count * 100.0 / NULLIF(baseline_request_count, 0)), 4
           )                                                                            AS error_rate_delta_pct,
           latency_p95_ms,
           baseline_latency_p95_ms,
           ROUND(COALESCE(latency_p95_ms, 0) - COALESCE(baseline_latency_p95_ms, 0), 3) AS p95_delta_ms,
           ROUND(
             (request_count - COALESCE(baseline_request_count, 0)) * 100.0
             / NULLIF(baseline_request_count, 0), 4
           )                                                                            AS throughput_delta_pct,
           0                                                                            AS new_error_groups,
           CASE
             WHEN baseline_release IS NULL OR COALESCE(baseline_request_count, 0) = 0 THEN 'insufficient_data'
             WHEN (error_count * 1.0 / NULLIF(request_count, 0))
                  > 1.5 * (baseline_error_count * 1.0 / NULLIF(baseline_request_count, 0))
               OR COALESCE(latency_p95_ms, 0) > 1.3 * COALESCE(NULLIF(baseline_latency_p95_ms, 0), 1e12)
               THEN 'degraded'
             WHEN (error_count * 1.0 / NULLIF(request_count, 0))
                  < (baseline_error_count * 1.0 / NULLIF(baseline_request_count, 0))
              AND COALESCE(latency_p95_ms, 0) <= COALESCE(baseline_latency_p95_ms, 0)
               THEN 'improved'
             ELSE 'stable'
           END                                                                          AS verdict,
           first_seen_at,
           NOW()
      FROM joined
    ON CONFLICT (organization_id, project_id, environment, release) DO UPDATE
       SET baseline_release        = EXCLUDED.baseline_release,
           request_count           = EXCLUDED.request_count,
           baseline_request_count  = EXCLUDED.baseline_request_count,
           error_rate_pct          = EXCLUDED.error_rate_pct,
           baseline_error_rate_pct = EXCLUDED.baseline_error_rate_pct,
           error_rate_delta_pct    = EXCLUDED.error_rate_delta_pct,
           latency_p95_ms          = EXCLUDED.latency_p95_ms,
           baseline_latency_p95_ms = EXCLUDED.baseline_latency_p95_ms,
           p95_delta_ms            = EXCLUDED.p95_delta_ms,
           throughput_delta_pct    = EXCLUDED.throughput_delta_pct,
           verdict                 = EXCLUDED.verdict,
           first_seen_at           = LEAST(${COMPARISON_TABLE}.first_seen_at, EXCLUDED.first_seen_at),
           computed_at             = NOW()`;

  return { table: COMPARISON_TABLE, sql, params: [orgId] };
}

export function createReleasesWorker(
  watermarks: AnalyticsWatermarkRepository,
): AnalyticsWorkerSpec {
  const spec = defineSimpleRollupWorker(
    {
      id: 'analytics.releases',
      tier: 'slow',
      window: '1h',
      source: SOURCE,
      table: TABLE,
      shape: 'B',
      columns: COLUMNS,
      entityKeyExpr: ENTITY,
      entityLabelExpr: ENTITY,
      concurrency: 2,
      lateGraceSeconds: 3_600,
      maxSpanMinutes: 240,
      description:
        'Per-release request volume, error rate, latency percentiles and distinct users, plus the current-vs-baseline verdict.',
      aggregates: () => [
        `MIN(${ENTITY})`,
        AGG.count(),
        AGG.filterCount('e.status_code >= 500'),
        AGG.sum('e.latency_ms'),
        AGG.max('e.latency_ms'),
        AGG.percentile('e.latency_ms', 0.5),
        AGG.percentile('e.latency_ms', 0.75),
        AGG.percentile('e.latency_ms', 0.9),
        AGG.percentile('e.latency_ms', 0.95),
        AGG.percentile('e.latency_ms', 0.99),
        histogramSql('e.latency_ms'),
        AGG.distinct('e.user_id'),
        AGG.count(),
      ],
      extraStatements: (slice) => [comparisonStatement(slice.orgId)],
    },
    watermarks,
  );

  return { ...spec, outputTables: [TABLE, COMPARISON_TABLE] };
}

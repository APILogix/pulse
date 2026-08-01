/**
 * analytics.requests — tenant/time request summary.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.1
 * Metrics: docs/analytics/10-analytics-catalog.md §1
 *
 * Reads  : events_requests (read-only)
 * Writes : request_metrics_1m
 *
 * Coarser tiers (5m/1h/1d) are produced by analytics.compaction, never here.
 */

import { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import { buildInsertSelect } from '../rollup-writer.js';
import { histogramSql } from '../histogram.js';
import {
  AGG,
  buildBucketRecomputeSql,
  runRollupWorker,
  type RollupStatement,
} from './base.js';
import { applySketchPass } from './sketches.js';
import type {
  AnalyticsJobData,
  AnalyticsWorkerSpec,
  WorkerContext,
  WorkerRunResult,
} from '../types.js';

const TABLE = 'request_metrics_1m';
const SOURCE = 'events_requests';

/** Column order must match the aggregate order below exactly. */
const COLUMNS = [
  'organization_id',
  'project_id',
  'environment',
  'bucket',
  'total_count',
  'success_count',
  'redirect_count',
  'client_error_count',
  'error_count',
  'auth_failure_count',
  'rate_limited_count',
  'slow_count',
  'bot_count',
  'apdex_satisfied_count',
  'apdex_tolerating_count',
  'bytes_in',
  'bytes_out',
  'service_count',
  'route_count',
  'latency_sum_ms',
  'latency_max_ms',
  'latency_p50_ms',
  'latency_p75_ms',
  'latency_p90_ms',
  'latency_p95_ms',
  'latency_p99_ms',
  'latency_hist',
  'unique_users_exact',
  'unique_sessions_exact',
  'unique_tenants_exact',
  'sample_count',
] as const;

function aggregates(apdexThresholdMs: number): string[] {
  const tolerating = apdexThresholdMs * 4;
  return [
    AGG.count(),
    AGG.filterCount('e.status_code BETWEEN 200 AND 299'),
    AGG.filterCount('e.status_code BETWEEN 300 AND 399'),
    AGG.filterCount('e.status_code BETWEEN 400 AND 499'),
    AGG.filterCount('e.status_code >= 500'),
    AGG.filterCount('e.status_code IN (401, 403)'),
    AGG.filterCount('e.status_code = 429'),
    AGG.filterCount('COALESCE(e.latency_ms, 0) >= 1000'),
    AGG.filterCount('e.is_bot IS TRUE'),
    AGG.filterCount(`e.latency_ms <= ${apdexThresholdMs}`),
    AGG.filterCount(`e.latency_ms > ${apdexThresholdMs} AND e.latency_ms <= ${tolerating}`),
    AGG.sum('e.body_size'),
    AGG.sum('e.response_size'),
    'COUNT(DISTINCT e.service)::int',
    'COUNT(DISTINCT COALESCE(e.route, e.url))::int',
    AGG.sum('e.latency_ms'),
    AGG.max('e.latency_ms'),
    AGG.percentile('e.latency_ms', 0.5),
    AGG.percentile('e.latency_ms', 0.75),
    AGG.percentile('e.latency_ms', 0.9),
    AGG.percentile('e.latency_ms', 0.95),
    AGG.percentile('e.latency_ms', 0.99),
    histogramSql('e.latency_ms'),
    AGG.distinct('e.user_id'),
    AGG.distinct('e.session_id'),
    AGG.distinct('e.tenant_id'),
    AGG.count(),
  ];
}

export function createRequestsWorker(
  watermarks: AnalyticsWatermarkRepository,
): AnalyticsWorkerSpec {
  return {
    id: 'analytics.requests',
    queue: 'analytics.requests',
    tier: 'live',
    windowSize: '1m',
    sourceTables: [SOURCE],
    outputTables: [TABLE],
    concurrency: 6,
    retryLimit: 5,
    retryBackoffSeconds: 30,
    lateGraceSeconds: 900,
    maxSpanMinutes: 60,
    description:
      'Request volume, status mix, latency percentiles + histogram, apdex, byte throughput and distinct users/sessions/tenants per minute.',

    async run(ctx: WorkerContext, job: AnalyticsJobData): Promise<WorkerRunResult> {
      return runRollupWorker(ctx, job, watermarks, {
        workerId: 'analytics.requests',
        window: '1m',
        sizingTable: SOURCE,
        lateGraceSeconds: 900,
        maxSpanMinutes: 60,

        statements: (slice): RollupStatement[] => {
          const select = buildBucketRecomputeSql({
            source: SOURCE,
            window: '1m',
            aggregates: aggregates(ctx.config.apdexThresholdMs),
            columns: COLUMNS,
          });

          return [
            {
              table: TABLE,
              sql: buildInsertSelect(TABLE, 'A', COLUMNS, select),
              params: [slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom],
            },
          ];
        },

        // Sketches are written after the counters exist so coarse windows can
        // union them without re-reading raw telemetry.
        afterWrite: async (client, slice) => {
          const passParams = {
            orgId: slice.orgId,
            ingestStart: slice.ingestStart,
            ingestEnd: slice.ingestEnd,
            recomputeFrom: slice.recomputeFrom,
          };

          await applySketchPass(
            client,
            {
              source: SOURCE,
              subjectColumn: 'user_id',
              targetTable: TABLE,
              targetColumn: 'unique_users_hll',
              window: '1m',
              shape: 'A',
              maxRows: ctx.config.batchMaxRows,
            },
            passParams,
          );

          await applySketchPass(
            client,
            {
              source: SOURCE,
              subjectColumn: 'session_id',
              targetTable: TABLE,
              targetColumn: 'unique_sessions_hll',
              window: '1m',
              shape: 'A',
              maxRows: ctx.config.batchMaxRows,
            },
            passParams,
          );
        },
      });
    },
  };
}

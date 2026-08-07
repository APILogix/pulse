/**
 * analytics.traces — trace counts, duration percentiles, service edges.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.9
 * Metrics: docs/analytics/10-analytics-catalog.md §9
 *
 * Reads  : events_traces, events_spans (for the service graph)
 * Writes : trace_metrics_1m, trace_edge_metrics_1h
 *
 * The edge query self-joins spans on parent_span_id inside a trace, which is the
 * server-side replacement for the client-side grouping the tracing dashboard
 * performs today.
 */
import { buildInsertSelect } from '../rollup-writer.js';
import { histogramSql } from '../histogram.js';
import { AGG, buildBucketRecomputeSql, runRollupWorker, } from './base.js';
const TRACE_SOURCE = 'events_traces';
const SPAN_SOURCE = 'events_spans';
const TRACE_TABLE = 'trace_metrics_1m';
const EDGE_TABLE = 'trace_edge_metrics_1h';
const TRACE_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'trace_count',
    'partial_count',
    'error_trace_count',
    'span_count_sum',
    'span_count_max',
    'critical_path_p95_ms',
    'duration_sum_ms',
    'duration_max_ms',
    'duration_p50_ms',
    'duration_p75_ms',
    'duration_p90_ms',
    'duration_p95_ms',
    'duration_p99_ms',
    'duration_hist',
    'sample_count',
];
const EDGE_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'source_service',
    'target_service',
    'call_count',
    'error_count',
    'latency_sum_ms',
    'latency_max_ms',
    'latency_p50_ms',
    'latency_p75_ms',
    'latency_p90_ms',
    'latency_p95_ms',
    'latency_p99_ms',
    'latency_hist',
    'sample_count',
];
export function createTracesWorker(watermarks) {
    return {
        id: 'analytics.traces',
        queue: 'analytics.traces',
        tier: 'live',
        windowSize: '1m',
        sourceTables: [TRACE_SOURCE, SPAN_SOURCE],
        outputTables: [TRACE_TABLE, EDGE_TABLE],
        concurrency: 3,
        retryLimit: 5,
        retryBackoffSeconds: 30,
        lateGraceSeconds: 900,
        maxSpanMinutes: 60,
        description: 'Trace volume, partial and error-trace rates, span-count and duration distributions, plus the service-to-service call graph with edge latency.',
        async run(ctx, job) {
            return runRollupWorker(ctx, job, watermarks, {
                workerId: 'analytics.traces',
                window: '1m',
                sizingTable: TRACE_SOURCE,
                lateGraceSeconds: 900,
                maxSpanMinutes: 60,
                statements: (slice) => {
                    const params = [slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom];
                    const traceSelect = buildBucketRecomputeSql({
                        source: TRACE_SOURCE,
                        window: '1m',
                        columns: TRACE_COLUMNS,
                        aggregates: [
                            AGG.count(),
                            AGG.filterCount('e.is_partial IS TRUE'),
                            AGG.filterCount("e.status_code >= 500 OR e.severity IN ('error','fatal','critical')"),
                            AGG.sum('e.span_count'),
                            'MAX(e.span_count)::int',
                            // Critical path is approximated by the trace duration percentile
                            // until span-tree walking lands (docs/analytics/12 §7, P2).
                            AGG.percentile('e.total_duration_ms', 0.95),
                            AGG.sum('e.total_duration_ms'),
                            AGG.max('e.total_duration_ms'),
                            AGG.percentile('e.total_duration_ms', 0.5),
                            AGG.percentile('e.total_duration_ms', 0.75),
                            AGG.percentile('e.total_duration_ms', 0.9),
                            AGG.percentile('e.total_duration_ms', 0.95),
                            AGG.percentile('e.total_duration_ms', 0.99),
                            histogramSql('e.total_duration_ms'),
                            AGG.count(),
                        ],
                    });
                    /**
                     * Service graph. Parent/child spans are matched inside one trace, so the
                     * join is bounded by trace size, and the touched-bucket CTE keeps the
                     * scan inside the recompute range.
                     */
                    const edgeSql = `
            INSERT INTO ${EDGE_TABLE} (${EDGE_COLUMNS.join(',')})
            WITH touched AS (
              SELECT DISTINCT date_trunc('hour', s.occurred_at) AS bucket
                FROM ${SPAN_SOURCE} s
               WHERE s.organization_id = $1
                 AND s.project_id IS NOT NULL
                 AND s.ingested_at >= $2 AND s.ingested_at < $3
                 AND s.occurred_at   >= $4
            ),
            bounds AS (SELECT MIN(bucket) AS lo, MAX(bucket) AS hi FROM touched),
            scoped AS (
              SELECT s.organization_id, s.project_id, s.environment, s.trace_id,
                     s.span_id, s.parent_span_id, s.service, s.status, s.duration_ms,
                     date_trunc('hour', s.occurred_at) AS bucket
                FROM ${SPAN_SOURCE} s
                JOIN touched t ON date_trunc('hour', s.occurred_at) = t.bucket
               WHERE s.organization_id = $1
                 AND s.project_id IS NOT NULL
                 AND s.occurred_at >= (SELECT lo FROM bounds)
                 AND s.occurred_at <  (SELECT hi FROM bounds) + INTERVAL '1 hour'
            ),
            edges AS (
              SELECT child.organization_id,
                     child.project_id,
                     child.environment,
                     child.bucket,
                     COALESCE(parent.service, 'unknown') AS source_service,
                     COALESCE(child.service, 'unknown')  AS target_service,
                     child.status,
                     child.duration_ms
                FROM scoped child
                JOIN scoped parent
                  ON parent.span_id  = child.parent_span_id
                 AND parent.trace_id = child.trace_id
                 AND parent.organization_id = child.organization_id
               WHERE child.parent_span_id IS NOT NULL
                 AND COALESCE(parent.service, '') <> COALESCE(child.service, '')
            )
            SELECT organization_id,
                   project_id,
                   environment,
                   bucket,
                   source_service || '>' || target_service AS entity_key,
                   source_service || ' → ' || target_service AS entity_label,
                   source_service,
                   target_service,
                   COUNT(*)::bigint,
                   COUNT(*) FILTER (WHERE status = 'error')::bigint,
                   COALESCE(SUM(duration_ms), 0),
                   MAX(duration_ms),
                   PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY duration_ms),
                   PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY duration_ms),
                   PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY duration_ms),
                   PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms),
                   PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms),
                   ${histogramSql('duration_ms')},
                   COUNT(*)::bigint
              FROM edges
             GROUP BY organization_id, project_id, environment, bucket, source_service, target_service
            ON CONFLICT (organization_id, project_id, environment, bucket, entity_key) DO UPDATE
               SET entity_label    = EXCLUDED.entity_label,
                   source_service  = EXCLUDED.source_service,
                   target_service  = EXCLUDED.target_service,
                   call_count      = EXCLUDED.call_count,
                   error_count     = EXCLUDED.error_count,
                   latency_sum_ms  = EXCLUDED.latency_sum_ms,
                   latency_max_ms  = EXCLUDED.latency_max_ms,
                   latency_p50_ms  = EXCLUDED.latency_p50_ms,
                   latency_p75_ms  = EXCLUDED.latency_p75_ms,
                   latency_p90_ms  = EXCLUDED.latency_p90_ms,
                   latency_p95_ms  = EXCLUDED.latency_p95_ms,
                   latency_p99_ms  = EXCLUDED.latency_p99_ms,
                   latency_hist    = EXCLUDED.latency_hist,
                   sample_count    = EXCLUDED.sample_count,
                   updated_at      = NOW()`;
                    return [
                        {
                            table: TRACE_TABLE,
                            sql: buildInsertSelect(TRACE_TABLE, 'A', TRACE_COLUMNS, traceSelect),
                            params,
                        },
                        { table: EDGE_TABLE, sql: edgeSql, params },
                    ];
                },
            });
        },
    };
}
//# sourceMappingURL=traces.worker.js.map
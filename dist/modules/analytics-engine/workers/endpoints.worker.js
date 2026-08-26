/**
 * analytics.endpoints — per route/method breakdown.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.2
 * Metrics: docs/analytics/10-analytics-catalog.md §2
 *
 * Reads  : events_requests
 * Writes : endpoint_metrics_1m
 *
 * entity_key = md5(method || ' ' || coalesce(route, url)) so the key stays
 * bounded even when URLs are long, with entity_label carrying the display value.
 */
import { histogramSql } from '../histogram.js';
import { AGG, defineSimpleRollupWorker } from './base.js';
import { applySketchPass } from './sketches.js';
const TABLE = 'endpoint_metrics_1m';
const SOURCE = 'events_requests';
const ENDPOINT_LABEL = "COALESCE(e.method, 'UNKNOWN') || ' ' || COALESCE(e.endpoint, '/')";
const ENTITY_KEY = `md5(${ENDPOINT_LABEL})`;
const COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'method',
    'route',
    'service',
    'total_count',
    'error_count',
    'client_error_count',
    'slow_count',
    'bytes_out',
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
];
export function createEndpointsWorker(watermarks) {
    return defineSimpleRollupWorker({
        id: 'analytics.endpoints',
        tier: 'live',
        window: '1m',
        source: SOURCE,
        table: TABLE,
        shape: 'B',
        columns: COLUMNS,
        entityKeyExpr: ENTITY_KEY,
        entityLabelExpr: ENDPOINT_LABEL,
        concurrency: 4,
        description: 'Per endpoint (method + route) volume, error split, latency percentiles + histogram, bytes out and distinct users.',
        aggregates: () => [
            `MIN(COALESCE(e.method, 'UNKNOWN'))`,
            'MIN(e.endpoint)',
            'MIN(e.service)',
            AGG.count(),
            AGG.filterCount('e.status_code >= 500'),
            AGG.filterCount('e.status_code BETWEEN 400 AND 499'),
            AGG.filterCount('COALESCE(e.duration_ms, 0) >= 1000'),
            AGG.sum('e.response_size'),
            AGG.sum('e.duration_ms'),
            AGG.max('e.duration_ms'),
            AGG.percentile('e.duration_ms', 0.5),
            AGG.percentile('e.duration_ms', 0.75),
            AGG.percentile('e.duration_ms', 0.9),
            AGG.percentile('e.duration_ms', 0.95),
            AGG.percentile('e.duration_ms', 0.99),
            histogramSql('e.duration_ms'),
            AGG.distinct('e.user_id'),
            AGG.count(),
        ],
        afterWrite: async (client, slice, ctx) => {
            await applySketchPass(client, {
                source: SOURCE,
                subjectColumn: 'user_id',
                targetTable: TABLE,
                targetColumn: 'unique_users_hll',
                window: '1m',
                shape: 'B',
                entityKeyExpr: ENTITY_KEY,
                maxRows: ctx.config.batchMaxRows,
            }, {
                orgId: slice.orgId,
                ingestStart: slice.ingestStart,
                ingestEnd: slice.ingestEnd,
                recomputeFrom: slice.recomputeFrom,
            });
        },
    }, watermarks);
}
//# sourceMappingURL=endpoints.worker.js.map
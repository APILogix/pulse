/**
 * analytics.runtime — Node/V8 diagnostics (heap, RSS, handles, event loop, GC).
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.7
 * Metrics: docs/analytics/10-analytics-catalog.md §7
 *
 * Reads  : events_metrics where metric_name LIKE 'runtime.%'
 * Writes : runtime_metrics_1m, gc_metrics_1m
 *
 * This worker is what replaces the three fabricated frontend datasets
 * (dummyRuntimeMetricSamples / dummyEventLoopSamples / dummyGcPauseEvents) —
 * see docs/analytics/02-dummy-data-audit.md §4. The Log DB has no dedicated
 * runtime table, so the SDK reports these as reserved custom metrics.
 */
import { buildInsertSelect } from '../rollup-writer.js';
import { histogramSql } from '../histogram.js';
import { AGG, buildBucketRecomputeSql, runRollupWorker, } from './base.js';
const SOURCE = 'events_metrics';
const RUNTIME_TABLE = 'runtime_metrics_1m';
const GC_TABLE = 'gc_metrics_1m';
/** Reserved metric names. Documented in docs/analytics/10-analytics-catalog.md §7. */
export const RUNTIME_METRICS = {
    heapUsed: 'runtime.heap.used',
    heapTotal: 'runtime.heap.total',
    external: 'runtime.memory.external',
    rss: 'runtime.memory.rss',
    handles: 'runtime.handles.active',
    eventLoopLag: 'runtime.eventloop.lag',
    eventLoopUtilization: 'runtime.eventloop.utilization',
    gcPause: 'runtime.gc.pause',
};
const IS_RUNTIME = "COALESCE(e.metric_name, '') LIKE 'runtime.%'";
const IS_GC = `e.metric_name = '${RUNTIME_METRICS.gcPause}'`;
const SERVICE = "COALESCE(e.service, 'unknown')";
const RUNTIME_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'heap_used_mb_avg',
    'heap_used_mb_max',
    'heap_total_mb_avg',
    'external_mb_avg',
    'rss_mb_avg',
    'rss_mb_max',
    'active_handles_avg',
    'active_handles_max',
    'eventloop_lag_p50_ms',
    'eventloop_lag_p95_ms',
    'eventloop_lag_p99_ms',
    'eventloop_lag_hist',
    'eventloop_utilization_pct',
    'sample_count',
];
const GC_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'service',
    'gc_type',
    'pause_count',
    'long_pause_count',
    'heap_before_mb_avg',
    'heap_after_mb_avg',
    'reclaimed_mb_sum',
    'pause_sum_ms',
    'pause_max_ms',
    'pause_p50_ms',
    'pause_p75_ms',
    'pause_p90_ms',
    'pause_p95_ms',
    'pause_p99_ms',
    'pause_hist',
    'sample_count',
];
/** Average of a single reserved metric inside the bucket. */
function metricAvg(name) {
    return `AVG(e.value) FILTER (WHERE e.metric_name = '${name}')`;
}
function metricMax(name) {
    return `MAX(e.value) FILTER (WHERE e.metric_name = '${name}')`;
}
export function createRuntimeWorker(watermarks) {
    return {
        id: 'analytics.runtime',
        queue: 'analytics.runtime',
        tier: 'standard',
        windowSize: '1m',
        sourceTables: [SOURCE],
        outputTables: [RUNTIME_TABLE, GC_TABLE],
        concurrency: 2,
        retryLimit: 5,
        retryBackoffSeconds: 30,
        lateGraceSeconds: 900,
        maxSpanMinutes: 60,
        description: 'Heap/RSS/handle averages and maxima, event-loop lag percentiles + histogram, utilization, and GC pause statistics per service and GC type.',
        async run(ctx, job) {
            return runRollupWorker(ctx, job, watermarks, {
                workerId: 'analytics.runtime',
                window: '1m',
                sizingTable: SOURCE,
                sizingWhere: IS_RUNTIME,
                lateGraceSeconds: 900,
                maxSpanMinutes: 60,
                statements: (slice) => {
                    const params = [slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom];
                    const lagFilter = `e.metric_name = '${RUNTIME_METRICS.eventLoopLag}'`;
                    const runtimeSelect = buildBucketRecomputeSql({
                        source: SOURCE,
                        window: '1m',
                        where: IS_RUNTIME,
                        columns: RUNTIME_COLUMNS,
                        entityKeyExpr: SERVICE,
                        entityLabelExpr: SERVICE,
                        aggregates: [
                            metricAvg(RUNTIME_METRICS.heapUsed),
                            metricMax(RUNTIME_METRICS.heapUsed),
                            metricAvg(RUNTIME_METRICS.heapTotal),
                            metricAvg(RUNTIME_METRICS.external),
                            metricAvg(RUNTIME_METRICS.rss),
                            metricMax(RUNTIME_METRICS.rss),
                            metricAvg(RUNTIME_METRICS.handles),
                            metricMax(RUNTIME_METRICS.handles),
                            `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CASE WHEN ${lagFilter} THEN e.value END)`,
                            `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY CASE WHEN ${lagFilter} THEN e.value END)`,
                            `PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY CASE WHEN ${lagFilter} THEN e.value END)`,
                            histogramSql(`CASE WHEN ${lagFilter} THEN e.value END`),
                            metricAvg(RUNTIME_METRICS.eventLoopUtilization),
                            AGG.count(),
                        ],
                    });
                    // GC rows are keyed by service + gc_type, which the SDK reports in tags.
                    const gcType = "COALESCE(e.tags->>'gc_type', 'unknown')";
                    const gcEntity = `${SERVICE} || ':' || ${gcType}`;
                    const gcSelect = buildBucketRecomputeSql({
                        source: SOURCE,
                        window: '1m',
                        where: IS_GC,
                        columns: GC_COLUMNS,
                        entityKeyExpr: gcEntity,
                        entityLabelExpr: gcEntity,
                        aggregates: [
                            `MIN(${SERVICE})`,
                            `MIN(${gcType})`,
                            AGG.count(),
                            AGG.filterCount('e.value > 100'),
                            "AVG((e.tags->>'heap_before_mb')::numeric)",
                            "AVG((e.tags->>'heap_after_mb')::numeric)",
                            "COALESCE(SUM(GREATEST((e.tags->>'heap_before_mb')::numeric - (e.tags->>'heap_after_mb')::numeric, 0)), 0)",
                            AGG.sum('e.value'),
                            AGG.max('e.value'),
                            AGG.percentile('e.value', 0.5),
                            AGG.percentile('e.value', 0.75),
                            AGG.percentile('e.value', 0.9),
                            AGG.percentile('e.value', 0.95),
                            AGG.percentile('e.value', 0.99),
                            histogramSql('e.value'),
                            AGG.count(),
                        ],
                    });
                    return [
                        {
                            table: RUNTIME_TABLE,
                            sql: buildInsertSelect(RUNTIME_TABLE, 'B', RUNTIME_COLUMNS, runtimeSelect),
                            params,
                        },
                        {
                            table: GC_TABLE,
                            sql: buildInsertSelect(GC_TABLE, 'B', GC_COLUMNS, gcSelect),
                            params,
                        },
                    ];
                },
            });
        },
    };
}
//# sourceMappingURL=runtime.worker.js.map
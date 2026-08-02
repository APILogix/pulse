/**
 * analytics.logs — log volume by level, plus logger ranking.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.5
 * Metrics: docs/analytics/10-analytics-catalog.md §5
 *
 * Reads  : events_logs
 * Writes : log_metrics_1m, logger_metrics_1h
 */
import { buildInsertSelect } from '../rollup-writer.js';
import { AGG, buildBucketRecomputeSql, runRollupWorker, } from './base.js';
const SOURCE = 'events_logs';
const SUMMARY_TABLE = 'log_metrics_1m';
const LOGGER_TABLE = 'logger_metrics_1h';
/** Level lives in two places depending on SDK version; normalise once here. */
const LEVEL = "LOWER(COALESCE(e.level, e.severity::text, 'info'))";
const SUMMARY_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'total_count',
    'error_count',
    'warn_count',
    'info_count',
    'debug_count',
    'unique_loggers',
    'bytes_estimate',
    'sample_count',
];
const LOGGER_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'service',
    'total_count',
    'error_count',
    'warn_count',
    'sample_count',
];
export function createLogsWorker(watermarks) {
    return {
        id: 'analytics.logs',
        queue: 'analytics.logs',
        tier: 'live',
        windowSize: '1m',
        sourceTables: [SOURCE],
        outputTables: [SUMMARY_TABLE, LOGGER_TABLE],
        concurrency: 4,
        retryLimit: 5,
        retryBackoffSeconds: 30,
        lateGraceSeconds: 900,
        maxSpanMinutes: 60,
        description: 'Log volume by level, byte estimate, logger cardinality and per-logger noise ranking.',
        async run(ctx, job) {
            return runRollupWorker(ctx, job, watermarks, {
                workerId: 'analytics.logs',
                window: '1m',
                sizingTable: SOURCE,
                lateGraceSeconds: 900,
                maxSpanMinutes: 60,
                statements: (slice) => {
                    const params = [slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom];
                    const summarySelect = buildBucketRecomputeSql({
                        source: SOURCE,
                        window: '1m',
                        columns: SUMMARY_COLUMNS,
                        aggregates: [
                            AGG.count(),
                            AGG.filterCount(`${LEVEL} IN ('error','fatal','critical')`),
                            AGG.filterCount(`${LEVEL} IN ('warn','warning')`),
                            AGG.filterCount(`${LEVEL} = 'info'`),
                            AGG.filterCount(`${LEVEL} IN ('debug','trace')`),
                            'COUNT(DISTINCT e.logger)::int',
                            // Payload size is the only storage signal available without a
                            // second scan; pg_column_size is cheap on already-fetched rows.
                            'COALESCE(SUM(pg_column_size(e.payload)), 0)::bigint',
                            AGG.count(),
                        ],
                    });
                    const loggerSelect = buildBucketRecomputeSql({
                        source: SOURCE,
                        window: '1h',
                        columns: LOGGER_COLUMNS,
                        entityKeyExpr: "COALESCE(e.logger, 'unknown')",
                        entityLabelExpr: "COALESCE(e.logger, 'unknown')",
                        aggregates: [
                            'MIN(e.service)',
                            AGG.count(),
                            AGG.filterCount(`${LEVEL} IN ('error','fatal','critical')`),
                            AGG.filterCount(`${LEVEL} IN ('warn','warning')`),
                            AGG.count(),
                        ],
                    });
                    return [
                        {
                            table: SUMMARY_TABLE,
                            sql: buildInsertSelect(SUMMARY_TABLE, 'A', SUMMARY_COLUMNS, summarySelect),
                            params,
                        },
                        {
                            table: LOGGER_TABLE,
                            sql: buildInsertSelect(LOGGER_TABLE, 'B', LOGGER_COLUMNS, loggerSelect),
                            params,
                        },
                    ];
                },
            });
        },
    };
}
//# sourceMappingURL=logs.worker.js.map
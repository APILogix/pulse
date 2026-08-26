/**
 * analytics.spans — operation latency, self time, DB statements, external deps.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.8
 * Metrics: docs/analytics/10-analytics-catalog.md §8
 *
 * Reads  : events_spans
 * Writes : span_metrics_1m, db_metrics_1h, dependency_metrics_1h
 *
 * Statement normalisation happens here, in SQL, exactly once — replacing the
 * per-render regex work the tracing dashboard does in the browser today
 * (docs/analytics/02-dummy-data-audit.md §2).
 */
import { buildInsertSelect } from '../rollup-writer.js';
import { histogramSql } from '../histogram.js';
import { AGG, buildBucketRecomputeSql, runRollupWorker, } from './base.js';
const SOURCE = 'events_spans';
const SPAN_TABLE = 'span_metrics_1m';
const DB_TABLE = 'db_metrics_1h';
const DEP_TABLE = 'dependency_metrics_1h';
const SERVICE = "COALESCE(e.service, 'unknown')";
const SPAN_NAME = "COALESCE(e.name, 'unknown')";
/** Numbers and quoted literals collapsed so query shapes group together. */
const STATEMENT_PATTERN = "LEFT(regexp_replace(regexp_replace(COALESCE(e.db_statement, e.name, ''), '\\d+', '?', 'g'), '''[^'']*''', '?', 'g'), 200)";
const SPAN_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'service',
    'span_name',
    'kind',
    'total_count',
    'error_count',
    'latency_sum_ms',
    'latency_max_ms',
    'latency_p50_ms',
    'latency_p75_ms',
    'latency_p90_ms',
    'latency_p95_ms',
    'latency_p99_ms',
    'latency_hist',
    'self_time_sum_ms',
    'self_time_max_ms',
    'self_time_p50_ms',
    'self_time_p75_ms',
    'self_time_p90_ms',
    'self_time_p95_ms',
    'self_time_p99_ms',
    'self_time_hist',
    'sample_count',
];
const DB_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'db_system',
    'db_name',
    'db_operation',
    'db_collection',
    'statement_pattern',
    'service',
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
const DEP_COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'dependency_kind',
    'dependency_host',
    'service',
    'call_count',
    'error_count',
    'status_5xx_count',
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
function latencyBlock(column) {
    return [
        AGG.sum(column),
        AGG.max(column),
        AGG.percentile(column, 0.5),
        AGG.percentile(column, 0.75),
        AGG.percentile(column, 0.9),
        AGG.percentile(column, 0.95),
        AGG.percentile(column, 0.99),
        histogramSql(column),
    ];
}
export function createSpansWorker(watermarks) {
    return {
        id: 'analytics.spans',
        queue: 'analytics.spans',
        tier: 'live',
        windowSize: '1m',
        sourceTables: [SOURCE],
        outputTables: [SPAN_TABLE, DB_TABLE, DEP_TABLE],
        concurrency: 4,
        retryLimit: 5,
        retryBackoffSeconds: 30,
        lateGraceSeconds: 900,
        maxSpanMinutes: 60,
        description: 'Per-operation span latency and self time, database statement performance by normalised pattern, and external dependency latency by host.',
        async run(ctx, job) {
            return runRollupWorker(ctx, job, watermarks, {
                workerId: 'analytics.spans',
                window: '1m',
                sizingTable: SOURCE,
                lateGraceSeconds: 900,
                maxSpanMinutes: 60,
                statements: (slice) => {
                    const params = [slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom];
                    const spanEntity = `md5(${SERVICE} || ':' || ${SPAN_NAME})`;
                    const spanSelect = buildBucketRecomputeSql({
                        source: SOURCE,
                        window: '1m',
                        columns: SPAN_COLUMNS,
                        entityKeyExpr: spanEntity,
                        entityLabelExpr: SPAN_NAME,
                        aggregates: [
                            `MIN(${SERVICE})`,
                            `MIN(${SPAN_NAME})`,
                            'MIN(e.span_kind)',
                            AGG.count(),
                            AGG.filterCount("e.span_status = 'error'"),
                            ...latencyBlock('e.duration_ms'),
                            ...latencyBlock('e.exclusive_duration_ms'),
                            AGG.count(),
                        ],
                    });
                    const dbEntity = `md5(COALESCE(e.db_system, 'unknown') || ':' || ${STATEMENT_PATTERN})`;
                    const dbSelect = buildBucketRecomputeSql({
                        source: SOURCE,
                        window: '1h',
                        where: 'e.db_system IS NOT NULL',
                        columns: DB_COLUMNS,
                        entityKeyExpr: dbEntity,
                        entityLabelExpr: STATEMENT_PATTERN,
                        aggregates: [
                            'MIN(e.db_system)',
                            'MIN(e.db_name)',
                            'MIN(e.db_operation)',
                            'MIN(e.db_collection)',
                            `MIN(${STATEMENT_PATTERN})`,
                            `MIN(${SERVICE})`,
                            AGG.count(),
                            AGG.filterCount("e.span_status = 'error'"),
                            ...latencyBlock('e.duration_ms'),
                            AGG.count(),
                        ],
                    });
                    const depHost = "COALESCE(e.http_host, e.messaging_destination, split_part(regexp_replace(COALESCE(e.http_url, ''), '^https?://', ''), '/', 1), 'unknown')";
                    const depKind = "CASE WHEN e.http_host IS NOT NULL OR e.http_url IS NOT NULL THEN 'http' " +
                        "WHEN e.messaging_destination IS NOT NULL THEN 'messaging' ELSE 'other' END";
                    const depSelect = buildBucketRecomputeSql({
                        source: SOURCE,
                        window: '1h',
                        where: "e.span_kind = 'client' AND (e.http_host IS NOT NULL OR e.http_url IS NOT NULL OR e.messaging_destination IS NOT NULL)",
                        columns: DEP_COLUMNS,
                        entityKeyExpr: depHost,
                        entityLabelExpr: depHost,
                        aggregates: [
                            `MIN(${depKind})`,
                            `MIN(${depHost})`,
                            `MIN(${SERVICE})`,
                            AGG.count(),
                            AGG.filterCount("e.span_status = 'error'"),
                            AGG.filterCount('e.http_status_code >= 500'),
                            ...latencyBlock('e.duration_ms'),
                            AGG.count(),
                        ],
                    });
                    return [
                        { table: SPAN_TABLE, sql: buildInsertSelect(SPAN_TABLE, 'B', SPAN_COLUMNS, spanSelect), params },
                        { table: DB_TABLE, sql: buildInsertSelect(DB_TABLE, 'B', DB_COLUMNS, dbSelect), params },
                        { table: DEP_TABLE, sql: buildInsertSelect(DEP_TABLE, 'B', DEP_COLUMNS, depSelect), params },
                    ];
                },
            });
        },
    };
}
//# sourceMappingURL=spans.worker.js.map
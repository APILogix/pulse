/**
 * analytics.ai - AI runtime cost, failures and latency by model.
 *
 * Reads  : ai_requests
 * Writes : ai_metrics_1m
 */
import { buildInsertSelect } from '../rollup-writer.js';
import { histogramSql } from '../histogram.js';
import { AGG, buildBucketRecomputeSql, runRollupWorker, } from './base.js';
const SOURCE = 'ai_requests';
const TABLE = 'ai_metrics_1m';
const MODEL = "COALESCE(e.model, 'unknown')";
const STATUS = "COALESCE(e.status::text, 'queued')";
const COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'model',
    'request_count',
    'success_count',
    'failure_count',
    'cache_hit_count',
    'prompt_tokens',
    'completion_tokens',
    'credits_consumed',
    'cost_micros',
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
export function createAiWorker(watermarks) {
    return {
        id: 'analytics.ai',
        queue: 'analytics.ai',
        tier: 'slow',
        windowSize: '1m',
        sourceTables: [SOURCE],
        outputTables: [TABLE],
        concurrency: 2,
        retryLimit: 5,
        retryBackoffSeconds: 60,
        lateGraceSeconds: 1_800,
        maxSpanMinutes: 180,
        description: 'AI request volume, failure rate, token usage, cost and latency per model at one-minute granularity.',
        async run(ctx, job) {
            return runRollupWorker(ctx, job, watermarks, {
                workerId: 'analytics.ai',
                window: '1m',
                sizingTable: SOURCE,
                sizingTimeColumn: 'occurred_at',
                sizingIngestColumn: 'updated_at',
                lateGraceSeconds: 1_800,
                maxSpanMinutes: 180,
                statements: (slice) => {
                    const select = buildBucketRecomputeSql({
                        source: SOURCE,
                        window: '1m',
                        timeColumn: 'occurred_at',
                        ingestColumn: 'updated_at',
                        entityKeyExpr: MODEL,
                        entityLabelExpr: MODEL,
                        columns: COLUMNS,
                        aggregates: [
                            `MIN(${MODEL})`,
                            AGG.count(),
                            AGG.filterCount(`${STATUS} = 'succeeded'`),
                            AGG.filterCount(`${STATUS} IN ('failed','cancelled')`),
                            AGG.filterCount('e.cache_key IS NOT NULL'),
                            AGG.sum('e.prompt_tokens'),
                            AGG.sum('e.completion_tokens'),
                            '0::numeric(20,6)',
                            'COALESCE(ROUND(SUM(COALESCE(e.cost_usd, 0)) * 1000000), 0)::bigint',
                            '0::numeric(20,3)',
                            'NULL::numeric(14,3)',
                            'NULL::numeric(14,3)',
                            'NULL::numeric(14,3)',
                            'NULL::numeric(14,3)',
                            'NULL::numeric(14,3)',
                            'NULL::numeric(14,3)',
                            'NULL::bigint[]',
                            AGG.count(),
                        ],
                    });
                    return [
                        {
                            table: TABLE,
                            sql: buildInsertSelect(TABLE, 'B', COLUMNS, select),
                            params: [slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom],
                        },
                    ];
                },
            });
        },
    };
}
//# sourceMappingURL=ai.worker.js.map
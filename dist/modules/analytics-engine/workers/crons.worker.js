/**
 * analytics.crons — cron check-in outcomes and monitor state.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.10
 * Metrics: docs/analytics/10-analytics-catalog.md §10
 *
 * Reads  : events_cron_checkins
 * Writes : cron_metrics_1m, cron_monitor_state
 *
 * Missed-run detection infers the expected interval from the median gap between
 * the last 20 check-ins, so it works without the user declaring a schedule.
 */
import { buildInsertSelect } from '../rollup-writer.js';
import { histogramSql } from '../histogram.js';
import { AGG, buildBucketRecomputeSql, runRollupWorker, } from './base.js';
const SOURCE = 'events_cron_checkins';
const TABLE = 'cron_metrics_1m';
const STATE_TABLE = 'cron_monitor_state';
const MONITOR = "COALESCE(e.monitor_slug, 'unknown')";
const STATUS = "LOWER(COALESCE(e.status, 'unknown'))";
const COLUMNS = [
    'organization_id',
    'project_id',
    'environment',
    'bucket',
    'entity_key',
    'entity_label',
    'monitor_slug',
    'checkin_count',
    'ok_count',
    'error_count',
    'in_progress_count',
    'missed_count',
    'last_status',
    'last_checkin_at',
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
export function createCronsWorker(watermarks) {
    return {
        id: 'analytics.crons',
        queue: 'analytics.crons',
        tier: 'standard',
        windowSize: '1m',
        sourceTables: [SOURCE],
        outputTables: [TABLE, STATE_TABLE],
        concurrency: 2,
        retryLimit: 5,
        retryBackoffSeconds: 30,
        lateGraceSeconds: 1_800,
        maxSpanMinutes: 120,
        description: 'Cron check-in outcome counters, duration distribution, current monitor state and inferred missed-run detection.',
        async run(ctx, job) {
            return runRollupWorker(ctx, job, watermarks, {
                workerId: 'analytics.crons',
                window: '1m',
                sizingTable: SOURCE,
                lateGraceSeconds: 1_800,
                maxSpanMinutes: 120,
                statements: (slice) => {
                    const params = [slice.orgId, slice.ingestStart, slice.ingestEnd, slice.recomputeFrom];
                    const select = buildBucketRecomputeSql({
                        source: SOURCE,
                        window: '1m',
                        columns: COLUMNS,
                        entityKeyExpr: MONITOR,
                        entityLabelExpr: MONITOR,
                        aggregates: [
                            `MIN(${MONITOR})`,
                            AGG.count(),
                            AGG.filterCount(`${STATUS} = 'ok'`),
                            AGG.filterCount(`${STATUS} IN ('error','failed')`),
                            AGG.filterCount(`${STATUS} IN ('in_progress','running')`),
                            // Missed runs are a state-table concern (needs cross-bucket history).
                            '0::bigint',
                            `(ARRAY_AGG(${STATUS} ORDER BY e.occurred_at DESC))[1]`,
                            'MAX(e.occurred_at)',
                            AGG.sum('e.duration_ms'),
                            AGG.max('e.duration_ms'),
                            AGG.percentile('e.duration_ms', 0.5),
                            AGG.percentile('e.duration_ms', 0.75),
                            AGG.percentile('e.duration_ms', 0.9),
                            AGG.percentile('e.duration_ms', 0.95),
                            AGG.percentile('e.duration_ms', 0.99),
                            histogramSql('e.duration_ms'),
                            AGG.count(),
                        ],
                    });
                    /**
                     * Monitor state. Interval inference uses the median gap over the last 20
                     * check-ins; `is_missing` flips when the gap since the last check-in
                     * exceeds 1.5x that interval.
                     */
                    const stateSql = `
            INSERT INTO ${STATE_TABLE} (
              organization_id, project_id, environment, monitor_slug,
              last_status, last_checkin_at, last_duration_ms,
              expected_interval_seconds, consecutive_failures, checkin_count_total, is_missing
            )
            WITH recent AS (
              SELECT e.organization_id, e.project_id, e.environment,
                     ${MONITOR} AS monitor_slug,
                     e.occurred_at, ${STATUS} AS status, e.duration_ms,
                     ROW_NUMBER() OVER (
                       PARTITION BY e.organization_id, e.project_id, e.environment, ${MONITOR}
                       ORDER BY e.occurred_at DESC
                     ) AS rn,
                     LAG(e.occurred_at) OVER (
                       PARTITION BY e.organization_id, e.project_id, e.environment, ${MONITOR}
                       ORDER BY e.occurred_at
                     ) AS prev_at
                FROM ${SOURCE} e
               WHERE e.organization_id = $1
                 AND e.project_id IS NOT NULL
                 AND e.occurred_at >= $4 - INTERVAL '7 days'
                 AND ${MONITOR} IN (
                   SELECT DISTINCT ${MONITOR}
                     FROM ${SOURCE} e
                    WHERE e.organization_id = $1
                      AND e.ingested_at >= $2 AND e.ingested_at < $3
                 )
            ),
            windowed AS (SELECT * FROM recent WHERE rn <= 20),
            gaps AS (
              SELECT organization_id, project_id, environment, monitor_slug,
                     PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (occurred_at - prev_at))
                     ) AS median_gap_seconds
                FROM windowed
               WHERE prev_at IS NOT NULL
               GROUP BY 1, 2, 3, 4
            ),
            latest AS (
              SELECT organization_id, project_id, environment, monitor_slug,
                     status, occurred_at AS last_checkin_at, duration_ms
                FROM windowed
               WHERE rn = 1
            ),
            failures AS (
              SELECT organization_id, project_id, environment, monitor_slug,
                     COUNT(*) FILTER (
                       WHERE status IN ('error','failed')
                     )::int AS failure_count,
                     COUNT(*)::bigint AS checkin_count
                FROM windowed
               GROUP BY 1, 2, 3, 4
            )
            SELECT l.organization_id,
                   l.project_id,
                   l.environment,
                   l.monitor_slug,
                   l.status,
                   l.last_checkin_at,
                   l.duration_ms,
                   NULLIF(ROUND(g.median_gap_seconds::numeric), 0)::int,
                   COALESCE(f.failure_count, 0),
                   COALESCE(f.checkin_count, 0),
                   CASE
                     WHEN g.median_gap_seconds IS NULL THEN FALSE
                     ELSE NOW() - l.last_checkin_at > (g.median_gap_seconds * 1.5) * INTERVAL '1 second'
                   END
              FROM latest l
              LEFT JOIN gaps g USING (organization_id, project_id, environment, monitor_slug)
              LEFT JOIN failures f USING (organization_id, project_id, environment, monitor_slug)
            ON CONFLICT (organization_id, project_id, environment, monitor_slug) DO UPDATE
               SET last_status               = EXCLUDED.last_status,
                   last_checkin_at           = GREATEST(${STATE_TABLE}.last_checkin_at, EXCLUDED.last_checkin_at),
                   last_duration_ms          = EXCLUDED.last_duration_ms,
                   expected_interval_seconds = COALESCE(EXCLUDED.expected_interval_seconds, ${STATE_TABLE}.expected_interval_seconds),
                   consecutive_failures      = EXCLUDED.consecutive_failures,
                   checkin_count_total       = EXCLUDED.checkin_count_total,
                   is_missing                = EXCLUDED.is_missing,
                   updated_at                = NOW()`;
                    return [
                        { table: TABLE, sql: buildInsertSelect(TABLE, 'B', COLUMNS, select), params },
                        { table: STATE_TABLE, sql: stateSql, params },
                    ];
                },
            });
        },
    };
}
//# sourceMappingURL=crons.worker.js.map
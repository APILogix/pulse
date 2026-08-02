/**
 * Platform maintenance jobs: partitions and retention.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.25 / §3.26
 *
 * Retention operates on an ALLOWLIST only. The SQL helper
 * analytics_engine_drop_partitions_before() raises if asked to touch anything
 * outside the analytics-engine table set, so a bug here cannot delete telemetry.
 */
import { retentionCutoff } from '../windows.js';
import { WINDOW_SIZES } from '../types.js';
import { COMPACTION_TARGETS } from './compaction.worker.js';
/** Tables with a single fixed window (no compaction chain). */
const SINGLE_WINDOW_TABLES = [
    { table: 'error_dimension_metrics_1h', window: '1h' },
    { table: 'logger_metrics_1h', window: '1h' },
    { table: 'db_metrics_1h', window: '1h' },
    { table: 'dependency_metrics_1h', window: '1h' },
    { table: 'trace_edge_metrics_1h', window: '1h' },
    { table: 'profile_metrics_1h', window: '1h' },
    { table: 'profile_function_metrics_1h', window: '1h' },
    { table: 'replay_metrics_1h', window: '1h' },
    { table: 'session_metrics_1h', window: '1h' },
    { table: 'user_metrics_1d', window: '1d' },
    { table: 'geo_metrics_1h', window: '1h' },
    { table: 'device_metrics_1h', window: '1h' },
    { table: 'sdk_metrics_1h', window: '1h' },
    { table: 'release_metrics_1h', window: '1h' },
    { table: 'slo_metrics_5m', window: '5m' },
    { table: 'slo_metrics_1h', window: '1h' },
    { table: 'security_metrics_1h', window: '1h' },
    { table: 'usage_metrics_1d', window: '1d' },
    { table: 'cost_metrics_1d', window: '1d' },
    { table: 'ingest_health_metrics_5m', window: '5m' },
    { table: 'alert_metrics_1h', window: '1h' },
    { table: 'ai_metrics_1m', window: '1m' },
    { table: 'ai_metrics_1h', window: '1h' },
    { table: 'project_health_5m', window: '5m' },
];
/** Every analytics-owned partitioned table with the retention tier it follows. */
export function retentionTargets() {
    const targets = [];
    for (const entry of COMPACTION_TARGETS) {
        for (const window of entry.windows) {
            targets.push({ table: `${entry.base}_${window}`, window });
        }
    }
    targets.push(...SINGLE_WINDOW_TABLES);
    return targets;
}
export async function ensurePartitions(pool, logger, daysAhead = 7) {
    const result = await pool.query('SELECT analytics_engine_ensure_partitions($1) AS created', [daysAhead]);
    const created = Number(result.rows[0]?.created ?? 0);
    logger.info({ created, daysAhead }, 'Analytics engine partitions ensured');
    return created;
}
/**
 * Prunes analytics-owned rollups.
 *
 * Whole partitions are dropped where possible; the DEFAULT partition (which
 * holds any row outside the declared ranges) is pruned with a bounded DELETE.
 */
export async function runRetention(pool, logger, now = new Date()) {
    const outcomes = [];
    for (const target of retentionTargets()) {
        const cutoff = retentionCutoff(target.window, now);
        let partitionsDropped = 0;
        let rowsDeleted = 0;
        try {
            const dropped = await pool.query('SELECT analytics_engine_drop_partitions_before($1, $2) AS dropped', [target.table, cutoff]);
            partitionsDropped = Number(dropped.rows[0]?.dropped ?? 0);
            const deleted = await pool.query(`DELETE FROM ${target.table} WHERE bucket < $1`, [cutoff]);
            rowsDeleted = deleted.rowCount ?? 0;
            if (partitionsDropped > 0 || rowsDeleted > 0) {
                await pool.query(`INSERT INTO retention_statistics (table_name, bucket, rows_pruned, metadata)
           VALUES ($1, CURRENT_DATE, $2, $3::jsonb)`, [
                    target.table,
                    rowsDeleted,
                    JSON.stringify({
                        window: target.window,
                        partitionsDropped,
                        cutoff: cutoff.toISOString(),
                        owner: 'analytics-engine',
                    }),
                ]).catch((error) => {
                    // Retention accounting is best-effort; never fail pruning because the
                    // statistics table is unavailable.
                    logger.warn({ err: error, table: target.table }, 'Could not record retention statistics');
                });
            }
        }
        catch (error) {
            logger.error({ err: error, table: target.table }, 'Analytics retention failed for one table');
            continue;
        }
        outcomes.push({ table: target.table, window: target.window, partitionsDropped, rowsDeleted });
    }
    // Ledgers have their own fixed retention.
    await pool.query(`DELETE FROM analytics_worker_runs WHERE started_at < NOW() - INTERVAL '14 days'`).catch((error) => {
        logger.warn({ err: error }, 'Could not prune analytics_worker_runs');
    });
    await pool.query(`DELETE FROM anomaly_detections WHERE detected_at < NOW() - INTERVAL '90 days'`).catch((error) => {
        logger.warn({ err: error }, 'Could not prune anomaly_detections');
    });
    const totals = outcomes.reduce((acc, outcome) => ({
        partitions: acc.partitions + outcome.partitionsDropped,
        rows: acc.rows + outcome.rowsDeleted,
    }), { partitions: 0, rows: 0 });
    logger.info({ tables: outcomes.length, ...totals, windows: WINDOW_SIZES }, 'Analytics retention pass complete');
    return outcomes;
}
//# sourceMappingURL=maintenance.worker.js.map
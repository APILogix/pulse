import { logger } from '../config/logger.js';
const gaugeLogger = logger.child({ component: 'backpressure-gauge' });
/**
 * Cross-process backpressure gauge.
 *
 * Reads live queue metrics from Supabase PGMQ (pgmq.metrics_all() across the
 * ingest_* queues), so every API process sees the same live depth. Reads
 * fail open (return null) so readiness policy decides how to react.
 */
export class BackpressureGauge {
    db;
    constructor(db) {
        this.db = db;
    }
    async read() {
        try {
            const result = await this.db.query(`SELECT COALESCE(SUM(queue_length), 0)::bigint AS pending_depth
         FROM pgmq.metrics_all()
         WHERE queue_name LIKE 'ingest_%' OR queue_name LIKE 'ingest.%'`);
            const row = result.rows[0];
            if (!row)
                return null;
            return {
                pendingDepth: Number(row.pending_depth ?? 0),
                // Fresh on every read, so callers' staleness checks always pass.
                updatedAt: new Date(),
                lastWorkerId: null,
            };
        }
        catch (err) {
            // PGMQ extension not yet created (first boot) or transient error.
            gaugeLogger.error({ err }, 'Failed to read backpressure gauge');
            return null;
        }
    }
    /**
     * @deprecated No-op since the pg-boss cutover — depth is read live from
     * pgboss.job; nothing needs to write the gauge. Retained so legacy callers
     * still compile.
     */
    async update(_depth, _workerId) {
        // intentionally a no-op
    }
    isStale(state, maxAgeMs) {
        return Date.now() - state.updatedAt.getTime() > maxAgeMs;
    }
}
//# sourceMappingURL=gauge.js.map
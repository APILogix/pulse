import { logger } from '../config/logger.js';
const gaugeLogger = logger.child({ component: 'backpressure-gauge' });
/**
 * Cross-process backpressure gauge.
 *
 * The singleton row is shared by all API and worker processes through Postgres.
 * Workers write; API servers read. Reads are O(1) and intentionally fail open
 * to the caller so readiness policy decides how to react.
 */
export class BackpressureGauge {
    db;
    constructor(db) {
        this.db = db;
    }
    async read() {
        try {
            const result = await this.db.query(`SELECT pending_depth, updated_at, last_worker_id
         FROM backpressure_gauge
         WHERE id = 1`);
            const row = result.rows[0];
            if (!row)
                return null;
            return {
                pendingDepth: Number(row.pending_depth ?? 0),
                updatedAt: new Date(row.updated_at),
                lastWorkerId: typeof row.last_worker_id === 'string' ? row.last_worker_id : null,
            };
        }
        catch (err) {
            gaugeLogger.error({ err }, 'Failed to read backpressure gauge');
            return null;
        }
    }
    async update(depth, workerId) {
        try {
            await this.db.query(`UPDATE backpressure_gauge
         SET pending_depth = $1,
             updated_at = NOW(),
             last_worker_id = $2
         WHERE id = 1`, [Math.max(0, Math.trunc(depth)), workerId]);
        }
        catch (err) {
            gaugeLogger.error({ err, depth, workerId }, 'Failed to update backpressure gauge');
        }
    }
    isStale(state, maxAgeMs) {
        return Date.now() - state.updatedAt.getTime() > maxAgeMs;
    }
}
//# sourceMappingURL=gauge.js.map
import { pool } from '../../../config/database.js';
import { AlertConflictError, AlertNotFoundError, } from '../types.js';
function pgCode(e) {
    return typeof e === 'object' && e !== null ? e.code : undefined;
}
export class MetricsRepository {
    db = pool;
    async withTransaction(fn) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    // ── Rules ──────────────────────────────────────────────────────────────
    // ── Events: ingestion + deduplication ────────────────────────────────────
    // ── Batch lifecycle ──────────────────────────────────────────────────────
    // ── Auto-resolve + escalation sweeps ─────────────────────────────────────
    // ── Silences ─────────────────────────────────────────────────────────────
    // ── Escalation policies + steps ──────────────────────────────────────────
    // ── Templates ────────────────────────────────────────────────────────────
    // ── Routing rules ──────────────────────────────────────────────────────
    // ── Metrics + stats ──────────────────────────────────────────────────────
    async queryMetrics(organizationId, filters) {
        const conditions = ['organization_id=$1', 'granularity=$2'];
        const params = [organizationId, filters.granularity];
        if (filters.metricType) {
            params.push(filters.metricType);
            conditions.push(`metric_type=$${params.length}`);
        }
        if (filters.ruleId) {
            params.push(filters.ruleId);
            conditions.push(`rule_id=$${params.length}`);
        }
        if (filters.from) {
            params.push(filters.from);
            conditions.push(`bucket_start >= $${params.length}`);
        }
        if (filters.to) {
            params.push(filters.to);
            conditions.push(`bucket_start <= $${params.length}`);
        }
        params.push(filters.limit);
        const r = await this.db.query(`SELECT * FROM alert_metrics WHERE ${conditions.join(' AND ')}
       ORDER BY bucket_start DESC LIMIT $${params.length}`, params);
        return r.rows;
    }
    /** Real-time dashboard stats computed directly from alert_events. */
    async getRealtimeStats(organizationId) {
        const r = await this.db.query(`SELECT
         COUNT(*) FILTER (WHERE status='firing')::text AS firing,
         COUNT(*) FILTER (WHERE status='acknowledged')::text AS acknowledged,
         COUNT(*) FILTER (WHERE status='resolved' AND resolved_at >= NOW() - INTERVAL '24 hours')::text AS resolved_24h,
         AVG(EXTRACT(EPOCH FROM (resolved_at - started_at))) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at >= NOW() - INTERVAL '24 hours')::text AS mttr,
         AVG(EXTRACT(EPOCH FROM (acknowledged_at - started_at))) FILTER (WHERE acknowledged_at IS NOT NULL AND acknowledged_at >= NOW() - INTERVAL '24 hours')::text AS mtta
       FROM alert_events WHERE organization_id=$1`, [organizationId]);
        const row = r.rows[0];
        return {
            firing: Number(row.firing),
            acknowledged: Number(row.acknowledged),
            resolvedLast24h: Number(row.resolved_24h),
            mttrSeconds: row.mttr !== null ? Math.round(Number(row.mttr)) : null,
            mttaSeconds: row.mtta !== null ? Math.round(Number(row.mtta)) : null,
        };
    }
}
//# sourceMappingURL=metrics.repository.js.map
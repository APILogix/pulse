import { pool } from '../../../config/database.js';
import { AlertConflictError, AlertNotFoundError, } from '../types.js';
function pgCode(e) {
    return typeof e === 'object' && e !== null ? e.code : undefined;
}
export class SilencesRepository {
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
    async createSilence(input) {
        const r = await this.db.query(`INSERT INTO alert_silences (organization_id, rule_id, created_by, comment, starts_at, ends_at, matchers)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [input.organizationId, input.ruleId, input.createdBy, input.comment, input.startsAt, input.endsAt, JSON.stringify(input.matchers)]);
        return r.rows[0];
    }
    async listSilences(organizationId, active, limit, offset) {
        const conditions = ['organization_id=$1'];
        const params = [organizationId];
        if (active === true)
            conditions.push(`is_active=true AND ends_at > NOW()`);
        if (active === false)
            conditions.push(`(is_active=false OR ends_at <= NOW())`);
        const where = conditions.join(' AND ');
        const countRes = await this.db.query(`SELECT COUNT(*)::text AS count FROM alert_silences WHERE ${where}`, params);
        params.push(limit, offset);
        const r = await this.db.query(`SELECT * FROM alert_silences WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async expireSilence(organizationId, id) {
        const r = await this.db.query(`UPDATE alert_silences SET is_active=false, expired_at=NOW(), ends_at=LEAST(ends_at, NOW())
       WHERE id=$1 AND organization_id=$2 AND is_active=true`, [id, organizationId]);
        if (r.rowCount === 0)
            throw new AlertNotFoundError('Active silence');
    }
    /** Active silences applicable to a rule (rule-specific or global) right now. */
    async findActiveSilences(organizationId, ruleId) {
        const r = await this.db.query(`SELECT * FROM alert_silences
       WHERE organization_id=$1 AND is_active=true
         AND starts_at <= NOW() AND ends_at > NOW()
         AND (rule_id IS NULL OR rule_id=$2)`, [organizationId, ruleId]);
        return r.rows;
    }
}
//# sourceMappingURL=silences.repository.js.map
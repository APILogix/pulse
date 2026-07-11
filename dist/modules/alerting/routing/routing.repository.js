import { pool } from '../../../config/database.js';
import { AlertConflictError, AlertNotFoundError, } from '../types.js';
function pgCode(e) {
    return typeof e === 'object' && e !== null ? e.code : undefined;
}
export class RoutingRepository {
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
    async createRoutingRule(input) {
        try {
            const r = await this.db.query(`INSERT INTO alert_routing_rules
           (organization_id, name, description, priority, conditions, target_connector_ids,
            target_route_ids, fallback_connector_ids, template_id, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [
                input.organizationId, input.name, input.description, input.priority,
                JSON.stringify(input.conditions), input.targetConnectorIds, input.targetRouteIds,
                input.fallbackConnectorIds, input.templateId, input.isActive,
            ]);
            return r.rows[0];
        }
        catch (e) {
            if (pgCode(e) === '23505')
                throw new AlertConflictError('A routing rule with this name already exists');
            throw e;
        }
    }
    async listRoutingRules(organizationId) {
        const r = await this.db.query(`SELECT * FROM alert_routing_rules WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY priority DESC, created_at DESC`, [organizationId]);
        return r.rows;
    }
    async findRoutingRule(organizationId, id) {
        const r = await this.db.query(`SELECT * FROM alert_routing_rules WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId]);
        return r.rows[0] ?? null;
    }
    async deleteRoutingRule(organizationId, id) {
        const r = await this.db.query(`UPDATE alert_routing_rules SET deleted_at=NOW(), is_active=false WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId]);
        if (r.rowCount === 0)
            throw new AlertNotFoundError('Routing rule');
    }
}
//# sourceMappingURL=routing.repository.js.map
import { pool } from '../../../config/database.js';
import { ConnectorConflictError, ConnectorNotFoundError, } from '../types.js';
export class ConnectorAuditRepository {
    db = pool;
    // ── Connector CRUD ─────────────────────────────────────────────────────
    // ── Health / failure bookkeeping ───────────────────────────────────────
    // ── Deliveries ─────────────────────────────────────────────────────────
    // ── Dead letter ────────────────────────────────────────────────────────
    // ── Audit ──────────────────────────────────────────────────────────────
    async insertAuditLog(input) {
        await this.db.query(`INSERT INTO connector_audit_logs
         (organization_id, connector_id, action, actor_id, actor_type,
          previous_state, new_state, changes_summary, ip_address, user_agent, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
            input.organizationId, input.connectorId, input.action, input.actorId,
            input.actorType ?? (input.actorId ? 'user' : 'system'),
            input.previousState ? JSON.stringify(input.previousState) : null,
            input.newState ? JSON.stringify(input.newState) : null,
            input.changesSummary ? JSON.stringify(input.changesSummary) : null,
            input.ipAddress ?? null, input.userAgent ?? null, input.requestId ?? null,
        ]);
    }
    async listAuditLogs(organizationId, connectorId, filters) {
        const conditions = ['organization_id=$1'];
        const params = [organizationId];
        if (connectorId) {
            params.push(connectorId);
            conditions.push(`connector_id=$${params.length}`);
        }
        const where = conditions.join(' AND ');
        const count = await this.db.query(`SELECT COUNT(*)::text AS count FROM connector_audit_logs WHERE ${where}`, params);
        params.push(filters.limit, filters.offset);
        const data = await this.db.query(`SELECT id, organization_id, connector_id, action, actor_id, actor_type,
              previous_state, new_state, changes_summary, ip_address::text, user_agent,
              request_id::text, created_at
       FROM connector_audit_logs
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { data: data.rows, total: Number(count.rows[0]?.count ?? 0) };
    }
}
//# sourceMappingURL=audit.repository.js.map
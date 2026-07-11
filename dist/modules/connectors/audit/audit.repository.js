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
            input.actorType ?? 'user',
            input.previousState ? JSON.stringify(input.previousState) : null,
            input.newState ? JSON.stringify(input.newState) : null,
            input.changesSummary ? JSON.stringify(input.changesSummary) : null,
            input.ipAddress ?? null, input.userAgent ?? null, input.requestId ?? null,
        ]);
    }
}
//# sourceMappingURL=audit.repository.js.map
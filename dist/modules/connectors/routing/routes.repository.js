import { pool } from '../../../config/database.js';
import { ConnectorNotFoundError } from '../types.js';
export class ConnectorRoutesRepository {
    db = pool;
    async createRoute(organizationId, connectorId, input) {
        await this.requireOwnedConnector(organizationId, connectorId);
        await this.requireOwnedProject(organizationId, input.projectId ?? null);
        const r = await this.db.query(`INSERT INTO connector_routes (connector_id, project_id, environment, event_type, severity, enabled)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, connector_id, project_id, environment, event_type, severity, enabled, created_at`, [
            connectorId,
            input.projectId ?? null,
            input.environment ?? null,
            input.eventType,
            input.severity ?? null,
            input.enabled,
        ]);
        return r.rows[0];
    }
    async updateRoute(organizationId, connectorId, routeId, input) {
        await this.requireOwnedConnector(organizationId, connectorId);
        if (input.projectId !== undefined) {
            await this.requireOwnedProject(organizationId, input.projectId);
        }
        const fields = [];
        const values = [];
        const push = (column, value) => {
            fields.push(`${column}=$${fields.length + 1}`);
            values.push(value);
        };
        if (input.projectId !== undefined)
            push('project_id', input.projectId);
        if (input.environment !== undefined)
            push('environment', input.environment);
        if (input.eventType !== undefined)
            push('event_type', input.eventType);
        if (input.severity !== undefined)
            push('severity', input.severity);
        if (input.enabled !== undefined)
            push('enabled', input.enabled);
        if (fields.length === 0)
            return this.getRoute(organizationId, connectorId, routeId);
        values.push(routeId, connectorId);
        const r = await this.db.query(`UPDATE connector_routes SET ${fields.join(', ')}
       WHERE id=$${values.length - 1} AND connector_id=$${values.length}
       RETURNING id, connector_id, project_id, environment, event_type, severity, enabled, created_at`, values);
        return r.rows[0] ?? null;
    }
    async deleteRoute(organizationId, connectorId, routeId) {
        await this.requireOwnedConnector(organizationId, connectorId);
        const r = await this.db.query(`DELETE FROM connector_routes WHERE id=$1 AND connector_id=$2`, [routeId, connectorId]);
        return (r.rowCount ?? 0) > 0;
    }
    async getRoute(organizationId, connectorId, routeId) {
        await this.requireOwnedConnector(organizationId, connectorId);
        const r = await this.db.query(`SELECT id, connector_id, project_id, environment, event_type, severity, enabled, created_at
       FROM connector_routes
       WHERE id=$1 AND connector_id=$2`, [routeId, connectorId]);
        return r.rows[0] ?? null;
    }
    async listRoutes(organizationId, connectorId, filters) {
        await this.requireOwnedConnector(organizationId, connectorId);
        const count = await this.db.query(`SELECT COUNT(*)::text AS count FROM connector_routes WHERE connector_id=$1`, [connectorId]);
        const data = await this.db.query(`SELECT id, connector_id, project_id, environment, event_type, severity, enabled, created_at
       FROM connector_routes
       WHERE connector_id=$1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`, [connectorId, filters.limit, filters.offset]);
        return { data: data.rows, total: Number(count.rows[0]?.count ?? 0) };
    }
    async listRoutesByIds(organizationId, routeIds) {
        if (routeIds.length === 0)
            return [];
        const r = await this.db.query(`SELECT r.id, r.connector_id, r.project_id, r.environment, r.event_type, r.severity, r.enabled, r.created_at
       FROM connector_routes r
       JOIN connector_configs c ON c.id=r.connector_id
       WHERE r.id = ANY($1::uuid[])
         AND c.organization_id=$2
         AND c.deleted_at IS NULL
         AND r.enabled=TRUE`, [routeIds, organizationId]);
        return r.rows;
    }
    async createOAuthState(input) {
        const r = await this.db.query(`INSERT INTO connector_oauth_states (connector_id, state, code_verifier, expires_at)
       VALUES ($1,$2,$3,$4)
       RETURNING id, connector_id, state, code_verifier, expires_at, created_at`, [input.connectorId, input.state, input.codeVerifier, input.expiresAt]);
        return r.rows[0];
    }
    async consumeOAuthState(organizationId, connectorId, state) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const row = await client.query(`SELECT s.id, s.connector_id, s.state, s.code_verifier, s.expires_at, s.created_at
         FROM connector_oauth_states s
         JOIN connector_configs c ON c.id=s.connector_id
         WHERE s.connector_id=$1 AND c.organization_id=$2 AND s.state=$3 AND s.expires_at > NOW()
         FOR UPDATE`, [connectorId, organizationId, state]);
            const oauthState = row.rows[0];
            if (!oauthState) {
                await client.query('ROLLBACK');
                return null;
            }
            await client.query(`DELETE FROM connector_oauth_states WHERE id=$1`, [oauthState.id]);
            await client.query('COMMIT');
            return oauthState;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async cleanupExpiredOAuthStates() {
        const result = await this.db.query(`DELETE FROM connector_oauth_states WHERE expires_at <= NOW()`);
        return result.rowCount ?? 0;
    }
    async requireOwnedConnector(organizationId, connectorId) {
        const r = await this.db.query(`SELECT EXISTS(
         SELECT 1 FROM connector_configs
         WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL
       ) AS "exists"`, [connectorId, organizationId]);
        if (!r.rows[0]?.exists)
            throw new ConnectorNotFoundError(connectorId);
    }
    async requireOwnedProject(organizationId, projectId) {
        if (!projectId)
            return;
        const r = await this.db.query(`SELECT EXISTS(
         SELECT 1 FROM projects
         WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL
       ) AS "exists"`, [projectId, organizationId]);
        if (!r.rows[0]?.exists)
            throw new ConnectorNotFoundError(projectId);
    }
}
//# sourceMappingURL=routes.repository.js.map
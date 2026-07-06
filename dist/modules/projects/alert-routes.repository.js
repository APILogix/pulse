import { pool } from "../../config/database.js";
import { ProjectError } from "./utils.js";
const ROUTE_COLUMNS = `
  id, project_id, organization_id, name, description,
  event_types, severity_levels, source_services, target_connector_ids,
  priority, is_active, throttle, schedule, created_at, updated_at
`;
export class AlertRoutesRepository {
    async withTransaction(callback) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await callback(client);
            await client.query("COMMIT");
            return result;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }
    mapRow(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            organizationId: row.organization_id,
            name: row.name,
            description: row.description,
            eventTypes: row.event_types || [],
            severityLevels: row.severity_levels || [],
            sourceServices: row.source_services || [],
            targetConnectorIds: row.target_connector_ids || [],
            priority: row.priority,
            isActive: row.is_active,
            throttle: row.throttle,
            schedule: row.schedule,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    async createRoute(orgId, projectId, dto, client = pool) {
        const res = await client.query(`
      INSERT INTO notification_routes (
        organization_id, project_id, name, description,
        event_types, severity_levels, source_services, target_connector_ids,
        priority, is_active, throttle, schedule
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING ${ROUTE_COLUMNS}
      `, [
            orgId,
            projectId,
            dto.name,
            dto.description ?? null,
            dto.event_types,
            dto.severity_levels,
            dto.source_services,
            dto.target_connector_ids,
            dto.priority,
            dto.is_active,
            dto.throttle ?? null,
            dto.schedule ?? null,
        ]);
        return this.mapRow(res.rows[0]);
    }
    async getRoute(routeId, orgId, projectId = null) {
        const params = [routeId, orgId];
        let query = `SELECT ${ROUTE_COLUMNS} FROM notification_routes WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`;
        if (projectId) {
            query += ` AND (project_id = $3 OR project_id IS NULL)`;
            params.push(projectId);
        }
        const res = await pool.query(query, params);
        return res.rows.length ? this.mapRow(res.rows[0]) : null;
    }
    async listRoutes(orgId, projectId, query) {
        let sql = `SELECT ${ROUTE_COLUMNS} FROM notification_routes WHERE organization_id = $1 AND (project_id = $2 OR project_id IS NULL) AND deleted_at IS NULL`;
        const params = [orgId, projectId];
        let idx = 3;
        if (query.is_active !== undefined) {
            sql += ` AND is_active = $${idx++}`;
            params.push(query.is_active === "true");
        }
        sql += ` ORDER BY priority DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(query.limit, query.offset);
        const res = await pool.query(sql, params);
        return res.rows.map((row) => this.mapRow(row));
    }
    async updateRoute(routeId, dto, client = pool) {
        const fields = [];
        const values = [];
        let idx = 1;
        for (const [key, val] of Object.entries(dto)) {
            if (val !== undefined) {
                fields.push(`${key} = $${idx++}`);
                values.push(val);
            }
        }
        if (fields.length === 0) {
            const res = await client.query(`SELECT ${ROUTE_COLUMNS} FROM notification_routes WHERE id = $1`, [routeId]);
            return this.mapRow(res.rows[0]);
        }
        fields.push(`updated_at = NOW()`);
        values.push(routeId);
        const res = await client.query(`
      UPDATE notification_routes
      SET ${fields.join(", ")}
      WHERE id = $${idx} AND deleted_at IS NULL
      RETURNING ${ROUTE_COLUMNS}
      `, values);
        if (!res.rows.length) {
            throw new ProjectError("ROUTE_NOT_FOUND", "Route not found", 404);
        }
        return this.mapRow(res.rows[0]);
    }
    async deleteRoute(routeId, client = pool) {
        const res = await client.query(`UPDATE notification_routes SET deleted_at = NOW(), is_active = false WHERE id = $1`, [routeId]);
        if (res.rowCount === 0) {
            throw new ProjectError("ROUTE_NOT_FOUND", "Route not found", 404);
        }
    }
    async unsetDefaultRoute(projectId, orgId, client = pool) {
        // Only one route per project is default if we implement that.
        // The instructions say: "If is_default = true, unset previous default for this project_id + connector_type."
        // We don't have is_default on notification_routes per the provided schema. But if needed, we can implement it.
    }
}
//# sourceMappingURL=alert-routes.repository.js.map
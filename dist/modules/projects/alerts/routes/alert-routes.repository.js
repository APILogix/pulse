import { pool } from "../../../../config/database.js";
import { ProjectError } from "../../shared/utils.js";
const ROUTE_COLUMNS = `
  id, project_id, organization_id, name, description, connector_id, enabled,
  destination_metadata, created_at, updated_at
`;
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
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
        const metadata = (row.destination_metadata ?? {});
        return {
            id: row.id,
            projectId: row.project_id,
            organizationId: row.organization_id,
            name: row.name,
            description: row.description ?? null,
            eventTypes: stringArray(metadata.event_types),
            severityLevels: stringArray(metadata.severity_levels),
            sourceServices: stringArray(metadata.source_services),
            targetConnectorIds: typeof row.connector_id === "string" ? [row.connector_id] : [],
            priority: typeof metadata.priority === "number" ? metadata.priority : 100,
            isActive: row.enabled === true,
            throttle: metadata.throttle ?? null,
            schedule: metadata.schedule ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    async createRoute(orgId, projectId, dto, client = pool) {
        const connectorId = dto.target_connector_ids[0] ?? null;
        const destinationMetadata = {
            event_types: dto.event_types,
            severity_levels: dto.severity_levels,
            source_services: dto.source_services,
            priority: dto.priority,
            throttle: dto.throttle ?? null,
            schedule: dto.schedule ?? null,
        };
        const res = await client.query(`INSERT INTO project_alert_channels (
         organization_id, project_id, connector_id, channel_type, name,
         description, destination_metadata, enabled
       ) VALUES (
         $1, $2, $3,
         COALESCE((SELECT provider FROM connector_configs
                    WHERE id = $3 AND organization_id = $1 AND deleted_at IS NULL), 'route'),
         $4, $5, $6::jsonb, $7
       )
       RETURNING ${ROUTE_COLUMNS}`, [orgId, projectId, connectorId, dto.name, dto.description ?? null, JSON.stringify(destinationMetadata), dto.is_active]);
        return this.mapRow(res.rows[0]);
    }
    async getRoute(routeId, orgId, projectId) {
        const res = await pool.query(`SELECT ${ROUTE_COLUMNS}
         FROM project_alert_channels
        WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND deleted_at IS NULL`, [routeId, orgId, projectId]);
        return res.rows[0] ? this.mapRow(res.rows[0]) : null;
    }
    async listRoutes(orgId, projectId, query) {
        const params = [orgId, projectId];
        let sql = `SELECT ${ROUTE_COLUMNS}
                 FROM project_alert_channels
                WHERE organization_id = $1 AND project_id = $2 AND deleted_at IS NULL`;
        if (query.is_active !== undefined) {
            params.push(query.is_active === "true");
            sql += ` AND enabled = $${params.length}`;
        }
        if (query.connector_type !== undefined) {
            params.push(query.connector_type);
            sql += ` AND channel_type = $${params.length}`;
        }
        params.push(query.limit, query.offset);
        sql += ` ORDER BY COALESCE((destination_metadata ->> 'priority')::integer, 100) DESC, created_at ASC
             LIMIT $${params.length - 1} OFFSET $${params.length}`;
        const res = await pool.query(sql, params);
        return res.rows.map((row) => this.mapRow(row));
    }
    async updateRoute(routeId, orgId, projectId, dto, client = pool) {
        const fields = [];
        const values = [];
        const add = (column, value) => {
            values.push(value);
            fields.push(`${column} = $${values.length}`);
        };
        if (dto.name !== undefined)
            add("name", dto.name);
        if (dto.description !== undefined)
            add("description", dto.description);
        if (dto.is_active !== undefined)
            add("enabled", dto.is_active);
        if (dto.target_connector_ids !== undefined) {
            const connectorId = dto.target_connector_ids[0] ?? null;
            add("connector_id", connectorId);
            values.push(orgId);
            fields.push(`channel_type = COALESCE((SELECT provider FROM connector_configs
                                            WHERE id = $${values.length - 1}
                                              AND organization_id = $${values.length}
                                              AND deleted_at IS NULL), channel_type)`);
        }
        const metadata = {};
        if (dto.event_types !== undefined)
            metadata.event_types = dto.event_types;
        if (dto.severity_levels !== undefined)
            metadata.severity_levels = dto.severity_levels;
        if (dto.source_services !== undefined)
            metadata.source_services = dto.source_services;
        if (dto.priority !== undefined)
            metadata.priority = dto.priority;
        if (dto.throttle !== undefined)
            metadata.throttle = dto.throttle;
        if (dto.schedule !== undefined)
            metadata.schedule = dto.schedule;
        if (Object.keys(metadata).length > 0) {
            values.push(JSON.stringify(metadata));
            fields.push(`destination_metadata = destination_metadata || $${values.length}::jsonb`);
        }
        if (fields.length === 0) {
            const existing = await client.query(`SELECT ${ROUTE_COLUMNS} FROM project_alert_channels
          WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND deleted_at IS NULL`, [routeId, orgId, projectId]);
            if (!existing.rows[0])
                throw new ProjectError("ROUTE_NOT_FOUND", "Route not found", 404);
            return this.mapRow(existing.rows[0]);
        }
        fields.push("updated_at = NOW()");
        values.push(routeId, orgId, projectId);
        const res = await client.query(`UPDATE project_alert_channels
          SET ${fields.join(", ")}
        WHERE id = $${values.length - 2}
          AND organization_id = $${values.length - 1}
          AND project_id = $${values.length}
          AND deleted_at IS NULL
        RETURNING ${ROUTE_COLUMNS}`, values);
        if (!res.rows[0])
            throw new ProjectError("ROUTE_NOT_FOUND", "Route not found", 404);
        return this.mapRow(res.rows[0]);
    }
    async deleteRoute(routeId, orgId, projectId, client = pool) {
        const res = await client.query(`UPDATE project_alert_channels
          SET deleted_at = NOW(), enabled = FALSE, updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND deleted_at IS NULL`, [routeId, orgId, projectId]);
        if (res.rowCount === 0)
            throw new ProjectError("ROUTE_NOT_FOUND", "Route not found", 404);
    }
}
//# sourceMappingURL=alert-routes.repository.js.map
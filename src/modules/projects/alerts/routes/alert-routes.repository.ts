import type { PoolClient } from "pg";
import { pool } from "../../../../config/database.js";
import type {
  CreateProjectAlertRouteBody,
  UpdateProjectAlertRouteBody,
  ListProjectAlertRoutesQuery,
  ProjectAlertRoute,
} from "./alert-routes.types.js";
import { ProjectError } from "../../shared/utils.js";

const ROUTE_COLUMNS = `
  id, project_id, organization_id, name, description, connector_id, enabled,
  destination_metadata, created_at, updated_at
`;

type LegacyRouteMetadata = {
  event_types?: unknown;
  severity_levels?: unknown;
  source_services?: unknown;
  priority?: unknown;
  throttle?: unknown;
  schedule?: unknown;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export class AlertRoutesRepository {
  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private mapRow(row: Record<string, unknown>): ProjectAlertRoute {
    const metadata = (row.destination_metadata ?? {}) as LegacyRouteMetadata;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      organizationId: row.organization_id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      eventTypes: stringArray(metadata.event_types),
      severityLevels: stringArray(metadata.severity_levels),
      sourceServices: stringArray(metadata.source_services),
      targetConnectorIds: typeof row.connector_id === "string" ? [row.connector_id] : [],
      priority: typeof metadata.priority === "number" ? metadata.priority : 100,
      isActive: row.enabled === true,
      throttle: (metadata.throttle as Record<string, unknown> | null | undefined) ?? null,
      schedule: (metadata.schedule as Record<string, unknown> | null | undefined) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  async createRoute(
    orgId: string,
    projectId: string,
    dto: CreateProjectAlertRouteBody,
    client: PoolClient = pool as unknown as PoolClient,
  ): Promise<ProjectAlertRoute> {
    const connectorId = dto.target_connector_ids[0] ?? null;
    const destinationMetadata: LegacyRouteMetadata = {
      event_types: dto.event_types,
      severity_levels: dto.severity_levels,
      source_services: dto.source_services,
      priority: dto.priority,
      throttle: dto.throttle ?? null,
      schedule: dto.schedule ?? null,
    };
    const res = await client.query(
      `INSERT INTO project_alert_channels (
         organization_id, project_id, connector_id, channel_type, name,
         description, destination_metadata, enabled
       ) VALUES (
         $1, $2, $3,
         COALESCE((SELECT provider FROM connector_configs
                    WHERE id = $3 AND organization_id = $1 AND deleted_at IS NULL), 'route'),
         $4, $5, $6::jsonb, $7
       )
       RETURNING ${ROUTE_COLUMNS}`,
      [orgId, projectId, connectorId, dto.name, dto.description ?? null, JSON.stringify(destinationMetadata), dto.is_active],
    );
    return this.mapRow(res.rows[0] as Record<string, unknown>);
  }

  async getRoute(routeId: string, orgId: string, projectId: string): Promise<ProjectAlertRoute | null> {
    const res = await pool.query(
      `SELECT ${ROUTE_COLUMNS}
         FROM project_alert_channels
        WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND deleted_at IS NULL`,
      [routeId, orgId, projectId],
    );
    return res.rows[0] ? this.mapRow(res.rows[0] as Record<string, unknown>) : null;
  }

  async listRoutes(orgId: string, projectId: string, query: ListProjectAlertRoutesQuery): Promise<ProjectAlertRoute[]> {
    const params: unknown[] = [orgId, projectId];
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
    return res.rows.map((row) => this.mapRow(row as Record<string, unknown>));
  }

  async updateRoute(
    routeId: string,
    orgId: string,
    projectId: string,
    dto: UpdateProjectAlertRouteBody,
    client: PoolClient = pool as unknown as PoolClient,
  ): Promise<ProjectAlertRoute> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };

    if (dto.name !== undefined) add("name", dto.name);
    if (dto.description !== undefined) add("description", dto.description);
    if (dto.is_active !== undefined) add("enabled", dto.is_active);
    if (dto.target_connector_ids !== undefined) {
      const connectorId = dto.target_connector_ids[0] ?? null;
      add("connector_id", connectorId);
      values.push(orgId);
      fields.push(`channel_type = COALESCE((SELECT provider FROM connector_configs
                                            WHERE id = $${values.length - 1}
                                              AND organization_id = $${values.length}
                                              AND deleted_at IS NULL), channel_type)`);
    }

    const metadata: LegacyRouteMetadata = {};
    if (dto.event_types !== undefined) metadata.event_types = dto.event_types;
    if (dto.severity_levels !== undefined) metadata.severity_levels = dto.severity_levels;
    if (dto.source_services !== undefined) metadata.source_services = dto.source_services;
    if (dto.priority !== undefined) metadata.priority = dto.priority;
    if (dto.throttle !== undefined) metadata.throttle = dto.throttle;
    if (dto.schedule !== undefined) metadata.schedule = dto.schedule;
    if (Object.keys(metadata).length > 0) {
      values.push(JSON.stringify(metadata));
      fields.push(`destination_metadata = destination_metadata || $${values.length}::jsonb`);
    }

    if (fields.length === 0) {
      const existing = await client.query(
        `SELECT ${ROUTE_COLUMNS} FROM project_alert_channels
          WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND deleted_at IS NULL`,
        [routeId, orgId, projectId],
      );
      if (!existing.rows[0]) throw new ProjectError("ROUTE_NOT_FOUND", "Route not found", 404);
      return this.mapRow(existing.rows[0] as Record<string, unknown>);
    }

    fields.push("updated_at = NOW()");
    values.push(routeId, orgId, projectId);
    const res = await client.query(
      `UPDATE project_alert_channels
          SET ${fields.join(", ")}
        WHERE id = $${values.length - 2}
          AND organization_id = $${values.length - 1}
          AND project_id = $${values.length}
          AND deleted_at IS NULL
        RETURNING ${ROUTE_COLUMNS}`,
      values,
    );
    if (!res.rows[0]) throw new ProjectError("ROUTE_NOT_FOUND", "Route not found", 404);
    return this.mapRow(res.rows[0] as Record<string, unknown>);
  }

  async deleteRoute(
    routeId: string,
    orgId: string,
    projectId: string,
    client: PoolClient = pool as unknown as PoolClient,
  ): Promise<void> {
    const res = await client.query(
      `UPDATE project_alert_channels
          SET deleted_at = NOW(), enabled = FALSE, updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND project_id = $3 AND deleted_at IS NULL`,
      [routeId, orgId, projectId],
    );
    if (res.rowCount === 0) throw new ProjectError("ROUTE_NOT_FOUND", "Route not found", 404);
  }
}

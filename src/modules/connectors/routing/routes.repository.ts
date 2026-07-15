import { pool } from '../../../config/database.js';
import { ConnectorNotFoundError } from '../types.js';
import type {
  ConnectorOAuthStateRow,
  ConnectorRouteRow,
  CreateConnectorRouteBody,
  UpdateConnectorRouteBody,
} from '../types.js';

export class ConnectorRoutesRepository {
  private readonly db = pool;

  async createRoute(
    organizationId: string,
    connectorId: string,
    input: CreateConnectorRouteBody,
  ): Promise<ConnectorRouteRow> {
    await this.requireOwnedConnector(organizationId, connectorId);
    await this.requireOwnedProject(organizationId, input.projectId ?? null);
    const r = await this.db.query<ConnectorRouteRow>(
      `INSERT INTO connector_routes (connector_id, project_id, environment, event_type, severity, enabled)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, connector_id, project_id, environment, event_type, severity, enabled, created_at`,
      [
        connectorId,
        input.projectId ?? null,
        input.environment ?? null,
        input.eventType,
        input.severity ?? null,
        input.enabled,
      ],
    );
    return r.rows[0]!;
  }

  async updateRoute(
    organizationId: string,
    connectorId: string,
    routeId: string,
    input: UpdateConnectorRouteBody,
  ): Promise<ConnectorRouteRow | null> {
    await this.requireOwnedConnector(organizationId, connectorId);
    if (input.projectId !== undefined) {
      await this.requireOwnedProject(organizationId, input.projectId);
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      fields.push(`${column}=$${fields.length + 1}`);
      values.push(value);
    };
    if (input.projectId !== undefined) push('project_id', input.projectId);
    if (input.environment !== undefined) push('environment', input.environment);
    if (input.eventType !== undefined) push('event_type', input.eventType);
    if (input.severity !== undefined) push('severity', input.severity);
    if (input.enabled !== undefined) push('enabled', input.enabled);
    if (fields.length === 0) return this.getRoute(organizationId, connectorId, routeId);

    values.push(routeId, connectorId);
    const r = await this.db.query<ConnectorRouteRow>(
      `UPDATE connector_routes SET ${fields.join(', ')}
       WHERE id=$${values.length - 1} AND connector_id=$${values.length}
       RETURNING id, connector_id, project_id, environment, event_type, severity, enabled, created_at`,
      values,
    );
    return r.rows[0] ?? null;
  }

  async deleteRoute(organizationId: string, connectorId: string, routeId: string): Promise<boolean> {
    await this.requireOwnedConnector(organizationId, connectorId);
    const r = await this.db.query(
      `DELETE FROM connector_routes WHERE id=$1 AND connector_id=$2`,
      [routeId, connectorId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async getRoute(
    organizationId: string,
    connectorId: string,
    routeId: string,
  ): Promise<ConnectorRouteRow | null> {
    await this.requireOwnedConnector(organizationId, connectorId);
    const r = await this.db.query<ConnectorRouteRow>(
      `SELECT id, connector_id, project_id, environment, event_type, severity, enabled, created_at
       FROM connector_routes
       WHERE id=$1 AND connector_id=$2`,
      [routeId, connectorId],
    );
    return r.rows[0] ?? null;
  }

  async listRoutes(
    organizationId: string,
    connectorId: string,
    filters: { limit: number; offset: number },
  ): Promise<{ data: ConnectorRouteRow[]; total: number }> {
    await this.requireOwnedConnector(organizationId, connectorId);
    const count = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM connector_routes WHERE connector_id=$1`,
      [connectorId],
    );
    const data = await this.db.query<ConnectorRouteRow>(
      `SELECT id, connector_id, project_id, environment, event_type, severity, enabled, created_at
       FROM connector_routes
       WHERE connector_id=$1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [connectorId, filters.limit, filters.offset],
    );
    return { data: data.rows, total: Number(count.rows[0]?.count ?? 0) };
  }

  async listRoutesByIds(organizationId: string, routeIds: string[]): Promise<ConnectorRouteRow[]> {
    if (routeIds.length === 0) return [];
    const r = await this.db.query<ConnectorRouteRow>(
      `SELECT r.id, r.connector_id, r.project_id, r.environment, r.event_type, r.severity, r.enabled, r.created_at
       FROM connector_routes r
       JOIN connector_configs c ON c.id=r.connector_id
       WHERE r.id = ANY($1::uuid[])
         AND c.organization_id=$2
         AND c.deleted_at IS NULL
         AND r.enabled=TRUE`,
      [routeIds, organizationId],
    );
    return r.rows;
  }

  async createOAuthState(input: {
    connectorId: string;
    state: string;
    codeVerifier: string;
    expiresAt: Date;
  }): Promise<ConnectorOAuthStateRow> {
    const r = await this.db.query<ConnectorOAuthStateRow>(
      `INSERT INTO connector_oauth_states (connector_id, state, code_verifier, expires_at)
       VALUES ($1,$2,$3,$4)
       RETURNING id, connector_id, state, code_verifier, expires_at, created_at`,
      [input.connectorId, input.state, input.codeVerifier, input.expiresAt],
    );
    return r.rows[0]!;
  }

  async consumeOAuthState(
    organizationId: string,
    connectorId: string,
    state: string,
  ): Promise<ConnectorOAuthStateRow | null> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query<ConnectorOAuthStateRow>(
        `SELECT s.id, s.connector_id, s.state, s.code_verifier, s.expires_at, s.created_at
         FROM connector_oauth_states s
         JOIN connector_configs c ON c.id=s.connector_id
         WHERE s.connector_id=$1 AND c.organization_id=$2 AND s.state=$3 AND s.expires_at > NOW()
         FOR UPDATE`,
        [connectorId, organizationId, state],
      );
      const oauthState = row.rows[0];
      if (!oauthState) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(`DELETE FROM connector_oauth_states WHERE id=$1`, [oauthState.id]);
      await client.query('COMMIT');
      return oauthState;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cleanupExpiredOAuthStates(): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM connector_oauth_states WHERE expires_at <= NOW()`,
    );
    return result.rowCount ?? 0;
  }

  private async requireOwnedConnector(organizationId: string, connectorId: string): Promise<void> {
    const r = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM connector_configs
         WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL
       ) AS "exists"`,
      [connectorId, organizationId],
    );
    if (!r.rows[0]?.exists) throw new ConnectorNotFoundError(connectorId);
  }

  private async requireOwnedProject(organizationId: string, projectId: string | null | undefined): Promise<void> {
    if (!projectId) return;
    const r = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM projects
         WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL
       ) AS "exists"`,
      [projectId, organizationId],
    );
    if (!r.rows[0]?.exists) throw new ConnectorNotFoundError(projectId);
  }
}

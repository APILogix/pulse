/**
 * Project connector subscription persistence.
 *
 * Flow:
 * 1. Accept service-level identifiers and already-validated options.
 * 2. Enforce tenant isolation by scoping every query to project_id and/or
 *    organization_id.
 * 3. Support transactional reads/writes so alert routing can resolve targets
 *    consistently within a single connection.
 */
import type { Pool, PoolClient } from "pg";
import { pool } from "../../../../config/database.js";
import { ProjectError } from "../../shared/utils.js";
import type {
  CreateProjectConnectorSubscriptionBody,
  ListProjectConnectorSubscriptionsQuery,
  ProjectConnectorSubscription,
  UpdateProjectConnectorSubscriptionBody,
  AlertRoutingTarget,
  AlertCategory,
} from "./connector-subscription.types.js";

type DbClient = Pool | PoolClient;

const SUBSCRIPTION_COLUMNS = `
  id, project_id, organization_id, connector_id, enabled, alert_categories,
  severity_threshold, member_ids, channel_overrides, quiet_hours, digest_mode,
  created_by_user_id, updated_by_user_id, created_at, updated_at
`;

export class ConnectorSubscriptionRepository {
  constructor(private readonly db: Pool = pool) {}

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listByProject(
    projectId: string,
    query: ListProjectConnectorSubscriptionsQuery,
    client?: DbClient,
  ): Promise<{ subscriptions: ProjectConnectorSubscription[]; total: number }> {
    const db = client ?? this.db;
    const params: unknown[] = [projectId];
    const whereClauses = ["project_id = $1"];

    if (query.enabled !== undefined) {
      params.push(query.enabled);
      whereClauses.push(`enabled = $${params.length}`);
    }

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM project_connector_subscriptions
        WHERE ${whereClauses.join(" AND ")}`,
      params,
    );

    const sortColumn = query.sortBy === "updated_at" ? "updated_at" : "created_at";
    const sortOrder = query.sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;

    params.push(query.limit, offset);
    const result = await db.query(
      `SELECT ${SUBSCRIPTION_COLUMNS}
         FROM project_connector_subscriptions
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY ${sortColumn} ${sortOrder}
        LIMIT $${params.length - 1}
        OFFSET $${params.length}`,
      params,
    );

    return {
      subscriptions: result.rows.map((row) => this.mapSubscription(row)),
      total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
    };
  }

  async findById(
    subscriptionId: string,
    client?: DbClient,
  ): Promise<ProjectConnectorSubscription | null> {
    const db = client ?? this.db;
    const result = await db.query(
      `SELECT ${SUBSCRIPTION_COLUMNS}
         FROM project_connector_subscriptions
        WHERE id = $1
        LIMIT 1`,
      [subscriptionId],
    );
    return result.rows[0] ? this.mapSubscription(result.rows[0]) : null;
  }

  async findByProjectAndConnector(
    projectId: string,
    connectorId: string,
    client?: DbClient,
  ): Promise<ProjectConnectorSubscription | null> {
    const db = client ?? this.db;
    const result = await db.query(
      `SELECT ${SUBSCRIPTION_COLUMNS}
         FROM project_connector_subscriptions
        WHERE project_id = $1 AND connector_id = $2
        LIMIT 1`,
      [projectId, connectorId],
    );
    return result.rows[0] ? this.mapSubscription(result.rows[0]) : null;
  }

  async create(
    projectId: string,
    organizationId: string,
    createdByUserId: string,
    body: CreateProjectConnectorSubscriptionBody,
    client?: DbClient,
  ): Promise<ProjectConnectorSubscription> {
    const db = client ?? this.db;
    try {
      const result = await db.query(
        `INSERT INTO project_connector_subscriptions (
           project_id, organization_id, connector_id, enabled, alert_categories,
           severity_threshold, member_ids, channel_overrides, quiet_hours, digest_mode,
           created_by_user_id, updated_by_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${SUBSCRIPTION_COLUMNS}`,
        [
          projectId,
          organizationId,
          body.connectorId,
          body.enabled,
          body.alertCategories,
          body.severityThreshold,
          body.memberIds,
          body.channelOverrides,
          body.quietHours ?? null,
          body.digestMode ?? null,
          createdByUserId,
          createdByUserId,
        ],
      );
      return this.mapSubscription(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ProjectError(
          "CONNECTOR_SUBSCRIPTION_EXISTS",
          "A subscription for this connector already exists in this project",
          409,
        );
      }
      throw error;
    }
  }

  async update(
    subscriptionId: string,
    updatedByUserId: string,
    body: UpdateProjectConnectorSubscriptionBody,
    client?: DbClient,
  ): Promise<ProjectConnectorSubscription> {
    const db = client ?? this.db;
    const assignments: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.enabled !== undefined) {
      assignments.push(`enabled = $${i++}`);
      values.push(body.enabled);
    }
    if (body.alertCategories !== undefined) {
      assignments.push(`alert_categories = $${i++}`);
      values.push(body.alertCategories);
    }
    if (body.severityThreshold !== undefined) {
      assignments.push(`severity_threshold = $${i++}`);
      values.push(body.severityThreshold);
    }
    if (body.memberIds !== undefined) {
      assignments.push(`member_ids = $${i++}`);
      values.push(body.memberIds);
    }
    if (body.channelOverrides !== undefined) {
      assignments.push(`channel_overrides = $${i++}`);
      values.push(body.channelOverrides);
    }
    if (body.quietHours !== undefined) {
      assignments.push(`quiet_hours = $${i++}`);
      values.push(body.quietHours);
    }
    if (body.digestMode !== undefined) {
      assignments.push(`digest_mode = $${i++}`);
      values.push(body.digestMode);
    }

    if (assignments.length === 0) {
      const existing = await this.findById(subscriptionId, db);
      if (!existing) throw new ProjectError("CONNECTOR_SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
      return existing;
    }

    assignments.push("updated_by_user_id = $" + i++);
    values.push(updatedByUserId);
    assignments.push("updated_at = NOW()");
    values.push(subscriptionId);

    const result = await db.query(
      `UPDATE project_connector_subscriptions
          SET ${assignments.join(", ")}
        WHERE id = $${i++}
        RETURNING ${SUBSCRIPTION_COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) {
      throw new ProjectError("CONNECTOR_SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
    }
    return this.mapSubscription(result.rows[0]!);
  }

  async delete(subscriptionId: string, client?: DbClient): Promise<void> {
    const db = client ?? this.db;
    const result = await db.query(
      `DELETE FROM project_connector_subscriptions WHERE id = $1`,
      [subscriptionId],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("CONNECTOR_SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
    }
  }

  /**
   * Deterministic alert routing lookup: API Key -> Environment -> Project ->
   * Project Connector Subscriptions -> Project Members.
   *
   * Resolves a single API key to its routing context including the active
   * connector subscriptions and project members that should receive alerts.
   */
  async resolveAlertRoutingTarget(
    apiKeyId: string,
    client?: DbClient,
  ): Promise<AlertRoutingTarget | null> {
    const db = client ?? this.db;

    const keyResult = await db.query<{
      id: string;
      project_id: string;
      organization_id: string;
      environment_id: string | null;
    }>(
      `SELECT id, project_id, organization_id, environment_id
         FROM project_api_keys
        WHERE id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        LIMIT 1`,
      [apiKeyId],
    );
    const keyRow = keyResult.rows[0];
    if (!keyRow) return null;

    const projectResult = await db.query<{
      id: string;
      organization_id: string;
      status: string;
    }>(
      `SELECT id, organization_id, status
         FROM projects
        WHERE id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        LIMIT 1`,
      [keyRow.project_id],
    );
    if (projectResult.rows.length === 0) return null;

    const subscriptionResult = await db.query(
      `SELECT ${SUBSCRIPTION_COLUMNS}
         FROM project_connector_subscriptions
        WHERE project_id = $1
          AND enabled = TRUE`,
      [keyRow.project_id],
    );

    const memberResult = await db.query<{
      user_id: string;
      role: string;
      email: string | null;
    }>(
      `SELECT m.user_id, m.role, u.email
         FROM project_members m
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.project_id = $1
          AND m.status = 'active'`,
      [keyRow.project_id],
    );

    return {
      projectId: keyRow.project_id,
      organizationId: keyRow.organization_id,
      environmentId: keyRow.environment_id,
      apiKeyId: keyRow.id,
      subscriptions: subscriptionResult.rows.map((row) => ({
        subscriptionId: row.id,
        connectorId: row.connector_id,
        enabled: row.enabled,
        alertCategories: row.alert_categories as AlertCategory[],
        severityThreshold: row.severity_threshold,
        memberIds: row.member_ids,
        channelOverrides: row.channel_overrides,
      })),
      members: memberResult.rows.map((row) => ({
        userId: row.user_id,
        role: row.role,
        email: row.email,
      })),
    };
  }

  /**
   * Resolve alert routing targets by project id.
   *
   * Fallback for alert events that do not carry an explicit api_key_id but are
   * already scoped to a project. Still enforces the same Project -> Subscriptions
   * -> Members lookup.
   */
  async resolveAlertRoutingTargetByProjectId(
    projectId: string,
    client?: DbClient,
  ): Promise<AlertRoutingTarget | null> {
    const db = client ?? this.db;

    const projectResult = await db.query<{
      id: string;
      organization_id: string;
      status: string;
    }>(
      `SELECT id, organization_id, status
         FROM projects
        WHERE id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        LIMIT 1`,
      [projectId],
    );
    if (projectResult.rows.length === 0) return null;
    const projectRow = projectResult.rows[0]!;

    const subscriptionResult = await db.query(
      `SELECT ${SUBSCRIPTION_COLUMNS}
         FROM project_connector_subscriptions
        WHERE project_id = $1
          AND enabled = TRUE`,
      [projectId],
    );

    const memberResult = await db.query<{
      user_id: string;
      role: string;
      email: string | null;
    }>(
      `SELECT m.user_id, m.role, u.email
         FROM project_members m
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.project_id = $1
          AND m.status = 'active'`,
      [projectId],
    );

    return {
      projectId,
      organizationId: projectRow.organization_id,
      environmentId: null,
      apiKeyId: "",
      subscriptions: subscriptionResult.rows.map((row) => ({
        subscriptionId: row.id,
        connectorId: row.connector_id,
        enabled: row.enabled,
        alertCategories: row.alert_categories as AlertCategory[],
        severityThreshold: row.severity_threshold,
        memberIds: row.member_ids,
        channelOverrides: row.channel_overrides,
      })),
      members: memberResult.rows.map((row) => ({
        userId: row.user_id,
        role: row.role,
        email: row.email,
      })),
    };
  }

  private mapSubscription(row: any): ProjectConnectorSubscription {
    return {
      id: row.id,
      projectId: row.project_id,
      organizationId: row.organization_id,
      connectorId: row.connector_id,
      enabled: row.enabled,
      alertCategories: row.alert_categories ?? [],
      severityThreshold: row.severity_threshold,
      memberIds: row.member_ids ?? [],
      channelOverrides: row.channel_overrides ?? {},
      quietHours: row.quiet_hours,
      digestMode: row.digest_mode,
      createdByUserId: row.created_by_user_id,
      updatedByUserId: row.updated_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

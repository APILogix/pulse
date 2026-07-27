import { pool } from "../../../../config/database.js";
import { ProjectError } from "../../shared/utils.js";
const SUBSCRIPTION_COLUMNS = `
  id, project_id, organization_id, connector_id, enabled, alert_categories,
  severity_threshold, member_ids, channel_overrides, quiet_hours, digest_mode,
  created_by_user_id, updated_by_user_id, created_at, updated_at, deleted_at
`;
const RESOLVER_SUBSCRIPTION_COLUMNS = `
  subscription.id, subscription.project_id, subscription.organization_id,
  subscription.connector_id, subscription.enabled, subscription.alert_categories,
  subscription.severity_threshold, subscription.member_ids, subscription.channel_overrides,
  subscription.quiet_hours, subscription.digest_mode, subscription.created_by_user_id,
  subscription.updated_by_user_id, subscription.created_at, subscription.updated_at,
  subscription.deleted_at
`;
export class ConnectorSubscriptionRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async withTransaction(callback) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const result = await callback(client);
            await client.query("COMMIT");
            return result;
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    async listByProject(organizationId, projectId, query, client) {
        const db = client ?? this.db;
        const params = [organizationId, projectId];
        const whereClauses = ["organization_id = $1", "project_id = $2", "deleted_at IS NULL"];
        if (query.enabled !== undefined) {
            params.push(query.enabled);
            whereClauses.push(`enabled = $${params.length}`);
        }
        const countResult = await db.query(`SELECT COUNT(*)::text AS count
         FROM project_connector_subscriptions
        WHERE ${whereClauses.join(" AND ")}`, params);
        const sortColumn = query.sortBy === "updated_at" ? "updated_at" : "created_at";
        const sortOrder = query.sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        params.push(query.limit, offset);
        const result = await db.query(`SELECT ${SUBSCRIPTION_COLUMNS}
         FROM project_connector_subscriptions
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY ${sortColumn} ${sortOrder}
        LIMIT $${params.length - 1}
        OFFSET $${params.length}`, params);
        return {
            subscriptions: result.rows.map((row) => this.mapSubscription(row)),
            total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
        };
    }
    async findById(organizationId, projectId, subscriptionId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${SUBSCRIPTION_COLUMNS}
         FROM project_connector_subscriptions
        WHERE organization_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL
        LIMIT 1`, [organizationId, projectId, subscriptionId]);
        return result.rows[0] ? this.mapSubscription(result.rows[0]) : null;
    }
    async findByProjectAndConnector(organizationId, projectId, connectorId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${SUBSCRIPTION_COLUMNS}
         FROM project_connector_subscriptions
        WHERE organization_id = $1 AND project_id = $2 AND connector_id = $3 AND deleted_at IS NULL
        LIMIT 1`, [organizationId, projectId, connectorId]);
        return result.rows[0] ? this.mapSubscription(result.rows[0]) : null;
    }
    async create(projectId, organizationId, createdByUserId, body, client) {
        const db = client ?? this.db;
        try {
            const result = await db.query(`INSERT INTO project_connector_subscriptions (
           project_id, organization_id, connector_id, enabled, alert_categories,
           severity_threshold, member_ids, channel_overrides, quiet_hours, digest_mode,
           created_by_user_id, updated_by_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${SUBSCRIPTION_COLUMNS}`, [
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
            ]);
            return this.mapSubscription(result.rows[0]);
        }
        catch (error) {
            if (error.code === "23505") {
                throw new ProjectError("CONNECTOR_SUBSCRIPTION_EXISTS", "A subscription for this connector already exists in this project", 409);
            }
            throw error;
        }
    }
    async update(organizationId, projectId, subscriptionId, updatedByUserId, body, client) {
        const db = client ?? this.db;
        const assignments = [];
        const values = [];
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
            const existing = await this.findById(organizationId, projectId, subscriptionId, db);
            if (!existing)
                throw new ProjectError("CONNECTOR_SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
            return existing;
        }
        assignments.push("updated_by_user_id = $" + i++);
        values.push(updatedByUserId);
        assignments.push("updated_at = NOW()", "version = version + 1");
        values.push(subscriptionId, organizationId, projectId);
        const result = await db.query(`UPDATE project_connector_subscriptions
          SET ${assignments.join(", ")}
        WHERE id = $${i++} AND organization_id = $${i++} AND project_id = $${i++}
          AND deleted_at IS NULL
        RETURNING ${SUBSCRIPTION_COLUMNS}`, values);
        if (result.rowCount === 0) {
            throw new ProjectError("CONNECTOR_SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
        }
        return this.mapSubscription(result.rows[0]);
    }
    async delete(organizationId, projectId, subscriptionId, deletedByUserId, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE project_connector_subscriptions
          SET deleted_at = NOW(), updated_at = NOW(), updated_by_user_id = $4,
              version = version + 1
        WHERE organization_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`, [organizationId, projectId, subscriptionId, deletedByUserId]);
        if (result.rowCount === 0) {
            throw new ProjectError("CONNECTOR_SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
        }
    }
    /** Resolve an active API key to project-scoped, tenant-safe delivery eligibility. */
    async resolveAlertRoutingTarget(apiKeyId, client) {
        const db = client ?? this.db;
        const keyResult = await db.query(`SELECT key.id, key.project_id, key.organization_id,
              key.environment::text AS environment_id
         FROM project_api_keys key
         JOIN projects project
           ON project.id = key.project_id
          AND project.org_id = key.organization_id
          AND project.status = 'active'
          AND project.deleted_at IS NULL
         JOIN organizations organization
           ON organization.id = key.organization_id
          AND organization.deleted_at IS NULL
        WHERE key.id = $1 AND key.status = 'active' AND key.deleted_at IS NULL
        LIMIT 1`, [apiKeyId]);
        const key = keyResult.rows[0];
        if (!key)
            return null;
        return this.loadRoutingTarget(key.project_id, key.organization_id, key.environment_id, key.id, db);
    }
    /** Resolve an active project to tenant-safe delivery eligibility. */
    async resolveAlertRoutingTargetByProjectId(projectId, client) {
        const db = client ?? this.db;
        const projectResult = await db.query(`SELECT project.id, project.org_id AS organization_id
         FROM projects project
         JOIN organizations organization
           ON organization.id = project.org_id
          AND organization.deleted_at IS NULL
        WHERE project.id = $1 AND project.status = 'active' AND project.deleted_at IS NULL
        LIMIT 1`, [projectId]);
        const project = projectResult.rows[0];
        if (!project)
            return null;
        return this.loadRoutingTarget(project.id, project.organization_id, null, null, db);
    }
    async loadRoutingTarget(projectId, organizationId, environmentId, apiKeyId, db) {
        const subscriptionResult = await db.query(`SELECT ${RESOLVER_SUBSCRIPTION_COLUMNS}
         FROM project_connector_subscriptions subscription
         JOIN connector_configs connector
           ON connector.id = subscription.connector_id
          AND connector.organization_id = subscription.organization_id
          AND connector.status = 'active'
          AND connector.deleted_at IS NULL
        WHERE subscription.project_id = $1
          AND subscription.organization_id = $2
          AND subscription.enabled = TRUE
          AND subscription.deleted_at IS NULL`, [projectId, organizationId]);
        const memberResult = await db.query(`SELECT member.user_id, member.role, users.email
         FROM project_members member
         LEFT JOIN users ON users.id = member.user_id
        WHERE member.project_id = $1
          AND member.organization_id = $2
          AND member.status = 'active'`, [projectId, organizationId]);
        return {
            projectId,
            organizationId,
            environmentId,
            apiKeyId,
            subscriptions: subscriptionResult.rows.map((row) => ({
                subscriptionId: row.id,
                connectorId: row.connector_id,
                enabled: row.enabled,
                alertCategories: row.alert_categories,
                severityThreshold: row.severity_threshold,
                memberIds: row.member_ids ?? [],
                channelOverrides: row.channel_overrides ?? {},
            })),
            members: memberResult.rows.map((row) => ({
                userId: row.user_id,
                role: row.role,
                email: row.email,
            })),
        };
    }
    mapSubscription(row) {
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
            deletedAt: row.deleted_at ?? null,
        };
    }
}
//# sourceMappingURL=connector-subscription.repository.js.map
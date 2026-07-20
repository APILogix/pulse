import { pool } from "../../../config/database.js";
import { ProjectError } from "../shared/utils.js";
const ENV_COLUMNS = `
  id, project_id, organization_id, name, slug, description, is_default, is_active, color, icon,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour, burst_limit,
  allowed_event_types, max_event_size_bytes, max_batch_size,
  require_https, ip_allowlist, ip_blocklist, alert_email, alert_webhook_url,
  created_by_user_id, created_by_api_key_id, created_at, updated_at, deleted_at
`;
export class EnvironmentRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async listEnvironments(projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1 AND deleted_at IS NULL
        ORDER BY name ASC`, [projectId]);
        return result.rows.map((row) => this.mapEnv(row));
    }
    async findEnvironment(projectId, environmentId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL
        LIMIT 1`, [projectId, environmentId]);
        return result.rows[0] ? this.mapEnv(result.rows[0]) : null;
    }
    async createEnvironment(input, client) {
        const db = client ?? this.db;
        try {
            const result = await db.query(`INSERT INTO project_environments (
           project_id, organization_id, name, slug, description, is_default, is_active, color, icon,
           rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour, burst_limit,
           allowed_event_types, max_event_size_bytes, max_batch_size,
           require_https, ip_allowlist, ip_blocklist, alert_email, alert_webhook_url,
           created_by_user_id, created_by_api_key_id
         ) VALUES (
           $1, $2, $3, $4, $5, COALESCE($6, FALSE), COALESCE($7, TRUE), $8, $9,
           $10, $11, $12, $13,
           COALESCE($14, ARRAY[]::text[]), $15, $16,
           COALESCE($17, TRUE), $18::inet[], $19::inet[], $20, $21,
           $22, $23
         )
         RETURNING ${ENV_COLUMNS}`, [
                input.projectId,
                input.orgId,
                input.name,
                input.slug,
                input.description ?? null,
                input.isDefault ?? null,
                input.isActive ?? null,
                input.color ?? null,
                input.icon ?? null,
                input.rateLimitPerSecond ?? null,
                input.rateLimitPerMinute ?? null,
                input.rateLimitPerHour ?? null,
                input.burstLimit ?? null,
                input.allowedEventTypes ?? null,
                input.maxEventSizeBytes ?? null,
                input.maxBatchSize ?? null,
                input.requireHttps ?? null,
                input.ipAllowlist ?? null,
                input.ipBlocklist ?? null,
                input.alertEmail ?? null,
                input.alertWebhookUrl ?? null,
                input.createdByUserId ?? null,
                input.createdByApiKeyId ?? null,
            ]);
            return this.mapEnv(result.rows[0]);
        }
        catch (error) {
            if (error.code === "23505") {
                throw new ProjectError("ENVIRONMENT_EXISTS", "This environment already exists for the project", 409);
            }
            throw error;
        }
    }
    async updateEnvironment(projectId, environmentId, input, client) {
        const db = client ?? this.db;
        const assignments = [];
        const values = [];
        let i = 1;
        const set = (col, val) => {
            assignments.push(`${col} = $${i++}`);
            values.push(val);
        };
        if (input.name !== undefined)
            set("name", input.name);
        if (input.slug !== undefined)
            set("slug", input.slug);
        if (input.description !== undefined)
            set("description", input.description);
        if (input.color !== undefined)
            set("color", input.color);
        if (input.icon !== undefined)
            set("icon", input.icon);
        if (input.isDefault !== undefined)
            set("is_default", input.isDefault);
        if (input.isActive !== undefined)
            set("is_active", input.isActive);
        if (input.rateLimitPerSecond !== undefined)
            set("rate_limit_per_second", input.rateLimitPerSecond);
        if (input.rateLimitPerMinute !== undefined)
            set("rate_limit_per_minute", input.rateLimitPerMinute);
        if (input.rateLimitPerHour !== undefined)
            set("rate_limit_per_hour", input.rateLimitPerHour);
        if (input.burstLimit !== undefined)
            set("burst_limit", input.burstLimit);
        if (input.allowedEventTypes !== undefined)
            set("allowed_event_types", input.allowedEventTypes);
        if (input.maxEventSizeBytes !== undefined)
            set("max_event_size_bytes", input.maxEventSizeBytes);
        if (input.maxBatchSize !== undefined)
            set("max_batch_size", input.maxBatchSize);
        if (input.requireHttps !== undefined)
            set("require_https", input.requireHttps);
        if (input.ipAllowlist !== undefined)
            set("ip_allowlist", input.ipAllowlist);
        if (input.ipBlocklist !== undefined)
            set("ip_blocklist", input.ipBlocklist);
        if (input.alertEmail !== undefined)
            set("alert_email", input.alertEmail);
        if (input.alertWebhookUrl !== undefined)
            set("alert_webhook_url", input.alertWebhookUrl);
        if (assignments.length === 0) {
            const env = await this.findEnvironment(projectId, environmentId, client);
            if (!env) {
                throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
            }
            return env;
        }
        values.push(projectId, environmentId);
        const result = await db.query(`UPDATE project_environments
          SET ${assignments.join(", ")}
        WHERE project_id = $${values.length - 1} AND id = $${values.length} AND deleted_at IS NULL
        RETURNING ${ENV_COLUMNS}`, values);
        if (result.rowCount === 0) {
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
        }
        return this.mapEnv(result.rows[0]);
    }
    async deleteEnvironment(projectId, environmentId, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE project_environments SET deleted_at = NOW() WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL`, [projectId, environmentId]);
        if (result.rowCount === 0) {
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
        }
    }
    mapEnv(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            orgId: row.organization_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            color: row.color,
            icon: row.icon,
            isDefault: row.is_default,
            isActive: row.is_active,
            rateLimitPerSecond: row.rate_limit_per_second,
            rateLimitPerMinute: row.rate_limit_per_minute,
            rateLimitPerHour: row.rate_limit_per_hour,
            burstLimit: row.burst_limit,
            allowedEventTypes: row.allowed_event_types ?? [],
            maxEventSizeBytes: row.max_event_size_bytes,
            maxBatchSize: row.max_batch_size,
            requireHttps: row.require_https,
            ipAllowlist: row.ip_allowlist,
            ipBlocklist: row.ip_blocklist,
            alertEmail: row.alert_email,
            alertWebhookUrl: row.alert_webhook_url,
            createdByUserId: row.created_by_user_id,
            createdByApiKeyId: row.created_by_api_key_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            deletedAt: row.deleted_at,
        };
    }
}
//# sourceMappingURL=environment.repository.js.map
import { pool } from "../../../config/database.js";
import { ProjectError } from "../shared/utils.js";
// Column list selected for every project read. Centralized so the projection
// stays consistent across find/list/update.
const PROJECT_COLUMNS = `
  id, org_id, name, slug, description, status, default_environment AS environment,
  archived_at, deleted_at, created_at, updated_at
`;
const API_KEY_COLUMNS = `
  id, project_id, org_id, key_hash, key_prefix, key_type, environment,
  name, description, is_active, status, created_by,
  rotated_from_key_id, rotated_at, rotated_by, rotation_reason, grace_period_ends_at,
  revoked_at, revoked_by, revoked_reason, expires_at,
  auto_rotate_enabled, auto_rotate_days,
  last_used_at, last_used_ip, usage_count, error_count,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour,
  permissions, allowed_endpoints, blocked_endpoints, metadata,
  created_at, updated_at
`;
const ENV_COLUMNS = `
  id, project_id, org_id, environment, is_active,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour, burst_limit,
  allowed_event_types, max_event_size_bytes, max_batch_size,
  require_https, ip_allowlist, ip_blocklist, alert_email, alert_webhook_url,
  created_by, created_at, updated_at
`;
const DEFAULT_PROJECT_ENVIRONMENTS = ["development", "staging", "production"];
export class ProjectRepository {
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
    // ── Membership ────────────────────────────────────────────────────────────
    // ── Projects ────────────────────────────────────────────────────────────────
    async listProjects(orgId, query, client) {
        const db = client ?? this.db;
        const params = [orgId];
        const whereClauses = ["p.org_id = $1"];
        if (!query.includeDeleted) {
            whereClauses.push("p.deleted_at IS NULL");
        }
        if (query.status) {
            params.push(query.status);
            whereClauses.push(`p.status = $${params.length}`);
        }
        if (query.environment) {
            params.push(query.environment);
            whereClauses.push(`p.default_environment = ${params.length}`);
        }
        if (query.search) {
            params.push(`%${query.search}%`);
            whereClauses.push(`(p.name ILIKE $${params.length} OR p.slug ILIKE $${params.length})`);
        }
        const whereClause = `WHERE ${whereClauses.join(" AND ")}`;
        const countResult = await db.query(`SELECT COUNT(*)::text AS count FROM projects p ${whereClause}`, params);
        const sortColumnMap = {
            created_at: "p.created_at",
            updated_at: "p.updated_at",
            name: "p.name",
        };
        const sortColumn = sortColumnMap[query.sortBy];
        const sortOrder = query.sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        params.push(query.limit, offset);
        const result = await db.query(`SELECT
         ${PROJECT_COLUMNS.split(",").map((c) => `p.${c.trim()}`).join(", ")},
         COUNT(k.id)::int AS api_keys_count,
         COUNT(k.id) FILTER (WHERE k.is_active = TRUE)::int AS active_api_keys_count
       FROM projects p
       LEFT JOIN project_api_keys k ON k.project_id = p.id
       ${whereClause}
       GROUP BY p.id
       ORDER BY ${sortColumn} ${sortOrder}
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`, params);
        return {
            projects: result.rows.map((row) => this.mapProjectWithCounts(row)),
            total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
        };
    }
    async createProject(input, client) {
        const db = client ?? this.db;
        try {
            const result = await db.query(`INSERT INTO projects (
           org_id, name, slug, description, default_environment
         ) VALUES (
           $1,$2,$3,$4,$5
         )
         RETURNING ${PROJECT_COLUMNS}`, [
                input.orgId,
                input.name,
                input.slug,
                input.description,
                input.environment,
            ]);
            return this.mapProject(result.rows[0]);
        }
        catch (error) {
            if (error.code === "23505") {
                throw new ProjectError("PROJECT_SLUG_EXISTS", "A project with the same slug already exists in this organization", 409);
            }
            throw error;
        }
    }
    async findProjectBySlug(orgId, slug, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${PROJECT_COLUMNS} FROM projects
        WHERE org_id = $1 AND slug = $2 AND deleted_at IS NULL
        LIMIT 1`, [orgId, slug]);
        return result.rows[0] ? this.mapProject(result.rows[0]) : null;
    }
    async findProjectById(orgId, projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${PROJECT_COLUMNS} FROM projects
        WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL
        LIMIT 1`, [orgId, projectId]);
        return result.rows[0] ? this.mapProject(result.rows[0]) : null;
    }
    async findProjectByIdIncludingDeleted(orgId, projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${PROJECT_COLUMNS} FROM projects
        WHERE org_id = $1 AND id = $2
        LIMIT 1`, [orgId, projectId]);
        return result.rows[0] ? this.mapProject(result.rows[0]) : null;
    }
    async updateProject(orgId, projectId, input, client) {
        const db = client ?? this.db;
        const { assignments, values } = this.buildProjectAssignments(input);
        if (assignments.length === 0) {
            const project = await this.findProjectById(orgId, projectId, client);
            if (!project) {
                throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
            }
            return project;
        }
        values.push(orgId, projectId);
        const result = await db.query(`UPDATE projects
          SET ${assignments.join(", ")}
        WHERE org_id = $${values.length - 1}
          AND id = $${values.length}
          AND deleted_at IS NULL
        RETURNING ${PROJECT_COLUMNS}`, values);
        if (result.rowCount === 0) {
            throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
        }
        return this.mapProject(result.rows[0]);
    }
    /** Soft-delete: stamp deleted_at + deleted_by; row is retained for audit. */
    async softDeleteProject(orgId, projectId, deletedBy, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE projects
          SET deleted_at = NOW(), deleted_by = $3, status = 'archived'
        WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`, [orgId, projectId, deletedBy]);
        if (result.rowCount === 0) {
            throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
        }
    }
    async restoreProject(orgId, projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE projects
          SET deleted_at = NULL,
              deleted_by = NULL,
              archived_at = NULL,
              status = 'active'
        WHERE org_id = $1
          AND id = $2
          AND deleted_at IS NOT NULL
        RETURNING ${PROJECT_COLUMNS}`, [orgId, projectId]);
        if (result.rowCount === 0) {
            throw new ProjectError("PROJECT_NOT_FOUND", "Deleted project not found", 404);
        }
        return this.mapProject(result.rows[0]);
    }
    // ── Mapping helpers ─────────────────────────────────────────────────────────
    buildProjectAssignments(input) {
        const assignments = [];
        const values = [];
        let i = 1;
        const set = (col, val) => {
            assignments.push(`${col} = $${i++}`);
            values.push(val);
        };
        if (input.name !== undefined)
            set("name", input.name);
        if (input.description !== undefined)
            set("description", input.description);
        if (input.status !== undefined)
            set("status", input.status);
        if (input.environment !== undefined)
            set("default_environment", input.environment);
        if (input.archivedAt !== undefined)
            set("archived_at", input.archivedAt);
        return { assignments, values };
    }
    /** Build a ProjectRow from the p_*-prefixed columns of the candidate join. */
    prefixedProjectRow(row) {
        return {
            id: row.p_id,
            org_id: row.p_org_id,
            name: row.p_name,
            slug: row.p_slug,
            description: row.p_description,
            status: row.p_status,
            environment: row.p_environment,
            archived_at: row.p_archived_at,
            deleted_at: row.p_deleted_at,
            created_at: row.p_created_at,
            updated_at: row.p_updated_at,
        };
    }
    mapProject(row) {
        return {
            id: row.id,
            orgId: row.org_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            status: row.status,
            environment: row.environment,
            productionApiPrefix: null,
            developmentApiPrefix: null,
            stagingApiPrefix: null,
            rateLimitPerSecond: 0,
            rateLimitPerMinute: 0,
            rateLimitPerHour: 0,
            burstLimit: 0,
            allowedEventTypes: [],
            maxEventSizeBytes: 0,
            maxBatchSize: 0,
            allowedOrigins: [],
            requireHttps: false,
            ipAllowlist: null,
            ipBlocklist: null,
            geoRestrictionEnabled: false,
            allowedCountries: null,
            alertEmail: null,
            alertWebhookUrl: null,
            alertOnErrorRateThreshold: 0,
            alertOnLatencyThresholdMs: 0,
            metadata: {},
            settings: {},
            archivedAt: row.archived_at,
            deletedAt: row.deleted_at,
            deletedBy: null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    mapProjectWithCounts(row) {
        return {
            ...this.mapProject(row),
            apiKeysCount: Number(row.api_keys_count ?? 0),
            activeApiKeysCount: Number(row.active_api_keys_count ?? 0),
        };
    }
}
//# sourceMappingURL=project.repository.js.map
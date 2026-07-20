import { pool } from "../../../config/database.js";
import { ProjectError } from "../shared/utils.js";
const PROJECT_COLUMNS = `
  id, org_id, name, slug, description, status, visibility, timezone, tags, icon, color, metadata,
  archived_at, deleted_at, deleted_by, created_at, updated_at, version
`;
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
       LEFT JOIN project_api_keys k ON k.project_id = p.id AND k.deleted_at IS NULL
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
           org_id, name, slug, description, visibility, timezone, tags, icon, color, metadata, created_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
         )
         RETURNING ${PROJECT_COLUMNS}`, [
                input.orgId,
                input.name,
                input.slug,
                input.description,
                input.visibility ?? "private",
                input.timezone ?? "UTC",
                input.tags ?? [],
                input.icon ?? null,
                input.color ?? null,
                input.metadata ?? {},
                input.createdBy ?? null,
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
    async findOrganizationMembership(orgId, userId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT org_id, user_id, role, (status = 'active') AS is_active
         FROM organization_members
        WHERE org_id = $1 AND user_id = $2
        LIMIT 1`, [orgId, userId]);
        const row = result.rows[0];
        if (!row)
            return null;
        return {
            orgId: row.org_id,
            userId: row.user_id,
            role: row.role,
            isActive: row.is_active,
        };
    }
    async getProjectModuleUsageCounts(orgId, client) {
        const db = client ?? this.db;
        const [projects, environments, apiKeys] = await Promise.all([
            db.query(`SELECT COUNT(*)::text FROM projects WHERE org_id = $1 AND deleted_at IS NULL`, [orgId]),
            db.query(`SELECT COUNT(*)::text FROM project_environments WHERE organization_id = $1 AND deleted_at IS NULL`, [orgId]),
            db.query(`SELECT COUNT(*)::text FROM project_api_keys WHERE organization_id = $1 AND deleted_at IS NULL`, [orgId]),
        ]);
        return {
            projects: Number(projects.rows[0]?.count ?? 0),
            environments: Number(environments.rows[0]?.count ?? 0),
            apiKeys: Number(apiKeys.rows[0]?.count ?? 0),
        };
    }
    async getProjectStats(projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT
         COALESCE(SUM(total_events),0)::text AS total_requests,
         COUNT(DISTINCT k.id)::text AS api_keys_count,
         COUNT(DISTINCT k.id) FILTER (WHERE k.is_active = TRUE)::text AS active_keys_count,
         COUNT(DISTINCT e.id)::text AS environment_count
       FROM projects p
       LEFT JOIN project_api_keys k ON k.project_id = p.id AND k.deleted_at IS NULL
       LEFT JOIN project_environments e ON e.project_id = p.id AND e.deleted_at IS NULL
       LEFT JOIN project_usage_daily u ON u.project_id = p.id
       WHERE p.id = $1 AND p.deleted_at IS NULL
       GROUP BY p.id`, [projectId]);
        const row = result.rows[0];
        return {
            totalRequests: Number(row?.total_requests ?? 0),
            apiKeysCount: Number(row?.api_keys_count ?? 0),
            activeKeysCount: Number(row?.active_keys_count ?? 0),
            environmentCount: Number(row?.environment_count ?? 0),
        };
    }
    async getProjectUsageCounters(projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT counter_type, value, period_start
         FROM project_usage
        WHERE project_id = $1
        ORDER BY period_start DESC
        LIMIT 100`, [projectId]);
        return result.rows.map((r) => ({
            counterType: r.counter_type,
            value: Number(r.value),
            periodStart: r.period_start,
        }));
    }
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
        if (input.visibility !== undefined)
            set("visibility", input.visibility);
        if (input.timezone !== undefined)
            set("timezone", input.timezone);
        if (input.tags !== undefined)
            set("tags", input.tags);
        if (input.icon !== undefined)
            set("icon", input.icon);
        if (input.color !== undefined)
            set("color", input.color);
        if (input.metadata !== undefined)
            set("metadata", input.metadata);
        if (input.archivedAt !== undefined)
            set("archived_at", input.archivedAt);
        return { assignments, values };
    }
    mapProject(row) {
        return {
            id: row.id,
            orgId: row.org_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            status: row.status,
            visibility: row.visibility,
            timezone: row.timezone,
            tags: row.tags ?? [],
            icon: row.icon,
            color: row.color,
            metadata: row.metadata ?? {},
            archivedAt: row.archived_at,
            deletedAt: row.deleted_at,
            deletedBy: row.deleted_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            version: row.version,
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
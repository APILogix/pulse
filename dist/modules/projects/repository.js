import { pool } from "../../config/database.js";
import { ProjectError } from "./shared/utils.js";
import { ProjectRepository } from "./core/project.repository.js";
import { MemberRepository } from "./members/member.repository.js";
import { ProjectUsageRepository } from "./usage/project-usage.repository.js";
import { getProjectRole } from "../../shared/middleware/tenant.js";
export class ProjectsRepository {
    db;
    core;
    members;
    usage;
    constructor(db = pool) {
        this.db = db;
        this.core = new ProjectRepository(db);
        this.members = new MemberRepository(db);
        this.usage = new ProjectUsageRepository(db);
    }
    async withTransaction(callback) {
        return this.core.withTransaction(callback);
    }
    // ── Membership ────────────────────────────────────────────────────────────
    async findOrganizationMembership(orgId, userId, client) {
        return this.members.findOrganizationMembership(orgId, userId, client);
    }
    async getProjectMemberRole(orgId, projectId, userId, client) {
        if (!client) {
            const cached = await getProjectRole(projectId, userId);
            if (cached !== null)
                return cached;
        }
        const db = client ?? this.db;
        const result = await db.query(`SELECT pm.role
         FROM project_members pm
         JOIN projects p
           ON p.id = pm.project_id
          AND p.org_id = pm.organization_id
        WHERE pm.organization_id = $1
          AND pm.project_id = $2
          AND pm.user_id = $3
          AND pm.status = 'active'
          AND p.org_id = $1
          AND p.deleted_at IS NULL
        LIMIT 1`, [orgId, projectId, userId]);
        return result.rows[0]?.role ?? null;
    }
    async addProjectMember(projectId, organizationId, userId, role, addedByUserId, client) {
        return this.members.addProjectMember(projectId, organizationId, userId, role, addedByUserId, client);
    }
    async ensureProjectOwner(projectId, organizationId, userId, client) {
        return this.members.ensureProjectOwner(projectId, organizationId, userId, client);
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    async listProjects(orgId, query, client) {
        return this.core.listProjects(orgId, query, client);
    }
    async createProject(input, client) {
        return this.core.createProject(input, client);
    }
    async provisionUsageCounter(project, client) {
        return this.core.provisionUsageCounter(project, client);
    }
    async findProjectBySlug(orgId, slug, client) {
        return this.core.findProjectBySlug(orgId, slug, client);
    }
    async findProjectById(orgId, projectId, client) {
        return this.core.findProjectById(orgId, projectId, client);
    }
    async findProjectByPublicId(orgId, publicId, client) {
        return this.core.findProjectByPublicId(orgId, publicId, client);
    }
    async findProjectByIdIncludingDeleted(orgId, projectId, client) {
        return this.core.findProjectByIdIncludingDeleted(orgId, projectId, client);
    }
    async updateProject(orgId, projectId, input, client) {
        return this.core.updateProject(orgId, projectId, input, client);
    }
    /** Soft-delete: stamp deleted_at + deleted_by; row is retained for audit. */
    async softDeleteProject(orgId, projectId, deletedBy, client) {
        return this.core.softDeleteProject(orgId, projectId, deletedBy, client);
    }
    async restoreProject(orgId, projectId, client) {
        return this.core.restoreProject(orgId, projectId, client);
    }
    async getProjectStats(projectId, client) {
        return this.usage.getProjectStats(projectId, client);
    }
    async getProjectUsageCounters(projectId, client) {
        return this.usage.getProjectUsageCounters(projectId, client);
    }
    async getProjectModuleUsageCounts(orgId, client) {
        return this.usage.getProjectModuleUsageCounts(orgId, client);
    }
}
export * from "./core/project.repository.js";
export * from "./members/member.repository.js";
export * from "./usage/project-usage.repository.js";
export * from "./settings/project-settings.repository.js";
//# sourceMappingURL=repository.js.map
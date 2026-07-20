import { pool } from "../../config/database.js";
import { ProjectError } from "./shared/utils.js";
import { ProjectRepository } from "./core/project.repository.js";
import { MemberRepository } from "./members/member.repository.js";
import { ProjectUsageRepository } from "./usage/project-usage.repository.js";
import { ProjectSettingsRepository } from "./settings/project-settings.repository.js";
export class ProjectsRepository {
    db;
    core;
    members;
    usage;
    settings;
    constructor(db = pool) {
        this.db = db;
        this.core = new ProjectRepository(db);
        this.members = new MemberRepository(db);
        this.usage = new ProjectUsageRepository(db);
        this.settings = new ProjectSettingsRepository(db);
    }
    async withTransaction(callback) {
        return this.core.withTransaction(callback);
    }
    // ── Membership ────────────────────────────────────────────────────────────
    async findOrganizationMembership(orgId, userId, client) {
        return this.members.findOrganizationMembership(orgId, userId, client);
    }
    async getProjectMemberRole(orgId, projectId, userId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT role
         FROM project_members
        WHERE project_id = $1
          AND user_id = $2
          AND (status IS NULL OR status = 'active')
        LIMIT 1`, [projectId, userId]);
        return result.rows[0]?.role ?? null;
    }
    async addProjectMember(projectId, organizationId, userId, role, addedByUserId, client) {
        return this.members.addProjectMember(projectId, organizationId, userId, role, addedByUserId, client);
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    async listProjects(orgId, query, client) {
        return this.core.listProjects(orgId, query, client);
    }
    async createProject(input, client) {
        return this.core.createProject(input, client);
    }
    async findProjectBySlug(orgId, slug, client) {
        return this.core.findProjectBySlug(orgId, slug, client);
    }
    async findProjectById(orgId, projectId, client) {
        return this.core.findProjectById(orgId, projectId, client);
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
    async findSdkConfigPlanKey(orgId, client) {
        return this.settings.findSdkConfigPlanKey(orgId, client);
    }
    async createDefaultSdkConfigs(project, createdBy, planKey, client) {
        return this.settings.createDefaultSdkConfigs(project, createdBy, planKey, client);
    }
}
export * from "./core/project.repository.js";
export * from "./members/member.repository.js";
export * from "./usage/project-usage.repository.js";
export * from "./settings/project-settings.repository.js";
//# sourceMappingURL=repository.js.map
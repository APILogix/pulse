import { apiKeyCache } from "../../../config/lrucashe.js";
import { ProjectMemberRole } from "../types.js";
import { AlertCategorySchema } from "../alerts/subscriptions/connector-subscription.types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { ProjectError, slugifyProjectName, validateStatusTransition, } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
export class ProjectService extends BaseProjectService {
    constructor(repository, logger, 
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository) {
        super(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    async listProjects(orgId, userId, query) {
        await this.requireOrganizationAccess(orgId, userId);
        const result = await this.repository.listProjects(orgId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return { ...result, limit: query.limit, offset };
    }
    async createProject(orgId, userId, body, meta) {
        await this.requireOrganizationAccess(orgId, userId, "admin");
        await this.enforceProjectModuleLimit(orgId, "project");
        const slug = await this.generateUniqueSlug(orgId, body.name);
        const project = await this.repository.withTransaction(async (client) => {
            const created = await this.repository.createProject({
                orgId,
                name: body.name,
                slug,
                description: body.description ?? null,
                visibility: body.visibility ?? "private",
                status: body.status ?? "active",
                timezone: body.timezone ?? "UTC",
                tags: body.tags ?? [],
                icon: body.icon ?? null,
                color: body.color ?? null,
                metadata: body.metadata ?? {},
                createdBy: userId,
            }, client);
            await this.repository.addProjectMember(created.id, orgId, userId, ProjectMemberRole.OWNER, userId, client);
            // Provision project defaults required by dashboards and alert routing.
            await this.settingsRepository.createDefault(created.id, orgId, client);
            await this.seedDefaultNotificationPreferences(created.id, orgId, client);
            return created;
        });
        await this.audit(meta, {
            orgId,
            action: "project.created",
            entityType: "project",
            entityId: project.id,
            entityName: project.name,
            newValues: { name: project.name, slug: project.slug, visibility: project.visibility },
        });
        this.logger.info({ orgId, projectId: project.id, userId }, "Project created");
        return project;
    }
    async seedDefaultNotificationPreferences(projectId, orgId, client) {
        const categories = AlertCategorySchema.options;
        if (categories.length === 0)
            return;
        const placeholders = [];
        const values = [];
        let i = 1;
        for (const category of categories) {
            placeholders.push(`($${i++}, $${i++}, $${i++}, TRUE)`);
            values.push(projectId, orgId, category);
        }
        await client.query(`INSERT INTO project_notification_preferences (
         project_id, organization_id, category, enabled
       ) VALUES ${placeholders.join(", ")}
       ON CONFLICT (project_id, category) DO NOTHING`, values);
    }
    async getProject(orgId, projectId, userId) {
        return this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    }
    async getProjectOverview(orgId, projectId, userId) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const settings = await this.settingsRepository.findByProjectId(projectId);
        if (!settings)
            throw new ProjectError("SETTINGS_NOT_FOUND", "Project settings not found", 404);
        const members = this.repository.findProjectMembers ? await this.repository.findProjectMembers(orgId, projectId) : [];
        const apiKeys = await this.apiKeyRepository.listApiKeys(orgId, projectId);
        const now = new Date();
        const usage = {
            totalEventsToday: 0,
            totalBytesToday: 0,
            peakHour: 0,
            currentHourEvents: 0,
            categoryBreakdown: {},
            eventTypeBreakdown: {},
            hourlyBreakdown: [],
            dailyTrend: [],
            heatmapData: []
        };
        return {
            project,
            settings,
            memberCount: members.length,
            apiKeyCount: apiKeys.length,
            usage,
        };
    }
    async updateProject(orgId, projectId, userId, body, meta) {
        const current = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (body.status && body.status !== current.status &&
            !validateStatusTransition(current.status, body.status)) {
            throw new ProjectError("PROJECT_INVALID_TRANSITION", `Cannot transition project from ${current.status} to ${body.status}`, 400);
        }
        if (body.status === "active" && current.status !== "active") {
            await this.requireMutableBilling(orgId);
        }
        const updates = {};
        if (body.name !== undefined)
            updates.name = body.name;
        if (body.description !== undefined)
            updates.description = body.description;
        if (body.status !== undefined) {
            updates.status = body.status;
            updates.archivedAt = body.status === "archived" ? new Date() : null;
        }
        if (body.visibility !== undefined)
            updates.visibility = body.visibility;
        if (body.timezone !== undefined)
            updates.timezone = body.timezone;
        if (body.tags !== undefined)
            updates.tags = body.tags;
        if (body.icon !== undefined)
            updates.icon = body.icon;
        if (body.color !== undefined)
            updates.color = body.color;
        if (body.metadata !== undefined)
            updates.metadata = body.metadata;
        if (body.version !== undefined)
            updates.version = body.version;
        const updated = await this.repository.updateProject(orgId, projectId, updates);
        // If the project is no longer active, evict its cached keys now so ingestion
        // stops accepting data within this request rather than after the LRU TTL.
        if (body.status !== undefined && body.status !== "active") {
            await this.evictProjectApiKeys(projectId);
        }
        await this.audit(meta, {
            orgId,
            action: "project.updated",
            entityType: "project",
            entityId: updated.id,
            entityName: updated.name,
            changedFields: Object.keys(body),
            newValues: { status: updated.status },
        });
        return updated;
    }
    async deleteProject(orgId, projectId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "owner");
        // Evict cached keys BEFORE soft delete so ingestion stops resolving them
        // immediately. Revoke all keys so the secrets cannot be reactivated.
        await this.evictProjectApiKeys(projectId);
        await this.repository.withTransaction(async (client) => {
            const keys = await this.apiKeyRepository.listActiveApiKeyRecords(projectId, undefined, client);
            for (const key of keys) {
                await this.apiKeyRepository.revokeApiKey(projectId, key.id, userId, "project_deleted", client);
            }
            await this.repository.softDeleteProject(orgId, projectId, userId, client);
        });
        await this.audit(meta, {
            orgId,
            action: "project.deleted",
            entityType: "project",
            entityId: projectId,
            isSensitive: true,
        });
        this.logger.warn({ orgId, projectId, userId }, "Project soft-deleted");
    }
    async restoreProject(orgId, projectId, userId, meta) {
        await this.requireOrganizationAccess(orgId, userId, "owner");
        const project = await this.repository.findProjectByIdIncludingDeleted(orgId, projectId);
        if (!project)
            throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
        if (!project.deletedAt)
            return project;
        await this.enforceProjectModuleLimit(orgId, "project");
        const restored = await this.repository.restoreProject(orgId, projectId);
        await this.audit(meta, {
            orgId,
            action: "project.restored",
            entityType: "project",
            entityId: restored.id,
            entityName: restored.name,
            newValues: { status: restored.status },
        });
        return restored;
    }
    async archiveProject(orgId, projectId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (project.status === "archived")
            return project;
        return this.updateProject(orgId, projectId, userId, { status: "archived" }, meta);
    }
    async unarchiveProject(orgId, projectId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (project.status !== "archived") {
            throw new ProjectError("PROJECT_INVALID_TRANSITION", "Only archived projects can be unarchived", 400);
        }
        return this.updateProject(orgId, projectId, userId, { status: "active" }, meta);
    }
    async pauseProject(orgId, projectId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (project.status === "paused")
            return project;
        return this.updateProject(orgId, projectId, userId, { status: "paused" }, meta);
    }
    async resumeProject(orgId, projectId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (project.status !== "paused") {
            throw new ProjectError("PROJECT_INVALID_TRANSITION", "Only paused projects can be resumed", 400);
        }
        return this.updateProject(orgId, projectId, userId, { status: "active" }, meta);
    }
}
//# sourceMappingURL=project.service.js.map
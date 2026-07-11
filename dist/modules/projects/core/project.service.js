import { apiKeyCache } from "../../../config/lrucashe.js";
import { ProjectMemberRole } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { buildApiPrefixes, constantTimeEqualHex, createApiKey, defaultPermissionsForType, extractApiKeyPrefix, hasRequiredRole, hashApiKey, ProjectError, slugifyProjectName, validateStatusTransition, } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
// Per-key defaults used when warming the cache. Aligned with the ingestion
// service defaults so a key gets the same limit regardless of which path warmed
// the cache. A per-key override (if set) takes precedence.
const DEFAULT_API_KEY_RATE_LIMITS = {
    perSecond: 1000,
    perMinute: 10000,
};
const MAX_ACTIVE_KEYS_ON_CREATE = 5;
const MAX_ACTIVE_KEYS_ON_ENABLE = 10;
const DEFAULT_GRACE_PERIOD_HOURS = 24;
const DEFAULT_PROJECT_BOOTSTRAP_ENVIRONMENT_COUNT = 3;
const BILLING_MUTABLE_STATUSES = new Set(["trialing", "active"]);
const ROLE_HIERARCHY = {
    [ProjectMemberRole.OWNER]: 4,
    [ProjectMemberRole.ADMIN]: 3,
    [ProjectMemberRole.DEVELOPER]: 2,
    [ProjectMemberRole.VIEWER]: 1,
};
export function hasProjectRole(userRole, required) {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}
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
        const entitlements = await this.enforceProjectModuleLimit(orgId, "project");
        await this.enforceProjectModuleLimit(orgId, "environment", DEFAULT_PROJECT_BOOTSTRAP_ENVIRONMENT_COUNT);
        const slug = await this.generateUniqueSlug(orgId, body.name);
        const prefixes = buildApiPrefixes();
        const config = {};
        this.assignProjectConfig(config, body);
        const project = await this.repository.withTransaction(async (client) => {
            const created = await this.repository.createProject({
                orgId,
                name: body.name,
                slug,
                description: body.description ?? null,
                environment: body.environment,
                productionApiPrefix: body.productionApiPrefix ?? prefixes.productionApiPrefix,
                developmentApiPrefix: body.developmentApiPrefix ?? prefixes.developmentApiPrefix,
                stagingApiPrefix: body.stagingApiPrefix ?? prefixes.stagingApiPrefix,
                config,
            }, client);
            for (const environment of ["development", "staging", "production"]) {
                await this.environmentRepository.createEnvironment({
                    projectId: created.id,
                    orgId: created.orgId,
                    environment,
                    createdBy: userId,
                }, client);
            }
            await this.repository.createDefaultSdkConfigs(created, userId, entitlements.plan_key, client);
            // [DISABLED] RemoteSDK configuration is deferred until Phase 2.
            // The project is created without remote infrastructure provisioning.
            // To enable: uncomment the block below and ensure RemoteSDK credentials
            // are available in the environment.
            /*
            const remoteSdk = new RemoteSDK({ orgId: created.org_id });
            await remoteSdk.configureProject({
              projectId: created.id,
              slug: created.slug,
              environment: created.environment,
            });
            */
            return created;
        });
        await this.audit(meta, {
            orgId,
            action: "project.created",
            entityType: "project",
            entityId: project.id,
            entityName: project.name,
            newValues: { name: project.name, slug: project.slug, environment: project.environment },
        });
        this.logger.info({ orgId, projectId: project.id, userId }, "Project created");
        return project;
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
        if (body.environment !== undefined)
            updates.environment = body.environment;
        if (body.productionApiPrefix !== undefined)
            updates.productionApiPrefix = body.productionApiPrefix;
        if (body.developmentApiPrefix !== undefined)
            updates.developmentApiPrefix = body.developmentApiPrefix;
        if (body.stagingApiPrefix !== undefined)
            updates.stagingApiPrefix = body.stagingApiPrefix;
        this.assignProjectConfig(updates, body);
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
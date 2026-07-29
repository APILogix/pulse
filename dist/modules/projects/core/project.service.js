import { apiKeyCache } from "../../../config/lrucashe.js";
import { ProjectMemberRole } from "../types.js";
import { AlertCategorySchema } from "../alerts/subscriptions/connector-subscription.types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { createApiKey, ProjectError, slugifyProjectName, validateStatusTransition, } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
import { EnvironmentType } from "../environments/environment.types.js";
import { SdkConfigProvisioner } from "../sdk-config/sdk-config.provisioner.js";
import { syncProjectLookupToLogDbBestEffort, syncEnvironmentLookupToLogDbBestEffort, syncApiKeyLookupToLogDbBestEffort, } from "../../../shared/logdb/lookup-sync.js";
/** Fixed identity of the single default environment created with every project. */
const DEFAULT_PRODUCTION_ENVIRONMENT = {
    name: "Production",
    slug: "production",
    type: EnvironmentType.PRODUCTION,
    description: "Production telemetry",
    color: "#16A34A",
};
export class ProjectService extends BaseProjectService {
    sdkConfigProvisioner;
    constructor(repository, logger, 
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    orgRepo, auditService, settingsRepository, apiKeyRepository, environmentRepository, usageRepository, sdkConfigProvisioner = new SdkConfigProvisioner()) {
        super(repository, logger, orgRepo, auditService, settingsRepository, apiKeyRepository, environmentRepository, usageRepository);
        this.sdkConfigProvisioner = sdkConfigProvisioner;
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    async listProjects(orgId, userId, query) {
        await this.requireOrganizationAccess(orgId, userId);
        const result = await this.repository.listProjects(orgId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return { ...result, limit: query.limit, offset };
    }
    /**
     * Create a project and provision a complete, production-ready runtime in a
     * single database transaction:
     *   1. Project row
     *   2. Owner membership
     *   3. Project settings
     *   4. Exactly ONE Production environment (default, active)
     *   5. SDK configuration head + published revision #1 for that environment
     *   6. One initial Production API key (shown once)
     *   7. Usage counters
     *   8. Notification preferences
     *
     * No additional environments (Staging/Development/Testing/Preview/...) are
     * created here — those exist only when the user explicitly creates them.
     */
    async createProject(orgId, userId, body, meta) {
        await this.requireOrganizationAccess(orgId, userId, "admin");
        await this.enforceProjectModuleLimit(orgId, "project");
        const slug = await this.generateUniqueSlug(orgId, body.name);
        const keyMaterial = createApiKey(DEFAULT_PRODUCTION_ENVIRONMENT.slug);
        const result = await this.repository.withTransaction(async (client) => {
            const project = await this.repository.createProject({
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
            await this.repository.ensureProjectOwner(project.id, orgId, userId, client);
            await this.settingsRepository.createDefault(project.id, orgId, client);
            // Exactly one Production environment. All runtime resources below are
            // provisioned explicitly in this same transaction (no DB trigger).
            const environment = await this.environmentRepository.createEnvironment({
                projectId: project.id,
                orgId,
                name: DEFAULT_PRODUCTION_ENVIRONMENT.name,
                slug: DEFAULT_PRODUCTION_ENVIRONMENT.slug,
                type: DEFAULT_PRODUCTION_ENVIRONMENT.type,
                description: DEFAULT_PRODUCTION_ENVIRONMENT.description,
                color: DEFAULT_PRODUCTION_ENVIRONMENT.color,
                isDefault: true,
                isActive: true,
            }, client);
            // SDK configuration head + published revision #1 for the environment.
            await this.sdkConfigProvisioner.provisionInitial(client, {
                organizationId: orgId,
                projectId: project.id,
                environmentId: environment.id,
                environmentKey: environment.slug,
            }, userId);
            // One initial Production API key (subsequent environments do NOT get keys).
            const apiKey = await this.apiKeyRepository.createApiKey({
                projectId: project.id,
                organizationId: orgId,
                environmentId: environment.id,
                publicKey: keyMaterial.publicKey,
                secretHash: keyMaterial.secretHash,
                name: "Production Default Key",
                createdBy: userId,
                expiresAt: null,
            }, client);
            await this.repository.provisionUsageCounter(project, client);
            await this.seedDefaultNotificationPreferences(project.id, orgId, client);
            return { project, environment, apiKey };
        });
        await this.audit(meta, {
            orgId,
            projectId: result.project.id,
            action: "project.created",
            entityType: "project",
            entityId: result.project.id,
            entityName: result.project.name,
            newValues: {
                name: result.project.name,
                slug: result.project.slug,
                visibility: result.project.visibility,
                environmentId: result.environment.id,
                apiKeyId: result.apiKey.id,
            },
        });
        this.logger.info({ orgId, projectId: result.project.id, environmentId: result.environment.id, userId }, "Project created with Production environment, SDK configuration, and initial API key");
        // Best-effort Log DB lookup snapshots (analytics attribution). Never blocks
        // or rolls back the committed primary-DB create; the primary DB is the
        // source of truth. See docs/distributed-ingestion-routing-master-prompt.md.
        syncProjectLookupToLogDbBestEffort(result.project.id, "project.created");
        syncEnvironmentLookupToLogDbBestEffort(result.environment.id, "environment.created");
        syncApiKeyLookupToLogDbBestEffort(result.apiKey.id, "api_key.created");
        return {
            project: result.project,
            environment: result.environment,
            apiKey: this.apiKeyRepository.publicShape(result.apiKey),
            fullKey: keyMaterial.fullKey,
        };
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
       ON CONFLICT DO NOTHING`, values);
    }
    async getProject(orgId, projectId, userId) {
        return this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    }
    async getProjectByPublicId(orgId, publicId, userId) {
        await this.requireOrganizationAccess(orgId, userId);
        const project = await this.repository.findProjectByPublicId(orgId, publicId);
        if (!project)
            throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
        // Now do the standard access check using the resolved UUID.
        return this.requireProjectAccess(orgId, project.id, userId, ProjectMemberRole.VIEWER);
    }
    async getProjectOverview(orgId, projectId, userId) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const settings = await this.settingsRepository.findByProjectId(projectId);
        if (!settings)
            throw new ProjectError("SETTINGS_NOT_FOUND", "Project settings not found", 404);
        const usage = await this.usageRepository.getProjectOverview(orgId, projectId);
        return {
            project,
            settings,
            memberCount: usage.memberCount,
            apiKeyCount: usage.apiKeyCount,
            usage: {
                totalEventsToday: usage.totalEventsToday,
                totalBytesToday: usage.totalBytesToday,
                peakHour: usage.peakHour,
                currentHourEvents: usage.currentHourEvents,
                categoryBreakdown: usage.categoryBreakdown,
                eventTypeBreakdown: usage.eventTypeBreakdown,
                hourlyBreakdown: usage.hourlyBreakdown,
                dailyTrend: usage.dailyTrend,
                heatmapData: usage.heatmapData,
            },
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
            projectId,
            action: "project.updated",
            entityType: "project",
            entityId: updated.id,
            entityName: updated.name,
            changedFields: Object.keys(body),
            newValues: { status: updated.status },
        });
        syncProjectLookupToLogDbBestEffort(projectId, "project.updated");
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
                await this.apiKeyRepository.revokeApiKey(projectId, key.id, client);
            }
            await this.repository.softDeleteProject(orgId, projectId, userId, client);
        });
        await this.audit(meta, {
            orgId,
            projectId,
            action: "project.deleted",
            entityType: "project",
            entityId: projectId,
            isSensitive: true,
        });
        this.logger.warn({ orgId, projectId, userId }, "Project soft-deleted");
        syncProjectLookupToLogDbBestEffort(projectId, "project.deleted");
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
            projectId,
            action: "project.restored",
            entityType: "project",
            entityId: restored.id,
            entityName: restored.name,
            newValues: { status: restored.status },
        });
        syncProjectLookupToLogDbBestEffort(projectId, "project.restored");
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
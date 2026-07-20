import { ProjectMemberRole } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { ProjectError } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
import { randomBytes } from "crypto";
function slugifyEnvironmentName(name) {
    const slug = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
    return slug || `env-${randomBytes(3).toString("hex")}`;
}
export class EnvironmentService extends BaseProjectService {
    constructor(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository) {
        super(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    }
    async listEnvironments(orgId, projectId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        return this.environmentRepository.listEnvironments(projectId);
    }
    async getEnvironment(orgId, projectId, environmentId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const env = await this.environmentRepository.findEnvironment(projectId, environmentId);
        if (!env)
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
        return env;
    }
    async createEnvironment(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        await this.enforceProjectModuleLimit(orgId, "environment");
        const env = await this.environmentRepository.createEnvironment({
            projectId,
            orgId,
            name: body.name,
            slug: slugifyEnvironmentName(body.name),
            description: body.description ?? null,
            color: body.color ?? null,
            icon: body.icon ?? null,
            isDefault: body.isDefault,
            isActive: body.isActive,
            createdByUserId: userId,
            rateLimitPerSecond: body.rateLimitPerSecond ?? null,
            rateLimitPerMinute: body.rateLimitPerMinute ?? null,
            rateLimitPerHour: body.rateLimitPerHour ?? null,
            burstLimit: body.burstLimit ?? null,
            allowedEventTypes: body.allowedEventTypes,
            maxEventSizeBytes: body.maxEventSizeBytes ?? null,
            maxBatchSize: body.maxBatchSize ?? null,
            requireHttps: body.requireHttps,
            ipAllowlist: body.ipAllowlist ?? null,
            ipBlocklist: body.ipBlocklist ?? null,
            alertEmail: body.alertEmail ?? null,
            alertWebhookUrl: body.alertWebhookUrl ?? null,
        });
        await this.audit(meta, {
            orgId,
            action: "environment.created",
            entityType: "project_environment",
            entityId: env.id,
            newValues: { name: env.name, slug: env.slug },
        });
        return env;
    }
    async updateEnvironment(orgId, projectId, environmentId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const updated = await this.environmentRepository.updateEnvironment(projectId, environmentId, {
            name: body.name,
            description: body.description,
            color: body.color,
            icon: body.icon,
            isActive: body.isActive,
            isDefault: body.isDefault,
            rateLimitPerSecond: body.rateLimitPerSecond,
            rateLimitPerMinute: body.rateLimitPerMinute,
            rateLimitPerHour: body.rateLimitPerHour,
            burstLimit: body.burstLimit,
            allowedEventTypes: body.allowedEventTypes,
            maxEventSizeBytes: body.maxEventSizeBytes,
            maxBatchSize: body.maxBatchSize,
            requireHttps: body.requireHttps,
            ipAllowlist: body.ipAllowlist,
            ipBlocklist: body.ipBlocklist,
            alertEmail: body.alertEmail,
            alertWebhookUrl: body.alertWebhookUrl,
        });
        await this.audit(meta, {
            orgId,
            action: "environment.updated",
            entityType: "project_environment",
            entityId: updated.id,
            changedFields: Object.keys(body),
        });
        return updated;
    }
    async deleteEnvironment(orgId, projectId, environmentId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        await this.environmentRepository.deleteEnvironment(projectId, environmentId);
        await this.audit(meta, {
            orgId,
            action: "environment.deleted",
            entityType: "project_environment",
            entityId: environmentId,
            isSensitive: true,
        });
    }
}
//# sourceMappingURL=environment.service.js.map
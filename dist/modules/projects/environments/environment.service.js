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
export class EnvironmentService extends BaseProjectService {
    constructor(repository, logger, 
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository) {
        super(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    // ── Environments ─────────────────────────────────────────────────────────
    async listEnvironments(orgId, projectId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        return this.environmentRepository.listEnvironments(projectId);
    }
    async getEnvironment(orgId, projectId, environment, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const env = await this.environmentRepository.findEnvironment(projectId, environment);
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
            environment: body.environment,
            createdBy: userId,
            isActive: body.isActive,
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
            action: "project.environment_created",
            entityType: "project_environment",
            entityId: env.id,
            newValues: { environment: env.environment },
        });
        return env;
    }
    async updateEnvironment(orgId, projectId, environment, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const updated = await this.environmentRepository.updateEnvironment(projectId, environment, {
            isActive: body.isActive,
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
            action: "project.environment_updated",
            entityType: "project_environment",
            entityId: updated.id,
            changedFields: Object.keys(body),
        });
        return updated;
    }
    async deleteEnvironment(orgId, projectId, environment, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        await this.environmentRepository.deleteEnvironment(projectId, environment);
        await this.audit(meta, {
            orgId,
            action: "project.environment_deleted",
            entityType: "project_environment",
            metadata: { projectId, environment },
            isSensitive: true,
        });
    }
}
//# sourceMappingURL=environment.service.js.map
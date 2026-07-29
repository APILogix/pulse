import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "./environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { EnvironmentType, } from "./environment.types.js";
import { ProjectError } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
import { SdkConfigProvisioner } from "../sdk-config/sdk-config.provisioner.js";
import { syncEnvironmentLookupToLogDbBestEffort } from "../../../shared/logdb/lookup-sync.js";
export class EnvironmentService extends BaseProjectService {
    sdkConfigProvisioner;
    constructor(repository, logger, orgRepo, auditService, settingsRepository, apiKeyRepository, environmentRepository, usageRepository, sdkConfigProvisioner = new SdkConfigProvisioner()) {
        super(repository, logger, orgRepo, auditService, settingsRepository, apiKeyRepository, environmentRepository, usageRepository);
        this.sdkConfigProvisioner = sdkConfigProvisioner;
    }
    async listEnvironments(orgId, projectId, userId, includeDeleted = false) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        return this.environmentRepository.listEnvironments(projectId, includeDeleted);
    }
    async getEnvironment(orgId, projectId, environmentId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const environment = await this.environmentRepository.findEnvironment(projectId, environmentId);
        if (!environment)
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
        return environment;
    }
    async createEnvironment(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (body.type === EnvironmentType.CUSTOM) {
            await this.enforceProjectModuleLimit(orgId, "environment");
        }
        // Every environment creation atomically provisions its SDK configuration
        // head + published revision #1 in the same transaction. This applies to
        // ALL environment types with no exceptions. No API keys are created here —
        // additional environments only receive keys when the user requests them.
        const environment = await this.repository.withTransaction(async (client) => {
            const created = await this.environmentRepository.createEnvironment({
                projectId,
                orgId,
                name: body.name,
                slug: body.slug,
                type: body.type,
                description: body.description ?? null,
                color: body.color,
                isDefault: body.isDefault,
                isActive: body.isActive,
            }, client);
            await this.sdkConfigProvisioner.provisionInitial(client, {
                organizationId: orgId,
                projectId,
                environmentId: created.id,
                environmentKey: created.slug,
            }, userId);
            return created;
        });
        await this.writeAudit(meta, orgId, "environment.created", environment, {
            name: environment.name,
            slug: environment.slug,
            type: environment.type,
        });
        syncEnvironmentLookupToLogDbBestEffort(environment.id, "environment.created");
        return environment;
    }
    async updateEnvironment(orgId, projectId, environmentId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const existing = await this.environmentRepository.findEnvironment(projectId, environmentId);
        if (!existing)
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
        if (body.type === EnvironmentType.CUSTOM && existing.type !== EnvironmentType.CUSTOM) {
            await this.enforceProjectModuleLimit(orgId, "environment");
        }
        const updated = await this.environmentRepository.updateEnvironment(projectId, environmentId, body);
        await this.audit(meta, {
            orgId,
            projectId,
            action: "environment.updated",
            entityType: "project_environment",
            entityId: updated.id,
            entityName: updated.name,
            oldValues: { ...existing },
            newValues: { ...updated },
            changedFields: Object.keys(body),
        });
        syncEnvironmentLookupToLogDbBestEffort(updated.id, "environment.updated");
        return updated;
    }
    async deleteEnvironment(orgId, projectId, environmentId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        await this.environmentRepository.deleteEnvironment(projectId, environmentId);
        await this.audit(meta, {
            orgId,
            projectId,
            action: "environment.deleted",
            entityType: "project_environment",
            entityId: environmentId,
            isSensitive: true,
        });
        syncEnvironmentLookupToLogDbBestEffort(environmentId, "environment.deleted");
    }
    async restoreEnvironment(orgId, projectId, environmentId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const restored = await this.environmentRepository.restoreEnvironment(projectId, environmentId);
        await this.writeAudit(meta, orgId, "environment.restored", restored);
        syncEnvironmentLookupToLogDbBestEffort(restored.id, "environment.restored");
        return restored;
    }
    async setDefaultEnvironment(orgId, projectId, environmentId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const environment = await this.environmentRepository.setDefaultEnvironment(projectId, environmentId);
        await this.writeAudit(meta, orgId, "environment.default_set", environment);
        syncEnvironmentLookupToLogDbBestEffort(environment.id, "environment.default_set");
        return environment;
    }
    async deactivateEnvironment(orgId, projectId, environmentId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const environment = await this.environmentRepository.deactivateEnvironment(projectId, environmentId);
        await this.writeAudit(meta, orgId, "environment.deactivated", environment);
        syncEnvironmentLookupToLogDbBestEffort(environment.id, "environment.deactivated");
        return environment;
    }
    async writeAudit(meta, orgId, action, environment, newValues) {
        await this.audit(meta, {
            orgId,
            projectId: environment.projectId,
            action,
            entityType: "project_environment",
            entityId: environment.id,
            entityName: environment.name,
            ...(newValues ? { newValues } : {}),
        });
    }
}
//# sourceMappingURL=environment.service.js.map
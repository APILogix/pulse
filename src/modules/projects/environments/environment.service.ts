/** Project environment lifecycle and authorization service. */
import type { FastifyBaseLogger } from "fastify";
import { apiKeyCache } from "../../../config/lrucashe.js";
import type { OrganizationRepository } from "../../organization/repository.js";
import type { OrganizationAuditService } from "../../organization/audit-logs/audit-logs.service.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "./environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import {
  EnvironmentType,
  type CreateEnvironmentBody,
  type ProjectEnvironmentConfig,
  type UpdateEnvironmentBody,
} from "./environment.types.js";
import { ProjectError } from "../shared/utils.js";
import { BaseProjectService, type RequestMeta } from "../shared/base.service.js";
import { SdkConfigProvisioner } from "../sdk-config/sdk-config.provisioner.js";
import { syncEnvironmentLookupToLogDbBestEffort } from "../../../shared/logdb/lookup-sync.js";

export class EnvironmentService extends BaseProjectService {
  constructor(
    repository: ProjectsRepository,
    logger: FastifyBaseLogger,
    orgRepo: OrganizationRepository,
    auditService: OrganizationAuditService,
    settingsRepository: SettingsRepository,
    apiKeyRepository: ApiKeyRepository,
    environmentRepository: EnvironmentRepository,
    usageRepository: UsageRepository,
    private readonly sdkConfigProvisioner: SdkConfigProvisioner = new SdkConfigProvisioner(),
  ) {
    super(repository, logger, orgRepo, auditService, settingsRepository, apiKeyRepository,
      environmentRepository, usageRepository);
  }

  async listEnvironments(
    orgId: string,
    projectId: string,
    userId: string,
    includeDeleted = false,
  ): Promise<ProjectEnvironmentConfig[]> {
    await this.requireProjectAccess(orgId, projectId, userId, "member");
    return this.environmentRepository.listEnvironments(projectId, includeDeleted);
  }

  async getEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
  ): Promise<ProjectEnvironmentConfig> {
    await this.requireProjectAccess(orgId, projectId, userId, "member");
    const environment = await this.environmentRepository.findEnvironment(projectId, environmentId);
    if (!environment) throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
    return environment;
  }

  async createEnvironment(
    orgId: string,
    projectId: string,
    userId: string,
    body: CreateEnvironmentBody,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
    await this.requireProjectAccess(orgId, projectId, userId, "admin");
    if (body.type === EnvironmentType.CUSTOM) {
      await this.enforceProjectModuleLimit(orgId, "environment");
    }

    // Every environment creation atomically provisions its SDK configuration
    // head + published revision #1 in the same transaction. This applies to
    // ALL environment types with no exceptions. No API keys are created here —
    // additional environments only receive keys when the user requests them.
    const environment = await this.repository.withTransaction(async (client) => {
      const created = await this.environmentRepository.createEnvironment(
        {
          projectId,
          orgId,
          name: body.name,
          slug: body.slug,
          type: body.type,
          description: body.description ?? null,
          color: body.color,
          isDefault: body.isDefault,
          isActive: body.isActive,
        },
        client,
      );
      await this.sdkConfigProvisioner.provisionInitial(
        client,
        {
          organizationId: orgId,
          projectId,
          environmentId: created.id,
          environmentKey: created.slug,
        },
        userId,
      );
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

  async updateEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
    body: UpdateEnvironmentBody,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
    await this.requireProjectAccess(orgId, projectId, userId, "admin");
    const existing = await this.environmentRepository.findEnvironment(projectId, environmentId);
    if (!existing) throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
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

  async deleteEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
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

  async restoreEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
    await this.requireProjectAccess(orgId, projectId, userId, "admin");
    const restored = await this.environmentRepository.restoreEnvironment(projectId, environmentId);
    await this.writeAudit(meta, orgId, "environment.restored", restored);
    syncEnvironmentLookupToLogDbBestEffort(restored.id, "environment.restored");
    return restored;
  }

  /**
   * Irreversibly delete a soft-deleted environment and every API key,
   * rotation record, and release scoped to it. SDK configuration head +
   * revisions cascade automatically via their FK to the environment.
   *
   * Requires the environment to already be soft-deleted (via
   * `deleteEnvironment`) so this destructive action is always a deliberate
   * confirmation step, never triggered by a single click.
   */
  async permanentlyDeleteEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.requireProjectAccess(orgId, projectId, userId, "owner");

    const { deletedApiKeySecretHashes, deletedActiveApiKeyCount } =
      await this.environmentRepository.permanentlyDeleteEnvironment(projectId, environmentId);

    // Evict every purged credential from the ingestion LRU immediately; the
    // rows are gone, so a stale cache entry would otherwise keep authenticating.
    for (const secretHash of deletedApiKeySecretHashes) {
      try {
        apiKeyCache.delete(secretHash);
      } catch (err) {
        this.logger.warn({ err }, "Failed to evict purged API key from cache");
      }
    }

    // The environment's active API keys are gone permanently, so the org-level
    // fast-path counter must shrink by that count. Best-effort: the live
    // COUNT(*) enforcement path remains authoritative for limits.
    if (deletedActiveApiKeyCount > 0) {
      try {
        await this.orgRepo.adjustApiKeyUsageCounter(orgId, -deletedActiveApiKeyCount);
      } catch (err) {
        this.logger.warn({ err, orgId }, "Failed to adjust organization api_keys_used counter after environment purge");
      }
    }

    await this.audit(meta, {
      orgId,
      projectId,
      action: "environment.permanently_deleted",
      entityType: "project_environment",
      entityId: environmentId,
      isSensitive: true,
      newValues: { deletedApiKeyCount: deletedApiKeySecretHashes.length },
    });
    syncEnvironmentLookupToLogDbBestEffort(environmentId, "environment.permanently_deleted");
  }

  async setDefaultEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
    await this.requireProjectAccess(orgId, projectId, userId, "admin");
    const environment = await this.environmentRepository.setDefaultEnvironment(projectId, environmentId);
    await this.writeAudit(meta, orgId, "environment.default_set", environment);
    syncEnvironmentLookupToLogDbBestEffort(environment.id, "environment.default_set");
    return environment;
  }

  async deactivateEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
    await this.requireProjectAccess(orgId, projectId, userId, "admin");
    const environment = await this.environmentRepository.deactivateEnvironment(projectId, environmentId);
    await this.writeAudit(meta, orgId, "environment.deactivated", environment);
    syncEnvironmentLookupToLogDbBestEffort(environment.id, "environment.deactivated");
    return environment;
  }

  private async writeAudit(
    meta: RequestMeta,
    orgId: string,
    action: string,
    environment: ProjectEnvironmentConfig,
    newValues?: Record<string, unknown>,
  ): Promise<void> {
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
/**
 * Environment business service.
 *
 * Flow:
 * 1. Authorize via organization membership before any read/mutation.
 * 2. Manage project environments as first-class rows in project_environments.
 * 3. Write every lifecycle event to organization_audit_logs.
 */
import type { FastifyBaseLogger } from "fastify";
import type { BillingEntitlementsRow, OrganizationRepository } from "../../organization/repository.js";
import { ProjectMemberRole } from "../types.js";
import {
  ProjectsRepository,
  type ProjectModuleUsageCounts
} from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import type {
  CreateEnvironmentBody,
  ProjectEnvironmentConfig,
  UpdateEnvironmentBody,
} from "../types.js";
import { ProjectError } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
import { randomBytes } from "crypto";

export interface RequestMeta {
  actorUserId: string;
  actorEmail: string | null;
  actorSessionId: string | null;
  actorIp: string;
  actorUserAgent: string | null;
  requestId: string;
  httpMethod: string;
  endpoint: string;
}

function slugifyEnvironmentName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || `env-${randomBytes(3).toString("hex")}`;
}

export class EnvironmentService extends BaseProjectService {
  constructor(
    repository: ProjectsRepository,
    logger: FastifyBaseLogger,
    orgRepo: OrganizationRepository,
    settingsRepository: SettingsRepository,
    apiKeyRepository: ApiKeyRepository,
    environmentRepository: EnvironmentRepository,
    activityRepository: ActivityRepository,
    usageRepository: UsageRepository,
  ) {
      super(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
  }

  public async listEnvironments(orgId: string, projectId: string, userId: string): Promise<ProjectEnvironmentConfig[]> {
    await this.requireProjectAccess(orgId, projectId, userId, "member");
    return this.environmentRepository.listEnvironments(projectId);
  }

  public async getEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
  ): Promise<ProjectEnvironmentConfig> {
    await this.requireProjectAccess(orgId, projectId, userId, "member");
    const env = await this.environmentRepository.findEnvironment(projectId, environmentId);
    if (!env) throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
    return env;
  }

  public async createEnvironment(
    orgId: string,
    projectId: string,
    userId: string,
    body: CreateEnvironmentBody,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
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

  public async updateEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
    body: UpdateEnvironmentBody,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
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

  public async deleteEnvironment(
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
      action: "environment.deleted",
      entityType: "project_environment",
      entityId: environmentId,
      isSensitive: true,
    });
  }
}

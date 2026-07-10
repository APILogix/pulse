/**
 * Project business service.
 *
 * Flow:
 * 1. Authorize via organization membership before any read/mutation (tenant
 *    isolation root check). Role gating is centralized in requireProjectAccess.
 * 2. Enforce project status transitions, API-key limits, and key lifecycle.
 * 3. Mint key material in memory; persist only hash + prefix; return the full
 *    key exactly once.
 * 4. Warm/evict the in-process LRU (config/lrucashe.ts, 30-min TTL) so ingestion
 *    resolves keys without a Postgres round trip. NO Redis.
 * 5. Write every sensitive lifecycle event to organization_audit_logs (projects
 *    and API keys are org-owned resources, so they share the org audit trail).
 */
import type { FastifyBaseLogger } from "fastify";
import { apiKeyCache, type CachedProjectConfig } from "../../../config/lrucashe.js";
import type { BillingEntitlementsRow, OrganizationRepository } from "../../organization/repository.js";
import { ProjectMemberRole, type ProjectOverviewDto, type ProjectSettings } from "../types.js";
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
  ApiKeyUsage,
  BulkOperationResult,
  BulkRevokeBody,
  BulkRotateBody,
  CreateApiKeyBody,
  CreateApiKeyResponse,
  CreateEnvironmentBody,
  CreateProjectBody,
  ListApiKeysQuery,
  ListProjectActivityQuery,
  ListProjectsQuery,
  OrgRole,
  Project,
  ProjectActivityResult,
  ProjectApiKey,
  ProjectApiKeyRecord,
  ProjectEnvironment,
  ProjectEnvironmentConfig,
  ProjectListItem,
  ProjectUsageCounter,
  ProjectWithStats,
  RotateApiKeyBody,
  UpdateApiKeyBody,
  UpdateEnvironmentBody,
  UpdateProjectBody,
  ValidatedApiKey, ProjectUpdateInput, ApiKeyUpdateInput } from "../types.js";
import {
  buildApiPrefixes,
  constantTimeEqualHex,
  createApiKey,
  defaultPermissionsForType,
  extractApiKeyPrefix,
  hasRequiredRole,
  hashApiKey,
  ProjectError,
  slugifyProjectName,
  validateStatusTransition,
} from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";

// Audit/request footprint passed from routes. Mirrors the organization
// module's RequestMeta so audit rows are uniform across modules.
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

// Per-key defaults used when warming the cache. Aligned with the ingestion
// service defaults so a key gets the same limit regardless of which path warmed
// the cache. A per-key override (if set) takes precedence.
const DEFAULT_API_KEY_RATE_LIMITS = {
  perSecond: 1000,
  perMinute: 10000,
} as const;

const MAX_ACTIVE_KEYS_ON_CREATE = 5;
const MAX_ACTIVE_KEYS_ON_ENABLE = 10;
const DEFAULT_GRACE_PERIOD_HOURS = 24;
const DEFAULT_PROJECT_BOOTSTRAP_ENVIRONMENT_COUNT = 3;
const BILLING_MUTABLE_STATUSES = new Set(["trialing", "active"]);

const ROLE_HIERARCHY: Record<ProjectMemberRole, number> = {
  [ProjectMemberRole.OWNER]: 4,
  [ProjectMemberRole.ADMIN]: 3,
  [ProjectMemberRole.DEVELOPER]: 2,
  [ProjectMemberRole.VIEWER]: 1,
};

export function hasProjectRole(userRole: ProjectMemberRole, required: ProjectMemberRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}

export class EnvironmentService extends BaseProjectService {
  constructor(
    repository: ProjectsRepository,
    logger: FastifyBaseLogger,
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    orgRepo: OrganizationRepository,
    settingsRepository: SettingsRepository,
    apiKeyRepository: ApiKeyRepository,
    environmentRepository: EnvironmentRepository,
    activityRepository: ActivityRepository,
    usageRepository: UsageRepository,
  ) {
      super(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
  }

  // ── Projects ────────────────────────────────────────────────────────────────
  // ── Environments ─────────────────────────────────────────────────────────

  public async listEnvironments(orgId: string, projectId: string, userId: string): Promise<ProjectEnvironmentConfig[]> {
    await this.requireProjectAccess(orgId, projectId, userId, "member");
    return this.environmentRepository.listEnvironments(projectId);
  }

  public async getEnvironment(
    orgId: string,
    projectId: string,
    environment: ProjectEnvironment,
    userId: string,
  ): Promise<ProjectEnvironmentConfig> {
    await this.requireProjectAccess(orgId, projectId, userId, "member");
    const env = await this.environmentRepository.findEnvironment(projectId, environment);
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

  public async updateEnvironment(
    orgId: string,
    projectId: string,
    environment: ProjectEnvironment,
    userId: string,
    body: UpdateEnvironmentBody,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
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

  public async deleteEnvironment(
    orgId: string,
    projectId: string,
    environment: ProjectEnvironment,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
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

  // ── API keys ─────────────────────────────────────────────────────────────
  // ── Verification (ingestion-facing) ─────────────────────────────────────────
  // ── Authorization ───────────────────────────────────────────────────────────
  // ── Internal helpers ────────────────────────────────────────────────────────
}

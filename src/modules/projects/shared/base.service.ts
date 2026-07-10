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

export class BaseProjectService {
  constructor(
    public readonly repository: ProjectsRepository,
    public readonly logger: FastifyBaseLogger,
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    public readonly orgRepo: OrganizationRepository,
    public readonly settingsRepository: SettingsRepository,
    public readonly apiKeyRepository: ApiKeyRepository,
    public readonly environmentRepository: EnvironmentRepository,
    public readonly activityRepository: ActivityRepository,
    public readonly usageRepository: UsageRepository,
  ) {}

  // ── Projects ────────────────────────────────────────────────────────────────

  public async getProjectStats(orgId: string, projectId: string, userId: string): Promise<ProjectWithStats> {
    const project = await this.requireProjectAccess(orgId, projectId, userId, "member");
    const stats = await this.repository.getProjectStats(projectId);
    return {
      ...project,
      stats: {
        totalRequests: stats.totalRequests,
        apiKeysCount: stats.apiKeysCount,
        activeKeysCount: stats.activeKeysCount,
        environmentCount: stats.environmentCount,
      },
    };
  }

  public async getProjectUsage(
    orgId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectUsageCounter[]> {
    await this.requireProjectAccess(orgId, projectId, userId, "member");
    return this.repository.getProjectUsageCounters(projectId);
  }

  // ── Environments ─────────────────────────────────────────────────────────
  // ── API keys ─────────────────────────────────────────────────────────────
  // ── Verification (ingestion-facing) ─────────────────────────────────────────
  // ── Authorization ───────────────────────────────────────────────────────────

  public async requireOrganizationAccess(
    orgId: string,
    userId: string,
    requiredRole: OrgRole = "viewer",
  ) {
    const membership = await this.repository.findOrganizationMembership(orgId, userId);
    if (!membership || !membership.isActive) {
      throw new ProjectError(
        "INSUFFICIENT_PERMISSIONS",
        "You do not have access to this organization",
        403,
      );
    }
    if (!hasRequiredRole(membership.role, requiredRole)) {
      throw new ProjectError(
        "INSUFFICIENT_PERMISSIONS",
        `Requires ${requiredRole} role or higher`,
        403,
      );
    }
    return membership;
  }

  public async requireProjectAccess(
    orgId: string,
    projectId: string,
    userId: string,
    requiredRole: OrgRole | ProjectMemberRole,
  ): Promise<Project> {
    const project = await this.repository.findProjectById(orgId, projectId);
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);

    if (requiredRole === "owner" || requiredRole === "admin" || requiredRole === "member" || requiredRole === "billing") {
      await this.requireOrganizationAccess(orgId, userId, requiredRole);
      return project;
    }

    try {
      await this.requireOrganizationAccess(orgId, userId);
    } catch (err) {
      throw err;
    }

    if ((this.repository as any).getProjectMemberRole) {
      const userProjectRole = await (this.repository as any).getProjectMemberRole(orgId, projectId, userId);
      if (userProjectRole) {
         if (!hasProjectRole(userProjectRole, requiredRole as ProjectMemberRole)) {
           throw new ProjectError("FORBIDDEN", "Insufficient project role", 403);
         }
         return project;
      }
    }

    return project;
  }

  public limitFrom(
    entitlements: BillingEntitlementsRow,
    keys: string[],
    fallback = Number.POSITIVE_INFINITY,
  ): number {
    const config = entitlements.feature_config ?? {};
    for (const key of keys) {
      const raw = config[key];
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
        return Number(raw);
      }
    }
    return fallback;
  }

  public assertWithinLimit(
    name: string,
    used: number,
    limit: number,
    increment = 1,
  ): void {
    if (limit >= 0 && Number.isFinite(limit) && used + increment > limit) {
      throw new ProjectError(
        "PROJECT_LIMIT_EXCEEDED",
        `${name} limit exceeded for current billing plan`,
        403,
        { used, limit, requested: increment },
      );
    }
  }

  public async requireMutableBilling(orgId: string): Promise<BillingEntitlementsRow> {
    const entitlements = await this.orgRepo.getBillingEntitlements(orgId);
    if (!entitlements) {
      throw new ProjectError(
        "PROJECT_LIMIT_EXCEEDED",
        "Organization has no active billing subscription",
        403,
      );
    }
    if (!BILLING_MUTABLE_STATUSES.has(entitlements.subscription_status)) {
      throw new ProjectError(
        "PROJECT_LIMIT_EXCEEDED",
        `Billing subscription is ${entitlements.subscription_status}. This action is not permitted.`,
        403,
      );
    }
    return entitlements;
  }

  public async enforceProjectModuleLimit(
    orgId: string,
    capability: "project" | "environment" | "apiKey",
    increment = 1,
  ): Promise<BillingEntitlementsRow> {
    const entitlements = await this.requireMutableBilling(orgId);
    const counts: ProjectModuleUsageCounts = await this.repository.getProjectModuleUsageCounts(orgId);

    if (capability === "project") {
      this.assertWithinLimit(
        "Project",
        counts.projects,
        this.limitFrom(entitlements, ["max_projects", "projects_max"]),
        increment,
      );
    }
    if (capability === "environment") {
      this.assertWithinLimit(
        "Project environment",
        counts.environments,
        this.limitFrom(entitlements, ["max_project_environments", "max_environments", "environments_max"]),
        increment,
      );
    }
    if (capability === "apiKey") {
      this.assertWithinLimit(
        "Project API key",
        counts.apiKeys,
        this.limitFrom(entitlements, ["max_project_api_keys", "max_api_keys", "api_keys_max"]),
        increment,
      );
    }

    return entitlements;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  public assignProjectConfig(
    target: ProjectUpdateInput,
    body: CreateProjectBody | UpdateProjectBody,
  ): void {
    if (body.rateLimitPerSecond !== undefined) target.rateLimitPerSecond = body.rateLimitPerSecond;
    if (body.rateLimitPerMinute !== undefined) target.rateLimitPerMinute = body.rateLimitPerMinute;
    if (body.rateLimitPerHour !== undefined) target.rateLimitPerHour = body.rateLimitPerHour;
    if (body.burstLimit !== undefined) target.burstLimit = body.burstLimit;
    if (body.allowedEventTypes !== undefined) target.allowedEventTypes = body.allowedEventTypes;
    if (body.maxEventSizeBytes !== undefined) target.maxEventSizeBytes = body.maxEventSizeBytes;
    if (body.maxBatchSize !== undefined) target.maxBatchSize = body.maxBatchSize;
    if (body.allowedOrigins !== undefined) target.allowedOrigins = body.allowedOrigins;
    if (body.requireHttps !== undefined) target.requireHttps = body.requireHttps;
    if (body.ipAllowlist !== undefined) target.ipAllowlist = body.ipAllowlist;
    if (body.ipBlocklist !== undefined) target.ipBlocklist = body.ipBlocklist;
    if (body.geoRestrictionEnabled !== undefined) target.geoRestrictionEnabled = body.geoRestrictionEnabled;
    if (body.allowedCountries !== undefined) target.allowedCountries = body.allowedCountries;
    if (body.alertEmail !== undefined) target.alertEmail = body.alertEmail;
    if (body.alertWebhookUrl !== undefined) target.alertWebhookUrl = body.alertWebhookUrl;
    if (body.alertOnErrorRateThreshold !== undefined) target.alertOnErrorRateThreshold = body.alertOnErrorRateThreshold;
    if (body.alertOnLatencyThresholdMs !== undefined) target.alertOnLatencyThresholdMs = body.alertOnLatencyThresholdMs;
    if (body.metadata !== undefined) target.metadata = body.metadata;
    if (body.settings !== undefined) target.settings = body.settings;
  }

  public async generateUniqueSlug(orgId: string, name: string): Promise<string> {
    const baseSlug = slugifyProjectName(name);
    let candidate = baseSlug;
    let suffix = 1;
    while (await this.repository.findProjectBySlug(orgId, candidate)) {
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  /**
   * Write a project/API-key lifecycle event to the organization audit trail.
   * Non-fatal: a failed audit write never breaks the originating request.
   */
  public async audit(
    meta: RequestMeta,
    data: {
      orgId: string;
      action: string;
      entityType: string;
      entityId?: string;
      entityName?: string;
      oldValues?: Record<string, unknown> | null;
      newValues?: Record<string, unknown> | null;
      changedFields?: string[];
      isSensitive?: boolean;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      const record: Parameters<OrganizationRepository["createAuditLog"]>[0] = {
        orgId: data.orgId,
        action: data.action,
        entityType: data.entityType,
        actorUserId: meta.actorUserId,
        actorIp: meta.actorIp,
        actorUserAgent: meta.actorUserAgent,
        requestId: meta.requestId,
        httpMethod: meta.httpMethod,
        endpoint: meta.endpoint,
        status: "success",
      };
      // Only attach optional fields when present so exactOptionalPropertyTypes
      // is satisfied (no explicit `undefined` values).
      if (meta.actorEmail) record.actorEmail = meta.actorEmail;
      if (meta.actorSessionId) record.actorSessionId = meta.actorSessionId;
      if (data.entityId !== undefined) record.entityId = data.entityId;
      if (data.entityName !== undefined) record.entityName = data.entityName;
      if (data.oldValues !== undefined) record.oldValues = data.oldValues;
      if (data.newValues !== undefined) record.newValues = data.newValues;
      if (data.changedFields !== undefined) record.changedFields = data.changedFields;
      if (data.isSensitive !== undefined) record.isSensitive = data.isSensitive;
      if (data.metadata !== undefined) record.metadata = data.metadata;

      await this.orgRepo.createAuditLog(record);
    } catch (err) {
      this.logger.error({ err, action: data.action }, "Failed to write project audit log");
    }
  }

    public async evictProjectApiKeys(projectId: string): Promise<void> {
        try {
          const hashes = await this.apiKeyRepository.listApiKeyHashesByProject(projectId);
          for (const hash of hashes) apiKeyCache.delete(hash);
        } catch (err) {
          this.logger.warn({ err, projectId }, "Failed to evict project API key cache");
        }
    }
}

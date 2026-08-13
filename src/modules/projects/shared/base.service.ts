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
import { entitlementsService } from "../../billing/entitlements/service.js";
import type { BillingEntitlementsRow, OrganizationRepository } from "../../organization/repository.js";
import type { OrganizationAuditService } from "../../organization/audit-logs/audit-logs.service.js";
import { ProjectMemberRole, type ProjectOverviewDto, type ProjectSettings } from "../types.js";
import {
  ProjectsRepository,
  type ProjectModuleUsageCounts
} from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
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
  ListProjectsQuery,
  OrgRole,
  Project,
  ProjectApiKey,
  ProjectApiKeyRecord,
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
  hasRequiredRole,
  ProjectError,
  slugifyProjectName,
  validateStatusTransition,
  isReservedProjectSlug,
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
  [ProjectMemberRole.QA]: 2,
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
    public readonly auditService: OrganizationAuditService,
    public readonly settingsRepository: SettingsRepository,
    public readonly apiKeyRepository: ApiKeyRepository,
    public readonly environmentRepository: EnvironmentRepository,
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

    // Org-only roles (member, billing, security) are governed by organization
    // membership. Every project-level role requires an explicit project_members
    // row; organization ownership/adminship is not sufficient by itself.
    const orgOnlyRoles: OrgRole[] = ["member", "billing", "security"];
    if (orgOnlyRoles.includes(requiredRole as OrgRole)) {
      await this.requireOrganizationAccess(orgId, userId, requiredRole as OrgRole);
      return project;
    }

    const userProjectRole = await this.repository.getProjectMemberRole(orgId, projectId, userId);
    if (!userProjectRole) {
      throw new ProjectError(
        "INSUFFICIENT_PERMISSIONS",
        "You do not have access to this project",
        403,
      );
    }
    if (!hasProjectRole(userProjectRole, requiredRole as ProjectMemberRole)) {
      throw new ProjectError(
        "INSUFFICIENT_PERMISSIONS",
        "Insufficient project role",
        403,
      );
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
    if (limit === -1) {
      // Explicit unlimited
      return;
    }
    if (limit >= 0 && Number.isFinite(limit) && used + increment > limit) {
      throw new ProjectError(
        "PROJECT_LIMIT_EXCEEDED",
        `${name} limit exceeded for current billing plan (limit: ${limit}, used: ${used})`,
        403,
        { used, limit, requested: increment },
      );
    }
  }

  public async requireMutableBilling(orgId: string): Promise<BillingEntitlementsRow> {
    const fromOrgRepo = await this.orgRepo?.getBillingEntitlements?.(orgId);
    if (fromOrgRepo) {
      if (!BILLING_MUTABLE_STATUSES.has(fromOrgRepo.subscription_status)) {
        throw new ProjectError(
          "PROJECT_LIMIT_EXCEEDED",
          `Billing subscription is ${fromOrgRepo.subscription_status}. This action is not permitted.`,
          403,
        );
      }
      return fromOrgRepo;
    }

    const sub = await entitlementsService.getSubscriptionState(orgId);
    if (!sub) {
      throw new ProjectError(
        "PROJECT_LIMIT_EXCEEDED",
        "Organization has no active billing subscription",
        403,
      );
    }
    if (!BILLING_MUTABLE_STATUSES.has(sub.status)) {
      throw new ProjectError(
        "PROJECT_LIMIT_EXCEEDED",
        `Billing subscription is ${sub.status}. This action is not permitted.`,
        403,
      );
    }
    const allEntitlements = await entitlementsService.getEffectiveEntitlements(orgId);
    const featureConfig: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(allEntitlements)) {
      featureConfig[k] = v.booleanValue ?? v.integerValue ?? v.decimalValue ?? v.stringValue ?? null;
    }
    const eventLimit = await entitlementsService.getEffectiveIntegerFeature(orgId, "quota.monthly_events");

    return {
      subscription_id: sub.subscriptionId,
      subscription_status: sub.status as any,
      plan_id: sub.planId,
      plan_key: sub.planKey,
      plan_tier: sub.planTier,
      feature_config: featureConfig,
      event_limit_monthly: eventLimit,
      hard_cap: false,
    };
  }

  public async enforceProjectModuleLimit(
    orgId: string,
    capability: "project" | "environment" | "apiKey",
    increment = 1,
  ): Promise<BillingEntitlementsRow> {
    const entitlements = await this.requireMutableBilling(orgId);
    const counts: ProjectModuleUsageCounts = await this.repository.getProjectModuleUsageCounts(orgId);

    if (capability === "project") {
      const configuredLimit = entitlements.feature_config["quota.projects"] ?? entitlements.feature_config["limit_projects"];
      const limit = configuredLimit !== undefined
        ? Number(configuredLimit)
        : ((await entitlementsService.getEffectiveIntegerFeature(orgId, "quota.projects")) || -1);
      this.assertWithinLimit("Project", counts.projects, limit, increment);
    }
    if (capability === "environment") {
      const configuredLimit = entitlements.feature_config["quota.environments"] ?? entitlements.feature_config["limit_environments"];
      const limit = configuredLimit !== undefined
        ? Number(configuredLimit)
        : ((await entitlementsService.getEffectiveIntegerFeature(orgId, "quota.environments")) || -1);
      this.assertWithinLimit("Project environment", counts.environments, limit, increment);
    }
    if (capability === "apiKey") {
      const configuredLimit = entitlements.feature_config["quota.api_keys"] ?? entitlements.feature_config["limit_api_keys"];
      const limit = configuredLimit !== undefined
        ? Number(configuredLimit)
        : ((await entitlementsService.getEffectiveIntegerFeature(orgId, "quota.api_keys")) || -1);
      this.assertWithinLimit("Project API key", counts.apiKeys, limit, increment);
    }

    return entitlements;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  public async generateUniqueSlug(orgId: string, name: string): Promise<string> {
    const baseSlug = slugifyProjectName(name);
    let candidate = baseSlug;
    let suffix = 1;
    while (
      isReservedProjectSlug(candidate) ||
      (await this.repository.findProjectBySlug(orgId, candidate))
    ) {
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
      projectId: string;
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
    await this.auditService.audit(meta, data);
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

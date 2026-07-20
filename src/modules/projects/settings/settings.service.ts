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
  ProjectEnvironmentConfig,
  ProjectListItem,
  ProjectUsageCounter,
  ProjectWithStats,
  RotateApiKeyBody,
  UpdateApiKeyBody,
  UpdateEnvironmentBody,
  UpdateProjectBody,
  ValidatedApiKey,
  ProjectUpdateInput,
  ApiKeyUpdateInput,
} from "../types.js";
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
  [ProjectMemberRole.QA]: 1,
  [ProjectMemberRole.VIEWER]: 0,
};

export function hasProjectRole(userRole: ProjectMemberRole, required: ProjectMemberRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}

export class SettingsService extends BaseProjectService {
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

  public async getProjectSettings(orgId: string, projectId: string, userId: string): Promise<ProjectSettings> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const settings = await this.settingsRepository.findByProjectId(projectId);
    if (!settings) throw new ProjectError("SETTINGS_NOT_FOUND", "Project settings not found", 404);
    return settings;
  }

  public async updateProjectSettings(
    orgId: string,
    projectId: string,
    userId: string,
    updates: Partial<Omit<ProjectSettings, "id" | "projectId" | "organizationId" | "createdAt" | "updatedAt">>,
    meta: RequestMeta
  ): Promise<ProjectSettings> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    const result = await this.settingsRepository.update(projectId, updates);

    await this.audit(meta, {
      orgId,
      action: "project.settings.updated",
      entityType: "project_settings",
      entityId: result.id,
      newValues: updates as any,
    });

    return result;
  }

  // ── Environments ─────────────────────────────────────────────────────────
  // ── API keys ─────────────────────────────────────────────────────────────
  // ── Verification (ingestion-facing) ─────────────────────────────────────────
  // ── Authorization ───────────────────────────────────────────────────────────
  // ── Internal helpers ────────────────────────────────────────────────────────
}

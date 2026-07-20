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
import { apiKeyCache, type CachedProjectConfig } from "../../config/lrucashe.js";
import type { BillingEntitlementsRow, OrganizationRepository } from "../organization/repository.js";
import { ProjectMemberRole, type ProjectOverviewDto, type ProjectSettings } from "./types.js";
import {
  ProjectsRepository,
  type ProjectModuleUsageCounts
} from "./repository.js";
import { SettingsRepository } from "./settings/settings.repository.js";
import { ApiKeyRepository } from "./api-keys/api-key.repository.js";
import { EnvironmentRepository } from "./environments/environment.repository.js";
import { ActivityRepository } from "./activity/activity.repository.js";
import { UsageRepository } from "./usage/usage.repository.js";
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
  ValidatedApiKey, ProjectUpdateInput, ApiKeyUpdateInput } from "./types.js";
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
} from "./shared/utils.js";
import { ProjectService } from "./core/project.service.js";
import { SettingsService } from "./settings/settings.service.js";
import { ProjectActivityService } from "./activity/activity.service.js";
import { EnvironmentService } from "./environments/environment.service.js";
import { ApiKeyService } from "./api-keys/api-key.service.js";
import { BaseProjectService } from "./shared/base.service.js";
import { MemberRepository } from "./members/member.repository.js";
import { ProjectMemberService } from "./members/member.service.js";
import { ProjectConnectorSubscriptionService } from "./alerts/subscriptions/connector-subscription.service.js";
import { ConnectorSubscriptionRepository } from "./alerts/subscriptions/connector-subscription.repository.js";
import { UsageAnalyticsRepository } from "./usage/analytics.repository.js";
import { UsageAnalyticsService } from "./usage/analytics.service.js";

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

export class ProjectsService {
    public readonly core: ProjectService;
    public readonly settings: SettingsService;
    public readonly activity: ProjectActivityService;
    public readonly environments: EnvironmentService;
    public readonly apiKeys: ApiKeyService;
    public readonly base: BaseProjectService;
    public readonly members: ProjectMemberService;
    public readonly connectorSubscriptions: ProjectConnectorSubscriptionService;
    public readonly analytics: UsageAnalyticsService;

  constructor(
    private readonly repository: ProjectsRepository,
    private readonly logger: FastifyBaseLogger,
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    private readonly orgRepo: OrganizationRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly environmentRepository: EnvironmentRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly usageRepository: UsageRepository,
  ) {

          this.core = new ProjectService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
          this.settings = new SettingsService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
          this.activity = new ProjectActivityService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
          this.environments = new EnvironmentService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
          this.apiKeys = new ApiKeyService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
          this.base = new BaseProjectService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
          this.members = new ProjectMemberService({
            repository,
            membersRepository: new MemberRepository(),
            logger,
            orgRepo,
            settingsRepository,
            apiKeyRepository,
            environmentRepository,
            activityRepository,
            usageRepository,
          });
          this.connectorSubscriptions = new ProjectConnectorSubscriptionService(
            new ConnectorSubscriptionRepository(),
            this.base,
            orgRepo,
            logger,
          );
          this.analytics = new UsageAnalyticsService(
            new UsageAnalyticsRepository(),
            this.base,
            logger,
          );}

  // ── Projects ────────────────────────────────────────────────────────────────

  async listProjects(
    orgId: string,
    userId: string,
    query: ListProjectsQuery,
  ): Promise<{
    projects: ProjectListItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
      return this.core.listProjects(orgId, userId, query) as any;
  }

  async createProject(
    orgId: string,
    userId: string,
    body: CreateProjectBody,
    meta: RequestMeta,
  ): Promise<Project> {
      return this.core.createProject(orgId, userId, body, meta) as any;
  }

  async getProject(orgId: string, projectId: string, userId: string): Promise<Project> {
      return this.core.getProject(orgId, projectId, userId) as any;
  }

  async getProjectSettings(orgId: string, projectId: string, userId: string): Promise<ProjectSettings> {
      return this.settings.getProjectSettings(orgId, projectId, userId) as any;
  }

  async updateProjectSettings(
    orgId: string,
    projectId: string,
    userId: string,
    updates: Partial<Omit<ProjectSettings, "id" | "projectId" | "organizationId" | "createdAt" | "updatedAt">>,
    meta: RequestMeta
  ): Promise<ProjectSettings> {
      return this.settings.updateProjectSettings(orgId, projectId, userId, updates, meta) as any;
  }

  async getProjectOverview(orgId: string, projectId: string, userId: string): Promise<ProjectOverviewDto> {
      return this.core.getProjectOverview(orgId, projectId, userId) as any;
  }

  async updateProject(
    orgId: string,
    projectId: string,
    userId: string,
    body: UpdateProjectBody,
    meta: RequestMeta,
  ): Promise<Project> {
      return this.core.updateProject(orgId, projectId, userId, body, meta) as any;
  }

  async deleteProject(
    orgId: string,
    projectId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
      return this.core.deleteProject(orgId, projectId, userId, meta) as any;
  }

  async restoreProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
      return this.core.restoreProject(orgId, projectId, userId, meta) as any;
  }

  async archiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
      return this.core.archiveProject(orgId, projectId, userId, meta) as any;
  }

  async unarchiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
      return this.core.unarchiveProject(orgId, projectId, userId, meta) as any;
  }

  async pauseProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
      return this.core.pauseProject(orgId, projectId, userId, meta) as any;
  }

  async resumeProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
      return this.core.resumeProject(orgId, projectId, userId, meta) as any;
  }

  async getProjectStats(orgId: string, projectId: string, userId: string): Promise<ProjectWithStats> {
      return this.base.getProjectStats(orgId, projectId, userId) as any;
  }

  async getProjectUsage(
    orgId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectUsageCounter[]> {
      return this.base.getProjectUsage(orgId, projectId, userId) as any;
  }

  async listProjectActivity(
    orgId: string,
    projectId: string,
    userId: string,
    query: ListProjectActivityQuery,
  ): Promise<ProjectActivityResult> {
      return this.activity.listProjectActivity(orgId, projectId, userId, query) as any;
  }

  // ── Environments ─────────────────────────────────────────────────────────

  async listEnvironments(orgId: string, projectId: string, userId: string): Promise<ProjectEnvironmentConfig[]> {
      return this.environments.listEnvironments(orgId, projectId, userId) as any;
  }

  async getEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
  ): Promise<ProjectEnvironmentConfig> {
      return (this.environments as any).getEnvironment(orgId, projectId, environmentId, userId) as any;
  }

  async createEnvironment(
    orgId: string,
    projectId: string,
    userId: string,
    body: CreateEnvironmentBody,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
      return (this.environments as any).createEnvironment(orgId, projectId, userId, body, meta) as any;
  }

  async updateEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
    body: UpdateEnvironmentBody,
    meta: RequestMeta,
  ): Promise<ProjectEnvironmentConfig> {
      return (this.environments as any).updateEnvironment(orgId, projectId, environmentId, userId, body, meta) as any;
  }

  async deleteEnvironment(
    orgId: string,
    projectId: string,
    environmentId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
      return (this.environments as any).deleteEnvironment(orgId, projectId, environmentId, userId, meta) as any;
  }

  // ── API keys ─────────────────────────────────────────────────────────────

  async listApiKeys(
    orgId: string,
    projectId: string,
    userId: string,
    query: ListApiKeysQuery,
  ): Promise<{ keys: ProjectApiKey[]; total: number; limit: number; offset: number }> {
      return this.apiKeys.listApiKeys(orgId, projectId, userId, query) as any;
  }

  async createApiKey(
    orgId: string,
    projectId: string,
    userId: string,
    body: CreateApiKeyBody,
    meta: RequestMeta,
  ): Promise<CreateApiKeyResponse> {
      return this.apiKeys.createApiKey(orgId, projectId, userId, body, meta) as any;
  }

  async getApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string): Promise<ProjectApiKey> {
      return this.apiKeys.getApiKey(orgId, projectId, apiKeyId, userId) as any;
  }

  async updateApiKey(
    orgId: string,
    projectId: string,
    apiKeyId: string,
    userId: string,
    body: UpdateApiKeyBody,
    meta: RequestMeta,
  ): Promise<ProjectApiKey> {
      return this.apiKeys.updateApiKey(orgId, projectId, apiKeyId, userId, body, meta) as any;
  }

  /** Revoke (delete) a key with a reason. Soft state change, not row removal. */
  async deleteApiKey(
    orgId: string,
    projectId: string,
    apiKeyId: string,
    userId: string,
    meta: RequestMeta,
    reason?: string | null,
  ): Promise<ProjectApiKey> {
      return this.apiKeys.deleteApiKey(orgId, projectId, apiKeyId, userId, meta, reason) as any;
  }

  async rotateApiKey(
    orgId: string,
    projectId: string,
    apiKeyId: string,
    userId: string,
    body: RotateApiKeyBody,
    meta: RequestMeta,
  ): Promise<CreateApiKeyResponse> {
      return this.apiKeys.rotateApiKey(orgId, projectId, apiKeyId, userId, body, meta) as any;
  }

  /** Emergency regenerate: rotate with no grace window (old key dies instantly). */
  async regenerateApiKey(
    orgId: string,
    projectId: string,
    apiKeyId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<CreateApiKeyResponse> {
      return this.apiKeys.regenerateApiKey(orgId, projectId, apiKeyId, userId, meta) as any;
  }

  async enableApiKey(
    orgId: string,
    projectId: string,
    apiKeyId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<ProjectApiKey> {
      return this.apiKeys.enableApiKey(orgId, projectId, apiKeyId, userId, meta) as any;
  }

  async disableApiKey(
    orgId: string,
    projectId: string,
    apiKeyId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<ProjectApiKey> {
      return this.apiKeys.disableApiKey(orgId, projectId, apiKeyId, userId, meta) as any;
  }

  async bulkRotateKeys(
    orgId: string,
    projectId: string,
    userId: string,
    body: BulkRotateBody,
    meta: RequestMeta,
  ): Promise<BulkOperationResult> {
      return this.apiKeys.bulkRotateKeys(orgId, projectId, userId, body, meta) as any;
  }

  async bulkRevokeKeys(
    orgId: string,
    projectId: string,
    userId: string,
    body: BulkRevokeBody,
    meta: RequestMeta,
  ): Promise<BulkOperationResult> {
      return this.apiKeys.bulkRevokeKeys(orgId, projectId, userId, body, meta) as any;
  }

  async getApiKeyUsage(
    orgId: string,
    projectId: string,
    apiKeyId: string,
    userId: string,
  ): Promise<ApiKeyUsage> {
      return this.apiKeys.getApiKeyUsage(orgId, projectId, apiKeyId, userId) as any;
  }

  // ── Verification (ingestion-facing) ─────────────────────────────────────────

  /**
   * Resolve a raw key to its validated context. Prefix narrows the candidate
   * set, then a constant-time hash compare prevents timing leaks. Enforces
   * project status, expiry, and rotation grace. Touches last_used_at async.
   */
  async validateApiKey(rawKey: string): Promise<ValidatedApiKey | null> {
      return this.apiKeys.validateApiKey(rawKey) as any;
  }

  // ── Authorization ───────────────────────────────────────────────────────────

  private async requireOrganizationAccess(
    orgId: string,
    userId: string,
    requiredRole: OrgRole = "viewer",
  ) {
      return this.base.requireOrganizationAccess(orgId, userId, requiredRole) as any;
  }

  public async requireProjectAccess(
    orgId: string,
    projectId: string,
    userId: string,
    requiredRole: OrgRole | ProjectMemberRole,
  ): Promise<Project> {
      return this.base.requireProjectAccess(orgId, projectId, userId, requiredRole) as any;
  }

  private limitFrom(
    entitlements: BillingEntitlementsRow,
    keys: string[],
    fallback = Number.POSITIVE_INFINITY,
  ): number {
      return this.base.limitFrom(entitlements, keys, fallback) as any;
  }

  private assertWithinLimit(
    name: string,
    used: number,
    limit: number,
    increment = 1,
  ): void {
      this.base.assertWithinLimit(name, used, limit, increment);
  }

  private async requireMutableBilling(orgId: string): Promise<BillingEntitlementsRow> {
      return this.base.requireMutableBilling(orgId) as any;
  }

  private async enforceProjectModuleLimit(
    orgId: string,
    capability: "project" | "environment" | "apiKey",
    increment = 1,
  ): Promise<BillingEntitlementsRow> {
      return this.base.enforceProjectModuleLimit(orgId, capability, increment) as any;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async generateUniqueSlug(orgId: string, name: string): Promise<string> {
      return this.base.generateUniqueSlug(orgId, name) as any;
  }

  private assertFutureExpiry(expiresAt: Date | null | undefined): void {
      this.apiKeys.assertFutureExpiry(expiresAt);
  }

  private publicApiKey(apiKey: ProjectApiKeyRecord | ProjectApiKey): ProjectApiKey {
      return this.apiKeys.publicApiKey(apiKey) as any;
  }

  private summarizeBulk(results: BulkOperationResult["results"]): BulkOperationResult {
      return this.apiKeys.summarizeBulk(results) as any;
  }

  /**
   * Warm the in-process LRU so ingestion resolves the key without a Postgres
   * round trip. Only active keys on active projects are cached as active;
   * ingestion re-validates project status on a miss.
   */
  private warmApiKeyCache(
    keyHash: string,
    key: ProjectApiKeyRecord | ProjectApiKey,
    project: Project,
  ): void {
      this.apiKeys.warmApiKeyCache(keyHash, key, project);
  }

  private evictApiKeyConfig(keyHash: string): void {
      this.apiKeys.evictApiKeyConfig(keyHash);
  }

  private async evictProjectApiKeys(projectId: string): Promise<void> {
      return this.base.evictProjectApiKeys(projectId);
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
      return this.base.audit(meta, data) as any;
  }
}

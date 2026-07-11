import { apiKeyCache } from "../../config/lrucashe.js";
import { ProjectMemberRole } from "./types.js";
import { ProjectsRepository } from "./repository.js";
import { SettingsRepository } from "./settings/settings.repository.js";
import { ApiKeyRepository } from "./api-keys/api-key.repository.js";
import { EnvironmentRepository } from "./environments/environment.repository.js";
import { ActivityRepository } from "./activity/activity.repository.js";
import { UsageRepository } from "./usage/usage.repository.js";
import { buildApiPrefixes, constantTimeEqualHex, createApiKey, defaultPermissionsForType, extractApiKeyPrefix, hasRequiredRole, hashApiKey, ProjectError, slugifyProjectName, validateStatusTransition, } from "./shared/utils.js";
import { ProjectService } from "./core/project.service.js";
import { SettingsService } from "./settings/settings.service.js";
import { ProjectActivityService } from "./activity/activity.service.js";
import { EnvironmentService } from "./environments/environment.service.js";
import { ApiKeyService } from "./api-keys/api-key.service.js";
import { BaseProjectService } from "./shared/base.service.js";
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
export class ProjectsService {
    repository;
    logger;
    orgRepo;
    settingsRepository;
    apiKeyRepository;
    environmentRepository;
    activityRepository;
    usageRepository;
    core;
    settings;
    activity;
    environments;
    apiKeys;
    base;
    constructor(repository, logger, 
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository) {
        this.repository = repository;
        this.logger = logger;
        this.orgRepo = orgRepo;
        this.settingsRepository = settingsRepository;
        this.apiKeyRepository = apiKeyRepository;
        this.environmentRepository = environmentRepository;
        this.activityRepository = activityRepository;
        this.usageRepository = usageRepository;
        this.core = new ProjectService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
        this.settings = new SettingsService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
        this.activity = new ProjectActivityService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
        this.environments = new EnvironmentService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
        this.apiKeys = new ApiKeyService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
        this.base = new BaseProjectService(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    async listProjects(orgId, userId, query) {
        return this.core.listProjects(orgId, userId, query);
    }
    async createProject(orgId, userId, body, meta) {
        return this.core.createProject(orgId, userId, body, meta);
    }
    async getProject(orgId, projectId, userId) {
        return this.core.getProject(orgId, projectId, userId);
    }
    async getProjectSettings(orgId, projectId, userId) {
        return this.settings.getProjectSettings(orgId, projectId, userId);
    }
    async updateProjectSettings(orgId, projectId, userId, updates, meta) {
        return this.settings.updateProjectSettings(orgId, projectId, userId, updates, meta);
    }
    async getProjectOverview(orgId, projectId, userId) {
        return this.core.getProjectOverview(orgId, projectId, userId);
    }
    async updateProject(orgId, projectId, userId, body, meta) {
        return this.core.updateProject(orgId, projectId, userId, body, meta);
    }
    async deleteProject(orgId, projectId, userId, meta) {
        return this.core.deleteProject(orgId, projectId, userId, meta);
    }
    async restoreProject(orgId, projectId, userId, meta) {
        return this.core.restoreProject(orgId, projectId, userId, meta);
    }
    async archiveProject(orgId, projectId, userId, meta) {
        return this.core.archiveProject(orgId, projectId, userId, meta);
    }
    async unarchiveProject(orgId, projectId, userId, meta) {
        return this.core.unarchiveProject(orgId, projectId, userId, meta);
    }
    async pauseProject(orgId, projectId, userId, meta) {
        return this.core.pauseProject(orgId, projectId, userId, meta);
    }
    async resumeProject(orgId, projectId, userId, meta) {
        return this.core.resumeProject(orgId, projectId, userId, meta);
    }
    async getProjectStats(orgId, projectId, userId) {
        return this.base.getProjectStats(orgId, projectId, userId);
    }
    async getProjectUsage(orgId, projectId, userId) {
        return this.base.getProjectUsage(orgId, projectId, userId);
    }
    async listProjectActivity(orgId, projectId, userId, query) {
        return this.activity.listProjectActivity(orgId, projectId, userId, query);
    }
    // ── Environments ─────────────────────────────────────────────────────────
    async listEnvironments(orgId, projectId, userId) {
        return this.environments.listEnvironments(orgId, projectId, userId);
    }
    async getEnvironment(orgId, projectId, environment, userId) {
        return this.environments.getEnvironment(orgId, projectId, environment, userId);
    }
    async createEnvironment(orgId, projectId, userId, body, meta) {
        return this.environments.createEnvironment(orgId, projectId, userId, body, meta);
    }
    async updateEnvironment(orgId, projectId, environment, userId, body, meta) {
        return this.environments.updateEnvironment(orgId, projectId, environment, userId, body, meta);
    }
    async deleteEnvironment(orgId, projectId, environment, userId, meta) {
        return this.environments.deleteEnvironment(orgId, projectId, environment, userId, meta);
    }
    // ── API keys ─────────────────────────────────────────────────────────────
    async listApiKeys(orgId, projectId, userId, query) {
        return this.apiKeys.listApiKeys(orgId, projectId, userId, query);
    }
    async createApiKey(orgId, projectId, userId, body, meta) {
        return this.apiKeys.createApiKey(orgId, projectId, userId, body, meta);
    }
    async getApiKey(orgId, projectId, apiKeyId, userId) {
        return this.apiKeys.getApiKey(orgId, projectId, apiKeyId, userId);
    }
    async updateApiKey(orgId, projectId, apiKeyId, userId, body, meta) {
        return this.apiKeys.updateApiKey(orgId, projectId, apiKeyId, userId, body, meta);
    }
    /** Revoke (delete) a key with a reason. Soft state change, not row removal. */
    async deleteApiKey(orgId, projectId, apiKeyId, userId, meta, reason) {
        return this.apiKeys.deleteApiKey(orgId, projectId, apiKeyId, userId, meta, reason);
    }
    async rotateApiKey(orgId, projectId, apiKeyId, userId, body, meta) {
        return this.apiKeys.rotateApiKey(orgId, projectId, apiKeyId, userId, body, meta);
    }
    /** Emergency regenerate: rotate with no grace window (old key dies instantly). */
    async regenerateApiKey(orgId, projectId, apiKeyId, userId, meta) {
        return this.apiKeys.regenerateApiKey(orgId, projectId, apiKeyId, userId, meta);
    }
    async enableApiKey(orgId, projectId, apiKeyId, userId, meta) {
        return this.apiKeys.enableApiKey(orgId, projectId, apiKeyId, userId, meta);
    }
    async disableApiKey(orgId, projectId, apiKeyId, userId, meta) {
        return this.apiKeys.disableApiKey(orgId, projectId, apiKeyId, userId, meta);
    }
    async bulkRotateKeys(orgId, projectId, userId, body, meta) {
        return this.apiKeys.bulkRotateKeys(orgId, projectId, userId, body, meta);
    }
    async bulkRevokeKeys(orgId, projectId, userId, body, meta) {
        return this.apiKeys.bulkRevokeKeys(orgId, projectId, userId, body, meta);
    }
    async getApiKeyUsage(orgId, projectId, apiKeyId, userId) {
        return this.apiKeys.getApiKeyUsage(orgId, projectId, apiKeyId, userId);
    }
    // ── Verification (ingestion-facing) ─────────────────────────────────────────
    /**
     * Resolve a raw key to its validated context. Prefix narrows the candidate
     * set, then a constant-time hash compare prevents timing leaks. Enforces
     * project status, expiry, and rotation grace. Touches last_used_at async.
     */
    async validateApiKey(rawKey) {
        return this.apiKeys.validateApiKey(rawKey);
    }
    // ── Authorization ───────────────────────────────────────────────────────────
    async requireOrganizationAccess(orgId, userId, requiredRole = "viewer") {
        return this.base.requireOrganizationAccess(orgId, userId, requiredRole);
    }
    async requireProjectAccess(orgId, projectId, userId, requiredRole) {
        return this.base.requireProjectAccess(orgId, projectId, userId, requiredRole);
    }
    limitFrom(entitlements, keys, fallback = Number.POSITIVE_INFINITY) {
        return this.base.limitFrom(entitlements, keys, fallback);
    }
    assertWithinLimit(name, used, limit, increment = 1) {
        this.base.assertWithinLimit(name, used, limit, increment);
    }
    async requireMutableBilling(orgId) {
        return this.base.requireMutableBilling(orgId);
    }
    async enforceProjectModuleLimit(orgId, capability, increment = 1) {
        return this.base.enforceProjectModuleLimit(orgId, capability, increment);
    }
    // ── Internal helpers ────────────────────────────────────────────────────────
    assignProjectConfig(target, body) {
        this.base.assignProjectConfig(target, body);
    }
    async generateUniqueSlug(orgId, name) {
        return this.base.generateUniqueSlug(orgId, name);
    }
    assertFutureExpiry(expiresAt) {
        this.apiKeys.assertFutureExpiry(expiresAt);
    }
    publicApiKey(apiKey) {
        return this.apiKeys.publicApiKey(apiKey);
    }
    summarizeBulk(results) {
        return this.apiKeys.summarizeBulk(results);
    }
    /**
     * Warm the in-process LRU so ingestion resolves the key without a Postgres
     * round trip. Only active keys on active projects are cached as active;
     * ingestion re-validates project status on a miss.
     */
    warmApiKeyCache(keyHash, key, project) {
        this.apiKeys.warmApiKeyCache(keyHash, key, project);
    }
    evictApiKeyConfig(keyHash) {
        this.apiKeys.evictApiKeyConfig(keyHash);
    }
    async evictProjectApiKeys(projectId) {
        return this.base.evictProjectApiKeys(projectId);
    }
    /**
     * Write a project/API-key lifecycle event to the organization audit trail.
     * Non-fatal: a failed audit write never breaks the originating request.
     */
    async audit(meta, data) {
        return this.base.audit(meta, data);
    }
}
//# sourceMappingURL=service.js.map
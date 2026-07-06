import { apiKeyCache } from "../../config/lrucashe.js";
import { ProjectsRepository, } from "./repository.js";
import { buildApiPrefixes, constantTimeEqualHex, createApiKey, defaultPermissionsForType, extractApiKeyPrefix, hasRequiredRole, hashApiKey, ProjectError, slugifyProjectName, validateStatusTransition, } from "./utils.js";
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
export class ProjectsService {
    repository;
    logger;
    orgRepo;
    constructor(repository, logger, 
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    orgRepo) {
        this.repository = repository;
        this.logger = logger;
        this.orgRepo = orgRepo;
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    async listProjects(orgId, userId, query) {
        await this.requireOrganizationAccess(orgId, userId);
        const result = await this.repository.listProjects(orgId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return { ...result, limit: query.limit, offset };
    }
    async createProject(orgId, userId, body, meta) {
        await this.requireOrganizationAccess(orgId, userId, "admin");
        const entitlements = await this.enforceProjectModuleLimit(orgId, "project");
        await this.enforceProjectModuleLimit(orgId, "environment", DEFAULT_PROJECT_BOOTSTRAP_ENVIRONMENT_COUNT);
        const slug = await this.generateUniqueSlug(orgId, body.name);
        const prefixes = buildApiPrefixes();
        const config = {};
        this.assignProjectConfig(config, body);
        const project = await this.repository.withTransaction(async (client) => {
            const created = await this.repository.createProject({
                orgId,
                name: body.name,
                slug,
                description: body.description ?? null,
                environment: body.environment,
                productionApiPrefix: body.productionApiPrefix ?? prefixes.productionApiPrefix,
                developmentApiPrefix: body.developmentApiPrefix ?? prefixes.developmentApiPrefix,
                stagingApiPrefix: body.stagingApiPrefix ?? prefixes.stagingApiPrefix,
                config,
            }, client);
            await this.repository.createDefaultEnvironments(created, userId, client);
            await this.repository.createDefaultSdkConfigs(created, userId, entitlements.plan_key, client);
            return created;
        });
        await this.audit(meta, {
            orgId,
            action: "project.created",
            entityType: "project",
            entityId: project.id,
            entityName: project.name,
            newValues: { name: project.name, slug: project.slug, environment: project.environment },
        });
        this.logger.info({ orgId, projectId: project.id, userId }, "Project created");
        return project;
    }
    async getProject(orgId, projectId, userId) {
        return this.requireProjectAccess(orgId, projectId, userId, "member");
    }
    async updateProject(orgId, projectId, userId, body, meta) {
        const current = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (body.status && body.status !== current.status &&
            !validateStatusTransition(current.status, body.status)) {
            throw new ProjectError("PROJECT_INVALID_TRANSITION", `Cannot transition project from ${current.status} to ${body.status}`, 400);
        }
        if (body.status === "active" && current.status !== "active") {
            await this.requireMutableBilling(orgId);
        }
        const updates = {};
        if (body.name !== undefined)
            updates.name = body.name;
        if (body.description !== undefined)
            updates.description = body.description;
        if (body.status !== undefined) {
            updates.status = body.status;
            updates.archivedAt = body.status === "archived" ? new Date() : null;
        }
        if (body.environment !== undefined)
            updates.environment = body.environment;
        if (body.productionApiPrefix !== undefined)
            updates.productionApiPrefix = body.productionApiPrefix;
        if (body.developmentApiPrefix !== undefined)
            updates.developmentApiPrefix = body.developmentApiPrefix;
        if (body.stagingApiPrefix !== undefined)
            updates.stagingApiPrefix = body.stagingApiPrefix;
        this.assignProjectConfig(updates, body);
        const updated = await this.repository.updateProject(orgId, projectId, updates);
        // If the project is no longer active, evict its cached keys now so ingestion
        // stops accepting data within this request rather than after the LRU TTL.
        if (body.status !== undefined && body.status !== "active") {
            await this.evictProjectApiKeys(projectId);
        }
        await this.audit(meta, {
            orgId,
            action: "project.updated",
            entityType: "project",
            entityId: updated.id,
            entityName: updated.name,
            changedFields: Object.keys(body),
            newValues: { status: updated.status },
        });
        return updated;
    }
    async deleteProject(orgId, projectId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "owner");
        // Evict cached keys BEFORE soft delete so ingestion stops resolving them
        // immediately. Revoke all keys so the secrets cannot be reactivated.
        await this.evictProjectApiKeys(projectId);
        await this.repository.withTransaction(async (client) => {
            const keys = await this.repository.listActiveApiKeyRecords(projectId, undefined, client);
            for (const key of keys) {
                await this.repository.revokeApiKey(projectId, key.id, userId, "project_deleted", client);
            }
            await this.repository.softDeleteProject(orgId, projectId, userId, client);
        });
        await this.audit(meta, {
            orgId,
            action: "project.deleted",
            entityType: "project",
            entityId: projectId,
            isSensitive: true,
        });
        this.logger.warn({ orgId, projectId, userId }, "Project soft-deleted");
    }
    async restoreProject(orgId, projectId, userId, meta) {
        await this.requireOrganizationAccess(orgId, userId, "owner");
        const project = await this.repository.findProjectByIdIncludingDeleted(orgId, projectId);
        if (!project)
            throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
        if (!project.deletedAt)
            return project;
        await this.enforceProjectModuleLimit(orgId, "project");
        const restored = await this.repository.restoreProject(orgId, projectId);
        await this.audit(meta, {
            orgId,
            action: "project.restored",
            entityType: "project",
            entityId: restored.id,
            entityName: restored.name,
            newValues: { status: restored.status },
        });
        return restored;
    }
    async archiveProject(orgId, projectId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (project.status === "archived")
            return project;
        return this.updateProject(orgId, projectId, userId, { status: "archived" }, meta);
    }
    async unarchiveProject(orgId, projectId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (project.status !== "archived") {
            throw new ProjectError("PROJECT_INVALID_TRANSITION", "Only archived projects can be unarchived", 400);
        }
        return this.updateProject(orgId, projectId, userId, { status: "active" }, meta);
    }
    async pauseProject(orgId, projectId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (project.status === "paused")
            return project;
        return this.updateProject(orgId, projectId, userId, { status: "paused" }, meta);
    }
    async resumeProject(orgId, projectId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (project.status !== "paused") {
            throw new ProjectError("PROJECT_INVALID_TRANSITION", "Only paused projects can be resumed", 400);
        }
        return this.updateProject(orgId, projectId, userId, { status: "active" }, meta);
    }
    async getProjectStats(orgId, projectId, userId) {
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
    async getProjectUsage(orgId, projectId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        return this.repository.getProjectUsageCounters(projectId);
    }
    async listProjectActivity(orgId, projectId, userId, query) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        return this.repository.listProjectActivity(orgId, projectId, query);
    }
    // ── Environments ─────────────────────────────────────────────────────────
    async listEnvironments(orgId, projectId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        return this.repository.listEnvironments(projectId);
    }
    async getEnvironment(orgId, projectId, environment, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const env = await this.repository.findEnvironment(projectId, environment);
        if (!env)
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
        return env;
    }
    async createEnvironment(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        await this.enforceProjectModuleLimit(orgId, "environment");
        const env = await this.repository.createEnvironment({
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
        const updated = await this.repository.updateEnvironment(projectId, environment, {
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
        await this.repository.deleteEnvironment(projectId, environment);
        await this.audit(meta, {
            orgId,
            action: "project.environment_deleted",
            entityType: "project_environment",
            metadata: { projectId, environment },
            isSensitive: true,
        });
    }
    // ── API keys ─────────────────────────────────────────────────────────────
    async listApiKeys(orgId, projectId, userId, query) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const result = await this.repository.listApiKeys(projectId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return { ...result, limit: query.limit, offset };
    }
    async createApiKey(orgId, projectId, userId, body, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        this.assertFutureExpiry(body.expiresAt);
        await this.enforceProjectModuleLimit(orgId, "apiKey");
        const activeKeys = await this.repository.countActiveApiKeys(projectId, body.environment);
        if (activeKeys >= MAX_ACTIVE_KEYS_ON_CREATE) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", `Maximum ${MAX_ACTIVE_KEYS_ON_CREATE} active API keys are allowed per environment`, 400);
        }
        const keyMaterial = createApiKey(body.environment);
        const permissions = body.permissions ?? defaultPermissionsForType(body.keyType);
        const created = await this.repository.createApiKey({
            projectId,
            orgId,
            keyHash: keyMaterial.keyHash,
            keyPrefix: keyMaterial.keyPrefix,
            keyType: body.keyType,
            environment: body.environment,
            name: body.name ?? null,
            description: body.description ?? null,
            createdBy: userId,
            expiresAt: body.expiresAt ?? null,
            autoRotateEnabled: body.autoRotateEnabled,
            autoRotateDays: body.autoRotateDays,
            permissions,
            allowedEndpoints: body.allowedEndpoints,
            blockedEndpoints: body.blockedEndpoints,
            rateLimitPerSecond: body.rateLimitPerSecond ?? null,
            rateLimitPerMinute: body.rateLimitPerMinute ?? null,
            rateLimitPerHour: body.rateLimitPerHour ?? null,
        });
        this.warmApiKeyCache(keyMaterial.keyHash, created, project);
        await this.audit(meta, {
            orgId,
            action: "project.api_key_created",
            entityType: "api_key",
            entityId: created.id,
            isSensitive: true,
            newValues: { projectId, environment: created.environment, keyType: created.keyType, keyPrefix: created.keyPrefix },
        });
        this.logger.info({ orgId, projectId, apiKeyId: created.id, userId }, "Project API key created");
        return { apiKey: this.publicApiKey(created), fullKey: keyMaterial.fullKey };
    }
    async getApiKey(orgId, projectId, apiKeyId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const apiKey = await this.repository.findApiKeyById(projectId, apiKeyId);
        if (!apiKey)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        return apiKey;
    }
    async updateApiKey(orgId, projectId, apiKeyId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        this.assertFutureExpiry(body.expiresAt);
        const updates = {};
        if (body.name !== undefined)
            updates.name = body.name;
        if (body.description !== undefined)
            updates.description = body.description;
        if (body.expiresAt !== undefined)
            updates.expiresAt = body.expiresAt;
        if (body.autoRotateEnabled !== undefined)
            updates.autoRotateEnabled = body.autoRotateEnabled;
        if (body.autoRotateDays !== undefined)
            updates.autoRotateDays = body.autoRotateDays;
        if (body.permissions !== undefined)
            updates.permissions = body.permissions;
        if (body.allowedEndpoints !== undefined)
            updates.allowedEndpoints = body.allowedEndpoints;
        if (body.blockedEndpoints !== undefined)
            updates.blockedEndpoints = body.blockedEndpoints;
        if (body.rateLimitPerSecond !== undefined)
            updates.rateLimitPerSecond = body.rateLimitPerSecond;
        if (body.rateLimitPerMinute !== undefined)
            updates.rateLimitPerMinute = body.rateLimitPerMinute;
        if (body.rateLimitPerHour !== undefined)
            updates.rateLimitPerHour = body.rateLimitPerHour;
        const updated = await this.repository.updateApiKey(projectId, apiKeyId, updates);
        // Permission/rate-limit changes affect the cached config; evict so the next
        // ingestion request re-resolves the fresh row.
        const record = await this.repository.findApiKeyRecordById(projectId, apiKeyId);
        if (record)
            this.evictApiKeyConfig(record.keyHash);
        await this.audit(meta, {
            orgId,
            action: "project.api_key_updated",
            entityType: "api_key",
            entityId: apiKeyId,
            changedFields: Object.keys(body),
        });
        return updated;
    }
    /** Revoke (delete) a key with a reason. Soft state change, not row removal. */
    async deleteApiKey(orgId, projectId, apiKeyId, userId, meta, reason) {
        await this.requireProjectAccess(orgId, projectId, userId, "owner");
        const record = await this.repository.findApiKeyRecordById(projectId, apiKeyId);
        if (!record)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        const revoked = await this.repository.revokeApiKey(projectId, apiKeyId, userId, reason ?? null);
        this.evictApiKeyConfig(record.keyHash);
        await this.audit(meta, {
            orgId,
            action: "project.api_key_revoked",
            entityType: "api_key",
            entityId: apiKeyId,
            isSensitive: true,
            newValues: { reason: reason ?? null },
        });
        return revoked;
    }
    async rotateApiKey(orgId, projectId, apiKeyId, userId, body, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        this.assertFutureExpiry(body.expiresAt);
        const currentKey = await this.repository.findApiKeyRecordById(projectId, apiKeyId);
        if (!currentKey)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        if (!currentKey.isActive || currentKey.status !== "active") {
            throw new ProjectError("API_KEY_REVOKED", "Cannot rotate an inactive API key", 400);
        }
        const graceHours = body.gracePeriodHours ?? DEFAULT_GRACE_PERIOD_HOURS;
        const graceEndsAt = graceHours > 0 ? new Date(Date.now() + graceHours * 3_600_000) : null;
        const keyMaterial = createApiKey(currentKey.environment);
        const rotated = await this.repository.withTransaction(async (client) => {
            await this.repository.markApiKeyRotated(projectId, apiKeyId, userId, body.rotationReason ?? "manual_rotation", graceEndsAt, client);
            return this.repository.createApiKey({
                projectId,
                orgId,
                keyHash: keyMaterial.keyHash,
                keyPrefix: keyMaterial.keyPrefix,
                keyType: currentKey.keyType,
                environment: currentKey.environment,
                name: body.name !== undefined ? body.name : currentKey.name,
                description: currentKey.description,
                createdBy: userId,
                expiresAt: body.expiresAt !== undefined ? body.expiresAt : currentKey.expiresAt,
                autoRotateEnabled: currentKey.autoRotateEnabled,
                autoRotateDays: currentKey.autoRotateDays,
                permissions: currentKey.permissions,
                allowedEndpoints: currentKey.allowedEndpoints,
                blockedEndpoints: currentKey.blockedEndpoints,
                rateLimitPerSecond: currentKey.rateLimitPerSecond,
                rateLimitPerMinute: currentKey.rateLimitPerMinute,
                rateLimitPerHour: currentKey.rateLimitPerHour,
                rotatedFromKeyId: apiKeyId,
            }, client);
        });
        // If there is no grace window, evict the old key now. With a grace window
        // the old key stays valid (and cached) until grace ends.
        if (!graceEndsAt)
            this.evictApiKeyConfig(currentKey.keyHash);
        this.warmApiKeyCache(keyMaterial.keyHash, rotated, project);
        await this.audit(meta, {
            orgId,
            action: "project.api_key_rotated",
            entityType: "api_key",
            entityId: apiKeyId,
            isSensitive: true,
            newValues: { newKeyId: rotated.id, gracePeriodHours: graceHours, reason: body.rotationReason ?? null },
        });
        return { apiKey: this.publicApiKey(rotated), fullKey: keyMaterial.fullKey };
    }
    /** Emergency regenerate: rotate with no grace window (old key dies instantly). */
    async regenerateApiKey(orgId, projectId, apiKeyId, userId, meta) {
        return this.rotateApiKey(orgId, projectId, apiKeyId, userId, { gracePeriodHours: 0, rotationReason: "emergency_regenerate" }, meta);
    }
    async enableApiKey(orgId, projectId, apiKeyId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const currentKey = await this.repository.findApiKeyRecordById(projectId, apiKeyId);
        if (!currentKey)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        if (currentKey.isActive)
            return this.publicApiKey(currentKey);
        if (currentKey.status === "revoked") {
            throw new ProjectError("API_KEY_REVOKED", "Revoked API keys cannot be re-enabled", 400);
        }
        if (currentKey.expiresAt && currentKey.expiresAt <= new Date()) {
            throw new ProjectError("API_KEY_EXPIRED", "Expired API keys cannot be re-enabled", 400);
        }
        await this.enforceProjectModuleLimit(orgId, "apiKey");
        const activeKeys = await this.repository.countActiveApiKeys(projectId, currentKey.environment);
        if (activeKeys >= MAX_ACTIVE_KEYS_ON_ENABLE) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", `Maximum ${MAX_ACTIVE_KEYS_ON_ENABLE} active API keys are allowed per environment`, 400);
        }
        const updated = await this.repository.setApiKeyActiveState(projectId, apiKeyId, true);
        this.warmApiKeyCache(currentKey.keyHash, { ...currentKey, isActive: true }, project);
        await this.audit(meta, {
            orgId,
            action: "project.api_key_enabled",
            entityType: "api_key",
            entityId: apiKeyId,
        });
        return updated;
    }
    async disableApiKey(orgId, projectId, apiKeyId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const record = await this.repository.findApiKeyRecordById(projectId, apiKeyId);
        if (!record)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        const updated = await this.repository.setApiKeyActiveState(projectId, apiKeyId, false);
        this.evictApiKeyConfig(record.keyHash);
        await this.audit(meta, {
            orgId,
            action: "project.api_key_disabled",
            entityType: "api_key",
            entityId: apiKeyId,
        });
        return updated;
    }
    async bulkRotateKeys(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const keys = await this.repository.listActiveApiKeyRecords(projectId, body.environment);
        const results = [];
        for (const key of keys) {
            try {
                const rotated = await this.rotateApiKey(orgId, projectId, key.id, userId, { gracePeriodHours: body.gracePeriodHours, rotationReason: body.rotationReason ?? "bulk_rotation" }, meta);
                results.push({ apiKeyId: key.id, status: "ok", newKeyId: rotated.apiKey.id });
            }
            catch (err) {
                results.push({ apiKeyId: key.id, status: "error", reason: err.message });
            }
        }
        return this.summarizeBulk(results);
    }
    async bulkRevokeKeys(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "owner");
        const keys = body.apiKeyIds
            ? body.apiKeyIds.map((id) => ({ id }))
            : (await this.repository.listActiveApiKeyRecords(projectId, body.environment)).map((k) => ({ id: k.id }));
        const results = [];
        for (const key of keys) {
            try {
                await this.deleteApiKey(orgId, projectId, key.id, userId, meta, body.revokedReason ?? "bulk_revocation");
                results.push({ apiKeyId: key.id, status: "ok" });
            }
            catch (err) {
                results.push({ apiKeyId: key.id, status: "error", reason: err.message });
            }
        }
        return this.summarizeBulk(results);
    }
    async getApiKeyUsage(orgId, projectId, apiKeyId, userId) {
        const apiKey = await this.getApiKey(orgId, projectId, apiKeyId, userId);
        const summary = await this.repository.getApiKeyUsageSummary(apiKeyId);
        return {
            keyId: apiKey.id,
            keyPrefix: apiKey.keyPrefix,
            totalRequests: summary.totalRequests || apiKey.usageCount,
            totalSuccess: summary.totalSuccess,
            totalErrors: summary.totalErrors || apiKey.errorCount,
            bytesIngested: summary.bytesIngested,
            eventsIngested: summary.eventsIngested,
            lastUsedAt: apiKey.lastUsedAt,
            requestsByDay: summary.requestsByDay,
        };
    }
    // ── Verification (ingestion-facing) ─────────────────────────────────────────
    /**
     * Resolve a raw key to its validated context. Prefix narrows the candidate
     * set, then a constant-time hash compare prevents timing leaks. Enforces
     * project status, expiry, and rotation grace. Touches last_used_at async.
     */
    async validateApiKey(rawKey) {
        const keyPrefix = extractApiKeyPrefix(rawKey);
        if (!keyPrefix)
            return null;
        const rawKeyHash = hashApiKey(rawKey);
        const candidates = await this.repository.findActiveApiKeyCandidatesByPrefix(keyPrefix);
        for (const candidate of candidates) {
            if (candidate.project.status !== "active")
                continue;
            if (candidate.apiKey.expiresAt && candidate.apiKey.expiresAt <= new Date())
                continue;
            if (constantTimeEqualHex(candidate.apiKey.keyHash, rawKeyHash)) {
                // Fire-and-forget usage touch; never block verification on the write.
                this.repository
                    .touchApiKeyLastUsed(candidate.apiKey.id)
                    .catch((err) => this.logger.debug({ err }, "touchApiKeyLastUsed failed"));
                return {
                    id: candidate.apiKey.id,
                    projectId: candidate.apiKey.projectId,
                    orgId: candidate.project.orgId,
                    environment: candidate.apiKey.environment,
                    keyType: candidate.apiKey.keyType,
                    permissions: candidate.apiKey.permissions,
                    allowedEndpoints: candidate.apiKey.allowedEndpoints,
                    blockedEndpoints: candidate.apiKey.blockedEndpoints,
                    rateLimitPerSecond: candidate.apiKey.rateLimitPerSecond,
                    rateLimitPerMinute: candidate.apiKey.rateLimitPerMinute,
                    rateLimitPerHour: candidate.apiKey.rateLimitPerHour,
                };
            }
        }
        return null;
    }
    // ── Authorization ───────────────────────────────────────────────────────────
    async requireOrganizationAccess(orgId, userId, requiredRole = "viewer") {
        const membership = await this.repository.findOrganizationMembership(orgId, userId);
        if (!membership || !membership.isActive) {
            throw new ProjectError("INSUFFICIENT_PERMISSIONS", "You do not have access to this organization", 403);
        }
        if (!hasRequiredRole(membership.role, requiredRole)) {
            throw new ProjectError("INSUFFICIENT_PERMISSIONS", `Requires ${requiredRole} role or higher`, 403);
        }
        return membership;
    }
    async requireProjectAccess(orgId, projectId, userId, requiredRole) {
        // Tenant isolation root check: caller MUST be an active org member with the
        // required role AND the project MUST belong to that org.
        await this.requireOrganizationAccess(orgId, userId, requiredRole);
        const project = await this.repository.findProjectById(orgId, projectId);
        if (!project)
            throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
        return project;
    }
    limitFrom(entitlements, keys, fallback = Number.POSITIVE_INFINITY) {
        const config = entitlements.feature_config ?? {};
        for (const key of keys) {
            const raw = config[key];
            if (typeof raw === "number" && Number.isFinite(raw))
                return raw;
            if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
                return Number(raw);
            }
        }
        return fallback;
    }
    assertWithinLimit(name, used, limit, increment = 1) {
        if (limit >= 0 && Number.isFinite(limit) && used + increment > limit) {
            throw new ProjectError("PROJECT_LIMIT_EXCEEDED", `${name} limit exceeded for current billing plan`, 403, { used, limit, requested: increment });
        }
    }
    async requireMutableBilling(orgId) {
        const entitlements = await this.orgRepo.getBillingEntitlements(orgId);
        if (!entitlements) {
            throw new ProjectError("PROJECT_LIMIT_EXCEEDED", "Organization has no active billing subscription", 403);
        }
        if (!BILLING_MUTABLE_STATUSES.has(entitlements.subscription_status)) {
            throw new ProjectError("PROJECT_LIMIT_EXCEEDED", `Billing subscription is ${entitlements.subscription_status}. This action is not permitted.`, 403);
        }
        return entitlements;
    }
    async enforceProjectModuleLimit(orgId, capability, increment = 1) {
        const entitlements = await this.requireMutableBilling(orgId);
        const counts = await this.repository.getProjectModuleUsageCounts(orgId);
        if (capability === "project") {
            this.assertWithinLimit("Project", counts.projects, this.limitFrom(entitlements, ["max_projects", "projects_max"]), increment);
        }
        if (capability === "environment") {
            this.assertWithinLimit("Project environment", counts.environments, this.limitFrom(entitlements, ["max_project_environments", "max_environments", "environments_max"]), increment);
        }
        if (capability === "apiKey") {
            this.assertWithinLimit("Project API key", counts.apiKeys, this.limitFrom(entitlements, ["max_project_api_keys", "max_api_keys", "api_keys_max"]), increment);
        }
        return entitlements;
    }
    // ── Internal helpers ────────────────────────────────────────────────────────
    assignProjectConfig(target, body) {
        if (body.rateLimitPerSecond !== undefined)
            target.rateLimitPerSecond = body.rateLimitPerSecond;
        if (body.rateLimitPerMinute !== undefined)
            target.rateLimitPerMinute = body.rateLimitPerMinute;
        if (body.rateLimitPerHour !== undefined)
            target.rateLimitPerHour = body.rateLimitPerHour;
        if (body.burstLimit !== undefined)
            target.burstLimit = body.burstLimit;
        if (body.allowedEventTypes !== undefined)
            target.allowedEventTypes = body.allowedEventTypes;
        if (body.maxEventSizeBytes !== undefined)
            target.maxEventSizeBytes = body.maxEventSizeBytes;
        if (body.maxBatchSize !== undefined)
            target.maxBatchSize = body.maxBatchSize;
        if (body.allowedOrigins !== undefined)
            target.allowedOrigins = body.allowedOrigins;
        if (body.requireHttps !== undefined)
            target.requireHttps = body.requireHttps;
        if (body.ipAllowlist !== undefined)
            target.ipAllowlist = body.ipAllowlist;
        if (body.ipBlocklist !== undefined)
            target.ipBlocklist = body.ipBlocklist;
        if (body.geoRestrictionEnabled !== undefined)
            target.geoRestrictionEnabled = body.geoRestrictionEnabled;
        if (body.allowedCountries !== undefined)
            target.allowedCountries = body.allowedCountries;
        if (body.alertEmail !== undefined)
            target.alertEmail = body.alertEmail;
        if (body.alertWebhookUrl !== undefined)
            target.alertWebhookUrl = body.alertWebhookUrl;
        if (body.alertOnErrorRateThreshold !== undefined)
            target.alertOnErrorRateThreshold = body.alertOnErrorRateThreshold;
        if (body.alertOnLatencyThresholdMs !== undefined)
            target.alertOnLatencyThresholdMs = body.alertOnLatencyThresholdMs;
        if (body.metadata !== undefined)
            target.metadata = body.metadata;
        if (body.settings !== undefined)
            target.settings = body.settings;
    }
    async generateUniqueSlug(orgId, name) {
        const baseSlug = slugifyProjectName(name);
        let candidate = baseSlug;
        let suffix = 1;
        while (await this.repository.findProjectBySlug(orgId, candidate)) {
            candidate = `${baseSlug}-${suffix}`;
            suffix += 1;
        }
        return candidate;
    }
    assertFutureExpiry(expiresAt) {
        if (expiresAt && expiresAt <= new Date()) {
            throw new ProjectError("VALIDATION_ERROR", "expiresAt must be in the future", 422);
        }
    }
    publicApiKey(apiKey) {
        const { ...rest } = apiKey;
        // Strip the hash if present; never expose it.
        delete rest.keyHash;
        return rest;
    }
    summarizeBulk(results) {
        const succeeded = results.filter((r) => r.status === "ok").length;
        return {
            total: results.length,
            succeeded,
            failed: results.length - succeeded,
            results,
        };
    }
    /**
     * Warm the in-process LRU so ingestion resolves the key without a Postgres
     * round trip. Only active keys on active projects are cached as active;
     * ingestion re-validates project status on a miss.
     */
    warmApiKeyCache(keyHash, key, project) {
        const config = {
            id: project.id,
            orgId: project.orgId,
            name: key.name ?? project.name,
            environment: key.environment,
            rateLimitPerSecond: key.rateLimitPerSecond ?? project.rateLimitPerSecond ?? DEFAULT_API_KEY_RATE_LIMITS.perSecond,
            rateLimitPerMinute: key.rateLimitPerMinute ?? project.rateLimitPerMinute ?? DEFAULT_API_KEY_RATE_LIMITS.perMinute,
            allowedEventTypes: project.allowedEventTypes.length ? project.allowedEventTypes : ["*"],
            permissions: key.permissions,
            allowedEndpoints: key.allowedEndpoints.length ? key.allowedEndpoints : ["*"],
            blockedEndpoints: key.blockedEndpoints,
            isActive: project.status === "active" && key.isActive,
            apiKeyId: key.id,
        };
        try {
            apiKeyCache.set(keyHash, config);
        }
        catch (err) {
            this.logger.warn({ err }, "Failed to warm API key cache");
        }
    }
    evictApiKeyConfig(keyHash) {
        try {
            apiKeyCache.delete(keyHash);
        }
        catch (err) {
            this.logger.warn({ err }, "Failed to evict API key cache");
        }
    }
    async evictProjectApiKeys(projectId) {
        try {
            const hashes = await this.repository.listApiKeyHashesByProject(projectId);
            for (const hash of hashes)
                apiKeyCache.delete(hash);
        }
        catch (err) {
            this.logger.warn({ err, projectId }, "Failed to evict project API key cache");
        }
    }
    /**
     * Write a project/API-key lifecycle event to the organization audit trail.
     * Non-fatal: a failed audit write never breaks the originating request.
     */
    async audit(meta, data) {
        try {
            const record = {
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
            if (meta.actorEmail)
                record.actorEmail = meta.actorEmail;
            if (meta.actorSessionId)
                record.actorSessionId = meta.actorSessionId;
            if (data.entityId !== undefined)
                record.entityId = data.entityId;
            if (data.entityName !== undefined)
                record.entityName = data.entityName;
            if (data.oldValues !== undefined)
                record.oldValues = data.oldValues;
            if (data.newValues !== undefined)
                record.newValues = data.newValues;
            if (data.changedFields !== undefined)
                record.changedFields = data.changedFields;
            if (data.isSensitive !== undefined)
                record.isSensitive = data.isSensitive;
            if (data.metadata !== undefined)
                record.metadata = data.metadata;
            await this.orgRepo.createAuditLog(record);
        }
        catch (err) {
            this.logger.error({ err, action: data.action }, "Failed to write project audit log");
        }
    }
}
//# sourceMappingURL=service.js.map
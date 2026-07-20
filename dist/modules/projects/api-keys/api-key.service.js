import { apiKeyCache } from "../../../config/lrucashe.js";
import { ProjectMemberRole } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "./api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { constantTimeEqualHex, createApiKey, defaultPermissionsForType, extractApiKeyPrefix, hashApiKey, ProjectError, } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
const DEFAULT_API_KEY_RATE_LIMITS = {
    perSecond: 1000,
    perMinute: 10000,
};
const MAX_ACTIVE_KEYS_ON_CREATE = 5;
const MAX_ACTIVE_KEYS_ON_ENABLE = 10;
const DEFAULT_GRACE_PERIOD_HOURS = 24;
const BILLING_MUTABLE_STATUSES = new Set(["trialing", "active"]);
const ROLE_HIERARCHY = {
    [ProjectMemberRole.OWNER]: 4,
    [ProjectMemberRole.ADMIN]: 3,
    [ProjectMemberRole.DEVELOPER]: 2,
    [ProjectMemberRole.QA]: 2,
    [ProjectMemberRole.VIEWER]: 1,
};
export function hasProjectRole(userRole, required) {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}
export class ApiKeyService extends BaseProjectService {
    constructor(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository) {
        super(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    }
    async listApiKeys(orgId, projectId, userId, query) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const result = await this.apiKeyRepository.listApiKeys(projectId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return { ...result, limit: query.limit, offset };
    }
    async createApiKey(orgId, projectId, userId, body, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        this.assertFutureExpiry(body.expiresAt);
        await this.enforceProjectModuleLimit(orgId, "apiKey");
        const env = await this.environmentRepository.findEnvironment(projectId, body.environmentId);
        if (!env) {
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
        }
        const activeKeys = await this.apiKeyRepository.countActiveApiKeys(projectId, body.environmentId);
        if (activeKeys >= MAX_ACTIVE_KEYS_ON_CREATE) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", `Maximum ${MAX_ACTIVE_KEYS_ON_CREATE} active API keys are allowed per environment`, 400);
        }
        const keyMaterial = createApiKey(env.slug);
        const permissions = body.permissions ?? defaultPermissionsForType(body.keyType);
        const created = await this.apiKeyRepository.createApiKey({
            projectId,
            orgId,
            publicKey: keyMaterial.publicKey,
            secretHash: keyMaterial.secretHash,
            keyType: body.keyType,
            environmentId: body.environmentId,
            name: body.name ?? null,
            description: body.description ?? null,
            createdBy: userId,
            expiresAt: body.expiresAt ?? null,
            autoRotateEnabled: body.autoRotateEnabled,
            autoRotateDays: body.autoRotateDays,
            permissions,
            allowedEndpoints: body.allowedEndpoints,
            blockedEndpoints: body.blockedEndpoints,
            allowedEventTypes: body.allowedEventTypes,
            allowedOrigins: body.allowedOrigins,
            allowedIps: body.allowedIps,
            allowedDomains: body.allowedDomains,
            samplingRules: body.samplingRules,
            featureFlags: body.featureFlags,
            sdkConfig: body.sdkConfig,
            rateLimitPerSecond: body.rateLimitPerSecond ?? null,
            rateLimitPerMinute: body.rateLimitPerMinute ?? null,
            rateLimitPerHour: body.rateLimitPerHour ?? null,
        });
        this.warmApiKeyCache(keyMaterial.secretHash, created, project, env);
        await this.audit(meta, {
            orgId,
            action: "project.api_key_created",
            entityType: "api_key",
            entityId: created.id,
            isSensitive: true,
            newValues: { projectId, environmentId: created.environmentId, keyType: created.keyType, publicKey: created.publicKey },
        });
        this.logger.info({ orgId, projectId, apiKeyId: created.id, userId }, "Project API key created");
        return { apiKey: this.publicApiKey(created), fullKey: keyMaterial.fullKey };
    }
    async getApiKey(orgId, projectId, apiKeyId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const apiKey = await this.apiKeyRepository.findApiKeyById(projectId, apiKeyId);
        if (!apiKey)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        return this.publicApiKey(apiKey);
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
        if (body.allowedEventTypes !== undefined)
            updates.allowedEventTypes = body.allowedEventTypes;
        if (body.allowedOrigins !== undefined)
            updates.allowedOrigins = body.allowedOrigins;
        if (body.allowedIps !== undefined)
            updates.allowedIps = body.allowedIps;
        if (body.allowedDomains !== undefined)
            updates.allowedDomains = body.allowedDomains;
        if (body.samplingRules !== undefined)
            updates.samplingRules = body.samplingRules;
        if (body.featureFlags !== undefined)
            updates.featureFlags = body.featureFlags;
        if (body.sdkConfig !== undefined)
            updates.sdkConfig = body.sdkConfig;
        if (body.rateLimitPerSecond !== undefined)
            updates.rateLimitPerSecond = body.rateLimitPerSecond;
        if (body.rateLimitPerMinute !== undefined)
            updates.rateLimitPerMinute = body.rateLimitPerMinute;
        if (body.rateLimitPerHour !== undefined)
            updates.rateLimitPerHour = body.rateLimitPerHour;
        if (body.version !== undefined)
            updates.version = body.version;
        const updated = await this.apiKeyRepository.updateApiKey(projectId, apiKeyId, updates);
        // Permission/rate-limit/scoping changes affect the cached config; evict so
        // the next ingestion request re-resolves the fresh row.
        const record = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (record)
            this.evictApiKeyConfig(record.secretHash);
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
        const record = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!record)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        const revoked = await this.apiKeyRepository.revokeApiKey(projectId, apiKeyId, userId, reason ?? null);
        this.evictApiKeyConfig(record.secretHash);
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
        const currentKey = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!currentKey)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        if (!currentKey.isActive || currentKey.status !== "active") {
            throw new ProjectError("API_KEY_REVOKED", "Cannot rotate an inactive API key", 400);
        }
        const env = await this.environmentRepository.findEnvironment(projectId, currentKey.environmentId);
        if (!env) {
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
        }
        const graceHours = body.gracePeriodHours ?? DEFAULT_GRACE_PERIOD_HOURS;
        const graceEndsAt = graceHours > 0 ? new Date(Date.now() + graceHours * 3_600_000) : null;
        const keyMaterial = createApiKey(env.slug);
        const rotated = await this.repository.withTransaction(async (client) => {
            await this.apiKeyRepository.markApiKeyRotated(projectId, apiKeyId, userId, body.rotationReason ?? "manual_rotation", graceEndsAt, client);
            return this.apiKeyRepository.createApiKey({
                projectId,
                orgId,
                publicKey: keyMaterial.publicKey,
                secretHash: keyMaterial.secretHash,
                keyType: currentKey.keyType,
                environmentId: currentKey.environmentId,
                name: body.name !== undefined ? body.name : currentKey.name,
                description: currentKey.description,
                createdBy: userId,
                expiresAt: body.expiresAt !== undefined ? body.expiresAt : currentKey.expiresAt,
                autoRotateEnabled: currentKey.autoRotateEnabled,
                autoRotateDays: currentKey.autoRotateDays,
                permissions: currentKey.permissions,
                allowedEndpoints: currentKey.allowedEndpoints,
                blockedEndpoints: currentKey.blockedEndpoints,
                allowedEventTypes: currentKey.allowedEventTypes,
                allowedOrigins: currentKey.allowedOrigins,
                allowedIps: currentKey.allowedIps,
                allowedDomains: currentKey.allowedDomains,
                samplingRules: currentKey.samplingRules,
                featureFlags: currentKey.featureFlags,
                sdkConfig: currentKey.sdkConfig,
                rateLimitPerSecond: currentKey.rateLimitPerSecond,
                rateLimitPerMinute: currentKey.rateLimitPerMinute,
                rateLimitPerHour: currentKey.rateLimitPerHour,
                rotatedFromKeyId: apiKeyId,
            }, client);
        });
        // If there is no grace window, evict the old key now. With a grace window
        // the old key stays valid (and cached) until grace ends.
        if (!graceEndsAt)
            this.evictApiKeyConfig(currentKey.secretHash);
        this.warmApiKeyCache(keyMaterial.secretHash, rotated, project, env);
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
        const currentKey = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
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
        const activeKeys = await this.apiKeyRepository.countActiveApiKeys(projectId, currentKey.environmentId);
        if (activeKeys >= MAX_ACTIVE_KEYS_ON_ENABLE) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", `Maximum ${MAX_ACTIVE_KEYS_ON_ENABLE} active API keys are allowed per environment`, 400);
        }
        const updated = await this.apiKeyRepository.setApiKeyActiveState(projectId, apiKeyId, true);
        const env = await this.environmentRepository.findEnvironment(projectId, currentKey.environmentId);
        this.warmApiKeyCache(currentKey.secretHash, { ...currentKey, isActive: true }, project, env);
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
        const record = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!record)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        const updated = await this.apiKeyRepository.setApiKeyActiveState(projectId, apiKeyId, false);
        this.evictApiKeyConfig(record.secretHash);
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
        const keys = await this.apiKeyRepository.listActiveApiKeyRecords(projectId, body.environmentId);
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
            : (await this.apiKeyRepository.listActiveApiKeyRecords(projectId, body.environmentId)).map((k) => ({ id: k.id }));
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
        const summary = await this.apiKeyRepository.getApiKeyUsageSummary(apiKeyId);
        return {
            keyId: apiKey.id,
            keyPrefix: apiKey.publicKey,
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
     * Resolve a raw key to its validated context. Public key narrows the candidate
     * set, then a constant-time hash compare prevents timing leaks. Enforces
     * project status, expiry, and rotation grace. Touches last_used_at async.
     */
    async validateApiKey(rawKey) {
        const publicKey = extractApiKeyPrefix(rawKey);
        if (!publicKey)
            return null;
        const rawKeyHash = hashApiKey(rawKey);
        const candidates = await this.apiKeyRepository.findActiveApiKeyCandidatesByPrefix(publicKey);
        for (const candidate of candidates) {
            if (candidate.project.status !== "active")
                continue;
            if (candidate.apiKey.expiresAt && candidate.apiKey.expiresAt <= new Date())
                continue;
            if (constantTimeEqualHex(candidate.apiKey.secretHash, rawKeyHash)) {
                // Fire-and-forget usage touch; never block verification on the write.
                this.apiKeyRepository
                    .touchApiKeyLastUsed(candidate.apiKey.id)
                    .catch((err) => this.logger.debug({ err }, "touchApiKeyLastUsed failed"));
                return {
                    id: candidate.apiKey.id,
                    projectId: candidate.apiKey.projectId,
                    orgId: candidate.project.orgId,
                    environmentId: candidate.apiKey.environmentId,
                    environmentName: candidate.environmentName,
                    keyType: candidate.apiKey.keyType,
                    permissions: candidate.apiKey.permissions,
                    allowedEndpoints: candidate.apiKey.allowedEndpoints,
                    blockedEndpoints: candidate.apiKey.blockedEndpoints,
                    allowedEventTypes: candidate.apiKey.allowedEventTypes,
                    allowedOrigins: candidate.apiKey.allowedOrigins,
                    allowedIps: candidate.apiKey.allowedIps,
                    allowedDomains: candidate.apiKey.allowedDomains,
                    allowedSdks: candidate.apiKey.allowedSdks,
                    rateLimitPerSecond: candidate.apiKey.rateLimitPerSecond,
                    rateLimitPerMinute: candidate.apiKey.rateLimitPerMinute,
                    rateLimitPerHour: candidate.apiKey.rateLimitPerHour,
                    samplingRules: candidate.apiKey.samplingRules,
                    featureFlags: candidate.apiKey.featureFlags,
                    sdkConfig: candidate.apiKey.sdkConfig,
                };
            }
        }
        return null;
    }
    // ── Internal helpers ────────────────────────────────────────────────────────
    assertFutureExpiry(expiresAt) {
        if (expiresAt && expiresAt <= new Date()) {
            throw new ProjectError("VALIDATION_ERROR", "expiresAt must be in the future", 422);
        }
    }
    publicApiKey(apiKey) {
        const rest = { ...apiKey };
        delete rest.secretHash;
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
    warmApiKeyCache(secretHash, key, project, env = null) {
        const config = {
            id: project.id,
            orgId: project.orgId,
            name: key.name ?? project.name,
            environment: env?.slug ?? "default",
            environmentId: env?.id ?? key.environmentId,
            environmentName: env?.name ?? null,
            rateLimitPerSecond: key.rateLimitPerSecond ?? DEFAULT_API_KEY_RATE_LIMITS.perSecond,
            rateLimitPerMinute: key.rateLimitPerMinute ?? DEFAULT_API_KEY_RATE_LIMITS.perMinute,
            rateLimitPerHour: key.rateLimitPerHour ?? null,
            allowedEventTypes: key.allowedEventTypes.length ? key.allowedEventTypes : ["*"],
            permissions: key.permissions,
            allowedEndpoints: key.allowedEndpoints.length ? key.allowedEndpoints : ["*"],
            blockedEndpoints: key.blockedEndpoints,
            allowedOrigins: key.allowedOrigins,
            allowedIps: key.allowedIps,
            allowedDomains: key.allowedDomains,
            allowedSdks: key.allowedSdks,
            samplingRules: key.samplingRules,
            featureFlags: key.featureFlags,
            sdkConfig: key.sdkConfig,
            isActive: project.status === "active" && key.isActive,
            apiKeyId: key.id,
        };
        try {
            apiKeyCache.set(secretHash, config);
        }
        catch (err) {
            this.logger.warn({ err }, "Failed to warm API key cache");
        }
    }
    evictApiKeyConfig(secretHash) {
        try {
            apiKeyCache.delete(secretHash);
        }
        catch (err) {
            this.logger.warn({ err }, "Failed to evict API key cache");
        }
    }
}
//# sourceMappingURL=api-key.service.js.map
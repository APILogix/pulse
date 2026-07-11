import { apiKeyCache } from "../../../config/lrucashe.js";
import { ProjectMemberRole } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { buildApiPrefixes, constantTimeEqualHex, createApiKey, defaultPermissionsForType, extractApiKeyPrefix, hasRequiredRole, hashApiKey, ProjectError, slugifyProjectName, validateStatusTransition, } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
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
export class ApiKeyService extends BaseProjectService {
    constructor(repository, logger, 
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository) {
        super(repository, logger, orgRepo, settingsRepository, apiKeyRepository, environmentRepository, activityRepository, usageRepository);
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    // ── Environments ─────────────────────────────────────────────────────────
    // ── API keys ─────────────────────────────────────────────────────────────
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
        const activeKeys = await this.apiKeyRepository.countActiveApiKeys(projectId, body.environment);
        if (activeKeys >= MAX_ACTIVE_KEYS_ON_CREATE) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", `Maximum ${MAX_ACTIVE_KEYS_ON_CREATE} active API keys are allowed per environment`, 400);
        }
        const keyMaterial = createApiKey(body.environment);
        const permissions = body.permissions ?? defaultPermissionsForType(body.keyType);
        const created = await this.apiKeyRepository.createApiKey({
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
        const apiKey = await this.apiKeyRepository.findApiKeyById(projectId, apiKeyId);
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
        const updated = await this.apiKeyRepository.updateApiKey(projectId, apiKeyId, updates);
        // Permission/rate-limit changes affect the cached config; evict so the next
        // ingestion request re-resolves the fresh row.
        const record = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
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
        const record = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!record)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        const revoked = await this.apiKeyRepository.revokeApiKey(projectId, apiKeyId, userId, reason ?? null);
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
        const currentKey = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!currentKey)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        if (!currentKey.isActive || currentKey.status !== "active") {
            throw new ProjectError("API_KEY_REVOKED", "Cannot rotate an inactive API key", 400);
        }
        const graceHours = body.gracePeriodHours ?? DEFAULT_GRACE_PERIOD_HOURS;
        const graceEndsAt = graceHours > 0 ? new Date(Date.now() + graceHours * 3_600_000) : null;
        const keyMaterial = createApiKey(currentKey.environment);
        const rotated = await this.repository.withTransaction(async (client) => {
            await this.apiKeyRepository.markApiKeyRotated(projectId, apiKeyId, userId, body.rotationReason ?? "manual_rotation", graceEndsAt, client);
            return this.apiKeyRepository.createApiKey({
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
        const activeKeys = await this.apiKeyRepository.countActiveApiKeys(projectId, currentKey.environment);
        if (activeKeys >= MAX_ACTIVE_KEYS_ON_ENABLE) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", `Maximum ${MAX_ACTIVE_KEYS_ON_ENABLE} active API keys are allowed per environment`, 400);
        }
        const updated = await this.apiKeyRepository.setApiKeyActiveState(projectId, apiKeyId, true);
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
        const record = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!record)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        const updated = await this.apiKeyRepository.setApiKeyActiveState(projectId, apiKeyId, false);
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
        const keys = await this.apiKeyRepository.listActiveApiKeyRecords(projectId, body.environment);
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
            : (await this.apiKeyRepository.listActiveApiKeyRecords(projectId, body.environment)).map((k) => ({ id: k.id }));
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
        const candidates = await this.apiKeyRepository.findActiveApiKeyCandidatesByPrefix(keyPrefix);
        for (const candidate of candidates) {
            if (candidate.project.status !== "active")
                continue;
            if (candidate.apiKey.expiresAt && candidate.apiKey.expiresAt <= new Date())
                continue;
            if (constantTimeEqualHex(candidate.apiKey.keyHash, rawKeyHash)) {
                // Fire-and-forget usage touch; never block verification on the write.
                this.apiKeyRepository
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
    // ── Internal helpers ────────────────────────────────────────────────────────
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
}
//# sourceMappingURL=api-key.service.js.map
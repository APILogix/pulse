import { apiKeyCache } from "../../../config/lrucashe.js";
import { ProjectMemberRole } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "./api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { quotaGuard } from "../../billing/entitlements/quota-guard.js";
import { constantTimeEqualHex, createApiKey, extractApiKeyPrefix, hashApiKey, ProjectError, } from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
import { syncApiKeyLookupToLogDbBestEffort } from "../../../shared/logdb/lookup-sync.js";
const MAX_ACTIVE_KEYS_ON_CREATE = 5;
const MAX_ACTIVE_KEYS_ON_ENABLE = 10;
const DEFAULT_GRACE_PERIOD_HOURS = 24;
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
    constructor(repository, logger, orgRepo, auditService, settingsRepository, apiKeyRepository, environmentRepository, usageRepository) {
        super(repository, logger, orgRepo, auditService, settingsRepository, apiKeyRepository, environmentRepository, usageRepository);
    }
    async listApiKeys(orgId, projectId, userId, query) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const result = await this.apiKeyRepository.listApiKeys(projectId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return { ...result, limit: query.limit, offset };
    }
    async createApiKey(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        this.assertFutureExpiry(body.expiresAt);
        await this.enforceProjectModuleLimit(orgId, "apiKey");
        const env = await this.environmentRepository.findEnvironment(projectId, body.environmentId);
        if (!env || !env.isActive || env.deletedAt !== null) {
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Active environment not found", 404);
        }
        const activeKeys = await this.apiKeyRepository.countActiveApiKeys(projectId, body.environmentId);
        if (activeKeys >= MAX_ACTIVE_KEYS_ON_CREATE) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", `Maximum ${MAX_ACTIVE_KEYS_ON_CREATE} active API keys are allowed per environment`, 400);
        }
        const keyMaterial = createApiKey(env.slug);
        const created = await this.apiKeyRepository.createApiKey({
            projectId,
            organizationId: orgId,
            environmentId: body.environmentId,
            publicKey: keyMaterial.publicKey,
            secretHash: keyMaterial.secretHash,
            name: body.name,
            createdBy: userId,
            expiresAt: body.expiresAt ?? null,
        });
        await this.audit(meta, {
            orgId,
            projectId,
            action: "project.api_key_created",
            entityType: "api_key",
            entityId: created.id,
            entityName: created.name,
            isSensitive: true,
            newValues: { projectId, environmentId: created.environmentId, publicKey: created.publicKey },
        });
        // Keep the org-level fast-path counter in sync with actual key creation.
        // Non-fatal: the authoritative limit check above already ran against the
        // live COUNT(*), so a failed counter update never blocks the request.
        await this.adjustOrgApiKeyUsage(orgId, 1);
        this.logger.info({ orgId, projectId, apiKeyId: created.id, userId }, "Project API key created");
        syncApiKeyLookupToLogDbBestEffort(created.id, "api_key.created");
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
        const current = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!current)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        const updates = {};
        if (body.name !== undefined)
            updates.name = body.name;
        if (body.expiresAt !== undefined)
            updates.expiresAt = body.expiresAt;
        let targetEnvironment = null;
        if (body.environmentId !== undefined && body.environmentId !== current.environmentId) {
            targetEnvironment = await this.environmentRepository.findEnvironment(projectId, body.environmentId);
            if (!targetEnvironment || !targetEnvironment.isActive || targetEnvironment.deletedAt !== null) {
                throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Active environment not found", 404);
            }
            const activeKeysInTarget = await this.apiKeyRepository.countActiveApiKeys(projectId, body.environmentId);
            if (current.status === "active" && activeKeysInTarget >= MAX_ACTIVE_KEYS_ON_CREATE) {
                throw new ProjectError("API_KEY_LIMIT_EXCEEDED", `Maximum ${MAX_ACTIVE_KEYS_ON_CREATE} active API keys are allowed per environment`, 400);
            }
            updates.environmentId = body.environmentId;
        }
        const updated = await this.apiKeyRepository.updateApiKey(projectId, apiKeyId, updates);
        // Expiry and environment changes affect authentication/config resolution,
        // so evict the cached credential either way.
        this.evictApiKeyConfig(current.secretHash);
        await this.audit(meta, {
            orgId,
            projectId,
            action: "project.api_key_updated",
            entityType: "api_key",
            entityId: apiKeyId,
            entityName: updated.name,
            changedFields: Object.keys(body),
            ...(targetEnvironment
                ? { oldValues: { environmentId: current.environmentId }, newValues: { environmentId: targetEnvironment.id } }
                : {}),
        });
        syncApiKeyLookupToLogDbBestEffort(apiKeyId, "api_key.updated");
        return updated;
    }
    /** Revoke a key with a reason. Soft state change, not row removal. */
    async deleteApiKey(orgId, projectId, apiKeyId, userId, meta, reason) {
        await this.requireProjectAccess(orgId, projectId, userId, "owner");
        const record = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!record)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        const revoked = await this.apiKeyRepository.revokeApiKey(projectId, apiKeyId);
        this.evictApiKeyConfig(record.secretHash);
        await this.audit(meta, {
            orgId,
            projectId,
            action: "project.api_key_revoked",
            entityType: "api_key",
            entityId: apiKeyId,
            entityName: record.name,
            isSensitive: true,
            newValues: { reason: reason ?? null },
        });
        // Revocation is a soft-delete of the credential row, so the org-level
        // counter must shrink to reflect one fewer live API key.
        await this.adjustOrgApiKeyUsage(orgId, -1);
        syncApiKeyLookupToLogDbBestEffort(apiKeyId, "api_key.revoked");
        return revoked;
    }
    async rotateApiKey(orgId, projectId, apiKeyId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        this.assertFutureExpiry(body.expiresAt);
        const currentKey = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!currentKey)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        if (currentKey.status !== "active") {
            throw new ProjectError("API_KEY_REVOKED", "Cannot rotate an inactive API key", 400);
        }
        const env = await this.environmentRepository.findEnvironment(projectId, currentKey.environmentId);
        if (!env || !env.isActive || env.deletedAt !== null) {
            throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Active environment not found", 404);
        }
        const graceHours = body.gracePeriodHours ?? DEFAULT_GRACE_PERIOD_HOURS;
        const graceEndsAt = graceHours > 0 ? new Date(Date.now() + graceHours * 3_600_000) : null;
        const keyMaterial = createApiKey(env.slug);
        const rotated = await this.repository.withTransaction(async (client) => {
            await this.apiKeyRepository.markApiKeyRotated(projectId, apiKeyId, client);
            const created = await this.apiKeyRepository.createApiKey({
                projectId,
                organizationId: orgId,
                environmentId: currentKey.environmentId,
                publicKey: keyMaterial.publicKey,
                secretHash: keyMaterial.secretHash,
                name: body.name ?? currentKey.name,
                createdBy: userId,
                expiresAt: body.expiresAt !== undefined ? body.expiresAt : currentKey.expiresAt,
                rotatedFromKeyId: apiKeyId,
            }, client);
            await this.apiKeyRepository.recordRotation({
                organizationId: orgId,
                projectId,
                environmentId: currentKey.environmentId,
                oldKeyId: apiKeyId,
                newKeyId: created.id,
                reason: body.rotationReason ?? "manual_rotation",
                initiatedBy: userId,
                graceEndsAt,
            }, client);
            return created;
        });
        // Without a grace window the old credential dies now; with one it stays
        // valid (and cached) until the rotation row completes.
        if (!graceEndsAt)
            this.evictApiKeyConfig(currentKey.secretHash);
        await this.audit(meta, {
            orgId,
            projectId,
            action: "project.api_key_rotated",
            entityType: "api_key",
            entityId: apiKeyId,
            entityName: currentKey.name,
            isSensitive: true,
            newValues: {
                newKeyId: rotated.id,
                gracePeriodHours: graceHours,
                reason: body.rotationReason ?? null,
            },
        });
        // Old key transitioned to 'rotated'; the new key is a fresh row. Snapshot both.
        syncApiKeyLookupToLogDbBestEffort(apiKeyId, "api_key.rotated");
        syncApiKeyLookupToLogDbBestEffort(rotated.id, "api_key.created");
        return { apiKey: this.publicApiKey(rotated), fullKey: keyMaterial.fullKey };
    }
    /** Emergency regenerate: rotate with no grace window. */
    async regenerateApiKey(orgId, projectId, apiKeyId, userId, meta) {
        return this.rotateApiKey(orgId, projectId, apiKeyId, userId, { gracePeriodHours: 0, rotationReason: "emergency_regenerate" }, meta);
    }
    async listApiKeyRotations(orgId, projectId, apiKeyId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        return this.apiKeyRepository.listRotations(projectId, apiKeyId);
    }
    async enableApiKey(orgId, projectId, apiKeyId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const currentKey = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!currentKey)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        if (currentKey.status === "active")
            return this.publicApiKey(currentKey);
        if (currentKey.status !== "suspended") {
            throw new ProjectError("API_KEY_NOT_RESUMABLE", `API keys with status '${currentKey.status}' cannot be re-enabled`, 400);
        }
        if (currentKey.expiresAt && currentKey.expiresAt <= new Date()) {
            throw new ProjectError("API_KEY_EXPIRED", "Expired API keys cannot be re-enabled", 400);
        }
        await this.enforceProjectModuleLimit(orgId, "apiKey");
        const activeKeys = await this.apiKeyRepository.countActiveApiKeys(projectId, currentKey.environmentId);
        if (activeKeys >= MAX_ACTIVE_KEYS_ON_ENABLE) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", `Maximum ${MAX_ACTIVE_KEYS_ON_ENABLE} active API keys are allowed per environment`, 400);
        }
        const updated = await this.apiKeyRepository.setApiKeyStatus(projectId, apiKeyId, "active");
        await this.audit(meta, {
            orgId,
            projectId,
            action: "project.api_key_enabled",
            entityType: "api_key",
            entityId: apiKeyId,
            entityName: currentKey.name,
        });
        syncApiKeyLookupToLogDbBestEffort(apiKeyId, "api_key.enabled");
        return updated;
    }
    async disableApiKey(orgId, projectId, apiKeyId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const record = await this.apiKeyRepository.findApiKeyRecordById(projectId, apiKeyId);
        if (!record)
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        const updated = await this.apiKeyRepository.setApiKeyStatus(projectId, apiKeyId, "suspended");
        this.evictApiKeyConfig(record.secretHash);
        await this.audit(meta, {
            orgId,
            projectId,
            action: "project.api_key_disabled",
            entityType: "api_key",
            entityId: apiKeyId,
            entityName: record.name,
        });
        syncApiKeyLookupToLogDbBestEffort(apiKeyId, "api_key.disabled");
        return updated;
    }
    async bulkRotateKeys(orgId, projectId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const keys = await this.apiKeyRepository.listActiveApiKeyRecords(projectId, body.environmentId);
        const results = [];
        for (const key of keys) {
            try {
                const rotated = await this.rotateApiKey(orgId, projectId, key.id, userId, {
                    ...(body.gracePeriodHours !== undefined ? { gracePeriodHours: body.gracePeriodHours } : {}),
                    rotationReason: body.rotationReason ?? "bulk_rotation",
                }, meta);
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
            : (await this.apiKeyRepository.listActiveApiKeyRecords(projectId, body.environmentId))
                .map((key) => ({ id: key.id }));
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
    /** Graph-ready per-key usage for the requested grain and window. */
    async getApiKeyUsage(orgId, projectId, apiKeyId, userId, query) {
        const apiKey = await this.getApiKey(orgId, projectId, apiKeyId, userId);
        const series = await this.apiKeyRepository.getApiKeyUsageSeries(apiKeyId, query.from, query.to, query.granularity);
        return {
            keyId: apiKey.id,
            keyPrefix: apiKey.publicKey,
            lastUsedAt: apiKey.lastUsedAt,
            granularity: query.granularity,
            from: query.from.toISOString(),
            to: query.to.toISOString(),
            summary: this.summarizeUsage(series),
            series,
        };
    }
    // ── Verification (ingestion-facing) ─────────────────────────────────────────
    /**
     * Resolve a raw key to its validated context. The public key narrows the
     * candidate set, then a constant-time hash compare prevents timing leaks.
     * Enforces project status, expiry, and rotation grace.
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
                    environmentSlug: candidate.environmentSlug,
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
    /** Never let the secret verifier leave the service boundary. */
    publicApiKey(apiKey) {
        const shape = { ...apiKey };
        delete shape.secretHash;
        return shape;
    }
    summarizeUsage(series) {
        const totals = series.reduce((accumulator, point) => ({
            requests: accumulator.requests + point.requests,
            acceptedEvents: accumulator.acceptedEvents + point.acceptedEvents,
            errorEvents: accumulator.errorEvents + point.errorEvents,
            ingestionFailures: accumulator.ingestionFailures + point.ingestionFailures,
            acceptedBytes: accumulator.acceptedBytes + point.acceptedBytes,
            rateLimitedRequests: accumulator.rateLimitedRequests + point.rateLimitedRequests,
        }), {
            requests: 0,
            acceptedEvents: 0,
            errorEvents: 0,
            ingestionFailures: 0,
            acceptedBytes: 0,
            rateLimitedRequests: 0,
        });
        const denominator = totals.acceptedEvents + totals.errorEvents;
        return {
            ...totals,
            errorRate: denominator > 0 ? (totals.errorEvents / denominator) * 100 : 0,
        };
    }
    summarizeBulk(results) {
        const succeeded = results.filter((result) => result.status === "ok").length;
        return {
            total: results.length,
            succeeded,
            failed: results.length - succeeded,
            results,
        };
    }
    evictApiKeyConfig(secretHash) {
        try {
            apiKeyCache.delete(secretHash);
        }
        catch (err) {
            this.logger.warn({ err }, "Failed to evict API key cache");
        }
    }
    /**
     * Best-effort adjustment of the organization's fast-path `api_keys_used`
     * counter. Failures are logged and swallowed: the counter only backs
     * dashboards/quota display, while the actual limit gate is the live
     * COUNT(*) enforced in `enforceProjectModuleLimit` before this is called.
     */
    async adjustOrgApiKeyUsage(orgId, delta) {
        try {
            await this.orgRepo.adjustApiKeyUsageCounter?.(orgId, delta);
        }
        catch (err) {
            if (typeof this.logger?.warn === "function") {
                this.logger.warn({ err, orgId, delta }, "Failed to adjust organization api_keys_used counter");
            }
        }
    }
}
//# sourceMappingURL=api-key.service.js.map
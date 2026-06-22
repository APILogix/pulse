import { logAudit } from "../../shared/middleware/audit-logger.js";
import { ProjectsRepository } from "./repository.js";
import { buildApiPrefixes, constantTimeEqualHex, createApiKey, extractApiKeyPrefix, hashApiKey, ProjectError, slugifyProjectName, validateStatusTransition, } from "./utils.js";
import { apiKeyCache } from "../../config/lrucashe.js";
// Default per-key ingestion rate limits used when warming the cache. These are
// intentionally aligned with the ingestion service defaults so the limit a key
// gets does not depend on which code path populated the cache. Plan-based
// limits can be resolved here later from org settings/billing.
const DEFAULT_API_KEY_RATE_LIMITS = {
    perSecond: 1000,
    perMinute: 10000,
};
export class ProjectsService {
    repository;
    logger;
    constructor(repository, logger) {
        this.repository = repository;
        this.logger = logger;
    }
    async listProjects(orgId, userId, query) {
        this.logger.debug({ orgId, userId, query }, 'listProjects called');
        await this.requireOrganizationAccess(orgId, userId);
        const result = await this.repository.listProjects(orgId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return {
            ...result,
            limit: query.limit,
            offset,
        };
    }
    async createProject(orgId, userId, body, meta) {
        // Project slugs are scoped to an organization. Prefix defaults derive from
        // the final unique slug so generated API URLs stay stable and readable.
        await this.requireOrganizationAccess(orgId, userId);
        const slug = await this.generateUniqueSlug(orgId, body.name);
        const defaultPrefixes = buildApiPrefixes(slug);
        const project = await this.repository.createProject({
            orgId,
            name: body.name,
            slug,
            description: body.description ?? null,
            environment: body.environment,
            productionApiPrefix: body.productionApiPrefix ?? defaultPrefixes.productionApiPrefix,
            developmentApiPrefix: body.developmentApiPrefix ?? defaultPrefixes.developmentApiPrefix,
        });
        await this.audit("project.created", "project", project.id, orgId, userId, meta, {
            name: project.name,
            environment: project.environment,
        });
        this.logger.info({ orgId, projectId: project.id, userId }, "Project created");
        return project;
    }
    async getProject(orgId, projectId, userId) {
        return this.requireProjectAccess(orgId, projectId, userId, "member");
    }
    async updateProject(orgId, projectId, userId, body, meta) {
        // Status changes are validated before persistence so invalid lifecycle
        // transitions never reach the database.
        const currentProject = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (body.status &&
            !validateStatusTransition(currentProject.status, body.status)) {
            throw new ProjectError("PROJECT_INVALID_TRANSITION", `Cannot transition project from ${currentProject.status} to ${body.status}`, 400);
        }
        const updates = {};
        if (body.name !== undefined) {
            updates.name = body.name;
        }
        if (body.description !== undefined) {
            updates.description = body.description;
        }
        if (body.status !== undefined) {
            updates.status = body.status;
        }
        if (body.environment !== undefined) {
            updates.environment = body.environment;
        }
        if (body.productionApiPrefix !== undefined) {
            updates.productionApiPrefix = body.productionApiPrefix;
        }
        if (body.developmentApiPrefix !== undefined) {
            updates.developmentApiPrefix = body.developmentApiPrefix;
        }
        const updated = await this.repository.updateProject(orgId, projectId, updates);
        // If the project is no longer active, evict its cached API keys so ingestion
        // stops accepting data for a paused/archived project within the request,
        // not after the LRU TTL expires.
        if (body.status !== undefined && body.status !== "active") {
            await this.evictProjectApiKeys(projectId);
        }
        await this.audit("project.updated", "project", updated.id, orgId, userId, meta, {
            fields: Object.keys(body),
        });
        return updated;
    }
    async deleteProject(orgId, projectId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "owner");
        // Evict cached API keys BEFORE the row cascade so ingestion stops resolving
        // them immediately rather than after the LRU TTL.
        await this.evictProjectApiKeys(projectId);
        await this.repository.deleteProject(orgId, projectId);
        await this.audit("project.deleted", "project", projectId, orgId, userId, meta);
        this.logger.warn({ orgId, projectId, userId }, "Project deleted");
    }
    async archiveProject(orgId, projectId, userId, meta) {
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        if (project.status === "archived") {
            return project;
        }
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
        if (project.status === "paused") {
            return project;
        }
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
                totalRequests: 0,
                apiKeysCount: stats.apiKeysCount,
                activeKeysCount: stats.activeKeysCount,
            },
        };
    }
    async listApiKeys(orgId, projectId, userId, query) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const result = await this.repository.listApiKeys(projectId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return {
            ...result,
            limit: query.limit,
            offset,
        };
    }
    async createApiKey(orgId, projectId, userId, body, meta) {
        // API-key creation stores only the hash and prefix. The plaintext full key
        // exists only in this request/response cycle.
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        this.assertFutureExpiry(body.expiresAt);
        const activeKeys = await this.repository.countActiveApiKeys(projectId, body.environment);
        if (activeKeys >= 5) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", "Maximum 5 active API keys are allowed per environment", 400);
        }
        const keyMaterial = createApiKey(body.environment);
        const created = await this.repository.createApiKey({
            projectId,
            keyHash: keyMaterial.keyHash,
            keyPrefix: keyMaterial.keyPrefix,
            environment: body.environment,
            name: body.name ?? null,
            createdBy: userId,
            expiresAt: body.expiresAt ?? null,
        });
        // Warm the in-process LRU so ingestion can resolve the new key immediately
        // without a Postgres round trip on first use. Only active, status-active
        // projects are cached; ingestion re-validates project status from the DB
        // on cache miss so a paused project never silently ingests.
        this.cacheApiKeyConfig(keyMaterial.keyHash, {
            id: created.projectId,
            orgId,
            name: created.name ?? project.name,
            environment: created.environment,
            rateLimitPerSecond: DEFAULT_API_KEY_RATE_LIMITS.perSecond,
            rateLimitPerMinute: DEFAULT_API_KEY_RATE_LIMITS.perMinute,
            allowedEventTypes: ["request", "error", "log", "metric", "custom"],
            isActive: project.status === "active",
            apiKeyId: created.id,
        });
        await this.audit("project.api_key_created", "api_key", created.id, orgId, userId, meta, { projectId, environment: created.environment, keyPrefix: created.keyPrefix });
        this.logger.info({ orgId, projectId, apiKeyId: created.id, userId }, "Project API key created");
        return {
            apiKey: this.publicApiKey(created),
            fullKey: keyMaterial.fullKey,
        };
    }
    async getApiKey(orgId, projectId, apiKeyId, userId) {
        await this.requireProjectAccess(orgId, projectId, userId, "member");
        const apiKey = await this.repository.findApiKeyById(projectId, apiKeyId);
        if (!apiKey) {
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        }
        return apiKey;
    }
    async updateApiKey(orgId, projectId, apiKeyId, userId, body, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        this.assertFutureExpiry(body.expiresAt);
        const updates = {};
        if (body.name !== undefined) {
            updates.name = body.name;
        }
        if (body.expiresAt !== undefined) {
            updates.expiresAt = body.expiresAt;
        }
        const updated = await this.repository.updateApiKey(projectId, apiKeyId, updates);
        await this.audit("project.updated", "api_key", apiKeyId, orgId, userId, meta, { action: "api_key_updated" });
        return updated;
    }
    async deleteApiKey(orgId, projectId, apiKeyId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "owner");
        // Capture the hash BEFORE deletion so we can evict the ingestion cache.
        const record = await this.repository.findApiKeyRecordById(projectId, apiKeyId);
        await this.repository.deleteApiKey(projectId, apiKeyId);
        if (record)
            this.evictApiKeyConfig(record.keyHash);
        await this.audit("project.api_key_revoked", "api_key", apiKeyId, orgId, userId, meta, { action: "api_key_deleted" });
    }
    async rotateApiKey(orgId, projectId, apiKeyId, userId, body, meta) {
        // Rotation is transactional: deactivate the old key and create the new key
        // together so there is no partially rotated state.
        const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
        this.assertFutureExpiry(body.expiresAt);
        const currentKey = await this.repository.findApiKeyRecordById(projectId, apiKeyId);
        if (!currentKey) {
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        }
        if (!currentKey.isActive) {
            throw new ProjectError("API_KEY_REVOKED", "Cannot rotate an inactive API key", 400);
        }
        const keyMaterial = createApiKey(currentKey.environment);
        const rotated = await this.repository.withTransaction(async (client) => {
            await this.repository.setApiKeyActiveState(projectId, apiKeyId, false, client);
            return this.repository.createApiKey({
                projectId,
                keyHash: keyMaterial.keyHash,
                keyPrefix: keyMaterial.keyPrefix,
                environment: currentKey.environment,
                name: body.name !== undefined ? body.name : currentKey.name,
                createdBy: userId,
                expiresAt: body.expiresAt !== undefined ? body.expiresAt : currentKey.expiresAt,
            }, client);
        });
        // Evict the old key from the ingestion cache immediately so the revoked
        // secret cannot keep ingesting during the LRU TTL window. Warm the new key.
        this.evictApiKeyConfig(currentKey.keyHash);
        this.cacheApiKeyConfig(keyMaterial.keyHash, {
            id: rotated.projectId,
            orgId,
            name: rotated.name ?? project.name,
            environment: rotated.environment,
            rateLimitPerSecond: DEFAULT_API_KEY_RATE_LIMITS.perSecond,
            rateLimitPerMinute: DEFAULT_API_KEY_RATE_LIMITS.perMinute,
            allowedEventTypes: ["request", "error", "log", "metric", "custom"],
            isActive: project.status === "active",
            apiKeyId: rotated.id,
        });
        await this.audit("project.api_key_revoked", "api_key", apiKeyId, orgId, userId, meta, { action: "api_key_rotated_old_key_revoked" });
        await this.audit("project.api_key_created", "api_key", rotated.id, orgId, userId, meta, { action: "api_key_rotated_new_key_created", rotatedFrom: apiKeyId });
        return {
            apiKey: this.publicApiKey(rotated),
            fullKey: keyMaterial.fullKey,
        };
    }
    async enableApiKey(orgId, projectId, apiKeyId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        const currentKey = await this.repository.findApiKeyRecordById(projectId, apiKeyId);
        if (!currentKey) {
            throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
        }
        if (currentKey.isActive) {
            return this.publicApiKey(currentKey);
        }
        if (currentKey.expiresAt && currentKey.expiresAt <= new Date()) {
            throw new ProjectError("API_KEY_EXPIRED", "Expired API keys cannot be re-enabled", 400);
        }
        const activeKeys = await this.repository.countActiveApiKeys(projectId, currentKey.environment);
        if (activeKeys >= 10) {
            throw new ProjectError("API_KEY_LIMIT_EXCEEDED", "Maximum 10 active API keys are allowed per environment", 400);
        }
        const updated = await this.repository.setApiKeyActiveState(projectId, apiKeyId, true);
        await this.audit("project.updated", "api_key", apiKeyId, orgId, userId, meta, { action: "api_key_enabled" });
        return updated;
    }
    async disableApiKey(orgId, projectId, apiKeyId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
        // Fetch the hash first so we can evict the ingestion cache after disabling.
        const record = await this.repository.findApiKeyRecordById(projectId, apiKeyId);
        const updated = await this.repository.setApiKeyActiveState(projectId, apiKeyId, false);
        if (record)
            this.evictApiKeyConfig(record.keyHash);
        await this.audit("project.updated", "api_key", apiKeyId, orgId, userId, meta, { action: "api_key_disabled" });
        return updated;
    }
    async getApiKeyUsage(orgId, projectId, apiKeyId, userId) {
        const apiKey = await this.getApiKey(orgId, projectId, apiKeyId, userId);
        return {
            keyId: apiKey.id,
            keyPrefix: apiKey.keyPrefix,
            totalRequests: 0,
            lastUsedAt: apiKey.lastUsedAt,
            requestsByDay: [],
        };
    }
    async validateApiKey(rawKey) {
        // Prefix narrows the candidate set, then constant-time hash comparison
        // prevents timing leaks when checking the full secret.
        const keyPrefix = extractApiKeyPrefix(rawKey);
        if (!keyPrefix) {
            return null;
        }
        const rawKeyHash = hashApiKey(rawKey);
        const candidates = await this.repository.findActiveApiKeyCandidatesByPrefix(keyPrefix);
        for (const candidate of candidates) {
            if (candidate.project.status !== "active") {
                continue;
            }
            // Defense in depth: never accept an expired key even if the candidate
            // query window and NOW() drift.
            if (candidate.apiKey.expiresAt && candidate.apiKey.expiresAt <= new Date()) {
                continue;
            }
            if (constantTimeEqualHex(candidate.apiKey.keyHash, rawKeyHash)) {
                await this.repository.touchApiKeyLastUsed(candidate.apiKey.id);
                return candidate.apiKey;
            }
        }
        return null;
    }
    async requireOrganizationAccess(orgId, userId) {
        // Organization membership is the root authorization check for project
        // operations because projects are scoped under organizations. Role-level
        // gating is intentionally skipped for now — any active member of the org
        // may operate on its projects. Membership itself is mandatory and is what
        // enforces tenant isolation (prevents cross-org IDOR).
        const membership = await this.repository.findOrganizationMembership(orgId, userId);
        if (!membership || !membership.isActive) {
            throw new ProjectError("INSUFFICIENT_PERMISSIONS", "You do not have access to this organization", 403);
        }
        return membership;
    }
    async requireProjectAccess(orgId, projectId, userId, _requiredRole) {
        // Tenant isolation root check: the caller MUST be an active member of the
        // org, AND the project MUST belong to that org. Role enforcement is
        // intentionally deferred (membership-only) per current product scope; the
        // _requiredRole parameter is retained so role gating can be re-enabled
        // here in one place later without touching every call site.
        await this.requireOrganizationAccess(orgId, userId);
        const project = await this.repository.findProjectById(orgId, projectId);
        if (!project) {
            throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
        }
        return project;
    }
    async generateUniqueSlug(orgId, name) {
        // Deterministic slug generation with numeric suffixes keeps project URLs
        // readable while avoiding org-local collisions.
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
        return {
            id: apiKey.id,
            projectId: apiKey.projectId,
            keyPrefix: apiKey.keyPrefix,
            environment: apiKey.environment,
            name: apiKey.name,
            isActive: apiKey.isActive,
            createdBy: apiKey.createdBy,
            lastUsedAt: apiKey.lastUsedAt,
            expiresAt: apiKey.expiresAt,
            createdAt: apiKey.createdAt,
        };
    }
    /**
     * Warm the in-process LRU cache used by ingestion to resolve an API key to
     * its project config without a Postgres round trip. LRU-only (no Redis).
     */
    cacheApiKeyConfig(keyHash, config) {
        try {
            apiKeyCache.set(keyHash, config);
        }
        catch (err) {
            this.logger.warn({ err }, "Failed to warm API key cache");
        }
    }
    /**
     * Evict a single API key from the ingestion cache. Called on revoke, rotate,
     * disable, and delete so a revoked secret cannot keep ingesting for the
     * remainder of the LRU TTL window.
     */
    evictApiKeyConfig(keyHash) {
        try {
            apiKeyCache.delete(keyHash);
        }
        catch (err) {
            this.logger.warn({ err }, "Failed to evict API key cache");
        }
    }
    /**
     * Evict every cached API key belonging to a project. Called when a project
     * is paused, archived, or deleted so its keys stop resolving as active.
     */
    async evictProjectApiKeys(projectId) {
        try {
            const hashes = await this.repository.listApiKeyHashesByProject(projectId);
            for (const hash of hashes) {
                apiKeyCache.delete(hash);
            }
        }
        catch (err) {
            this.logger.warn({ err, projectId }, "Failed to evict project API key cache");
        }
    }
    async audit(action, resourceType, resourceId, orgId, userId, meta, metadata) {
        // Audit entries are shaped here so all service methods record consistent
        // actor, resource, request, and metadata fields.
        const entry = {
            user_id: userId,
            org_id: orgId,
            action,
            resource_type: resourceType,
            resource_id: resourceId,
            ip_address: meta.ipAddress,
            request_id: meta.requestId,
        };
        if (meta.userAgent) {
            entry.user_agent = meta.userAgent;
        }
        if (metadata) {
            entry.metadata = metadata;
        }
        await logAudit(entry);
    }
}
//# sourceMappingURL=service.js.map
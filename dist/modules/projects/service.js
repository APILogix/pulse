import { logAudit } from "../../shared/middleware/audit-logger.js";
import { ProjectsRepository } from "./repository.js";
import { buildApiPrefixes, constantTimeEqualHex, createApiKey, extractApiKeyPrefix, hasRequiredRole, hashApiKey, ProjectError, slugifyProjectName, validateStatusTransition, } from "./utils.js";
import { apiKeyCache } from "../../config/lrucashe.js";
export class ProjectsService {
    repository;
    logger;
    redisCache;
    constructor(repository, logger, redisCache) {
        this.repository = repository;
        this.logger = logger;
        this.redisCache = redisCache;
    }
    async listProjects(orgId, userId, query) {
        console.log("listProjects called with", { orgId, userId, query });
        // await this.requireOrganizationAccess(orgId, userId, "member");
        console.log("Organization access granted");
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
        // await this.requireOrganizationAccess(orgId, userId, "admin");
        const slug = await this.generateUniqueSlug(orgId, body.name);
        const defaultPrefixes = buildApiPrefixes(slug);
        console.log("defaultPrefixes", defaultPrefixes);
        console.log("body", body);
        console.log(slug);
        const project = await this.repository.createProject({
            orgId,
            name: body.name,
            slug,
            description: body.description ?? null,
            environment: body.environment,
            productionApiPrefix: body.productionApiPrefix ?? defaultPrefixes.productionApiPrefix,
            developmentApiPrefix: body.developmentApiPrefix ?? defaultPrefixes.developmentApiPrefix,
        });
        // await this.audit("project.created", "project", project.id, orgId, userId, meta, {
        //   name: project.name,
        //   environment: project.environment,
        // });
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
        await this.audit("project.updated", "project", updated.id, orgId, userId, meta, {
            fields: Object.keys(body),
        });
        return updated;
    }
    async deleteProject(orgId, projectId, userId, meta) {
        await this.requireProjectAccess(orgId, projectId, userId, "owner");
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
        // await this.requireProjectAccess(orgId, projectId, userId, "member");
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
        // await this.requireProjectAccess(orgId, projectId, userId, "admin");
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
        // Build a flat ProjectConfig — this is the exact shape ingestion reads via getProjectByApiKeyHash
        const projectConfig = {
            id: created.projectId,
            orgId,
            name: created.name ?? "",
            environment: created.environment,
            rateLimitPerSecond: 10, // ⚠️ replace with real plan config later
            rateLimitPerMinute: 600,
            allowedEventTypes: ["request", "error", "log", "metric", "custom"],
            isActive: true,
            apiKeyId: created.id,
        };
        // Compute TTL: use time-to-expiry if the key expires, otherwise default 1 hour
        const ttl = created.expiresAt
            ? Math.max(1, Math.floor((created.expiresAt.getTime() - Date.now()) / 1000))
            : undefined; // undefined → falls back to RedisTTL.API_KEY (3600s)
        // Store in Redis (instance method — no longer broken static stub)
        await this.redisCache.setProjectByApiKeyHash(keyMaterial.keyHash, projectConfig, ttl);
        // Store in LRU cache with the same shape for a second, in-process fast path
        // used by components that do not need a Redis round trip.
        apiKeyCache.set(keyMaterial.keyHash, projectConfig);
        // await this.audit(
        //   "project.api_key_created",
        //   "api_key",
        //   created.id,
        //   orgId,
        //   userId,
        //   meta,
        //   { projectId, environment: created.environment, keyPrefix: created.keyPrefix },
        // );
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
        await this.repository.deleteApiKey(projectId, apiKeyId);
        await this.audit("project.api_key_revoked", "api_key", apiKeyId, orgId, userId, meta, { action: "api_key_deleted" });
    }
    async rotateApiKey(orgId, projectId, apiKeyId, userId, body, meta) {
        // Rotation is transactional: deactivate the old key and create the new key
        // together so there is no partially rotated state.
        await this.requireProjectAccess(orgId, projectId, userId, "admin");
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
        const updated = await this.repository.setApiKeyActiveState(projectId, apiKeyId, false);
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
            if (constantTimeEqualHex(candidate.apiKey.keyHash, rawKeyHash)) {
                await this.repository.touchApiKeyLastUsed(candidate.apiKey.id);
                return candidate.apiKey;
            }
        }
        return null;
    }
    async requireOrganizationAccess(orgId, userId, requiredRole) {
        // Organization membership is the root authorization check for project
        // operations because projects are scoped under organizations.
        console.log("Checking organization access", { orgId, userId, requiredRole });
        const membership = await this.repository.findOrganizationMembership(orgId, userId);
        console.log("Found membership", membership);
        if (!membership || !membership.isActive) {
            throw new ProjectError("INSUFFICIENT_PERMISSIONS", "You do not have access to this organization", 403);
        }
        console.log("Membership role", membership.role);
        if (!hasRequiredRole(membership.role, requiredRole)) {
            throw new ProjectError("INSUFFICIENT_PERMISSIONS", `${requiredRole} access is required`, 403);
        }
        console.log("Organization access granted");
        return membership;
    }
    async requireProjectAccess(orgId, projectId, userId, requiredRole) {
        // Project access composes organization membership with project existence.
        // The service returns the project so callers do not need a second lookup.
        // await this.requireOrganizationAccess(orgId, userId, requiredRole);
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
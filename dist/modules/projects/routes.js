import { authenticate } from "../../shared/middleware/auth.js";
import { ApiKeyParamsSchema, BulkRevokeBodySchema, BulkRotateBodySchema, CreateApiKeyBodySchema, CreateEnvironmentBodySchema, CreateProjectBodySchema, EnvironmentParamsSchema, ListApiKeysQuerySchema, ListProjectsQuerySchema, OrgIdParamsSchema, ProjectParamsSchema, RevokeApiKeyBodySchema, RotateApiKeyBodySchema, UpdateApiKeyBodySchema, UpdateEnvironmentBodySchema, UpdateProjectBodySchema, } from "./types.js";
import { handleProjectError } from "./utils.js";
function requestMeta(request) {
    const userAgent = request.headers["user-agent"];
    const user = request.user;
    return {
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        actorSessionId: user.sessionId ?? null,
        actorIp: request.ip ?? "0.0.0.0",
        actorUserAgent: typeof userAgent === "string" ? userAgent : null,
        requestId: request.id,
        httpMethod: request.method,
        endpoint: request.url,
    };
}
function authenticatedUser(request) {
    return request.user;
}
function withErrorHandling(handler) {
    return async (request, reply) => {
        try {
            return await handler(request, reply);
        }
        catch (error) {
            request.log.error({ err: error, path: request.url }, "Projects route failed");
            return handleProjectError(error, reply);
        }
    };
}
export async function projectsRoutes(fastify) {
    const service = fastify.projects.service;
    // ── Project CRUD ──────────────────────────────────────────────────────────
    fastify.get("/", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = ListProjectsQuerySchema.parse(request.query ?? {});
        const result = await service.listProjects(orgId, authenticatedUser(request).id, query);
        return reply.send({
            success: true,
            data: result.projects,
            meta: { total: result.total, limit: result.limit, offset: result.offset },
        });
    }));
    fastify.post("/", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = CreateProjectBodySchema.parse(request.body);
        const project = await service.createProject(orgId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.code(201).send({ success: true, data: project });
    }));
    fastify.get("/:projectId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const project = await service.getProject(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: project });
    }));
    fastify.get("/:projectId/stats", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const project = await service.getProjectStats(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: project });
    }));
    fastify.patch("/:projectId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const body = UpdateProjectBodySchema.parse(request.body);
        const project = await service.updateProject(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({ success: true, data: project });
    }));
    fastify.delete("/:projectId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        await service.deleteProject(orgId, projectId, authenticatedUser(request).id, requestMeta(request));
        return reply.code(204).send();
    }));
    for (const [path, method] of [
        ["archive", "archiveProject"],
        ["unarchive", "unarchiveProject"],
        ["pause", "pauseProject"],
        ["resume", "resumeProject"],
    ]) {
        fastify.post(`/:projectId/${path}`, { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
            const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
            const project = await service[method](orgId, projectId, authenticatedUser(request).id, requestMeta(request));
            return reply.send({ success: true, data: project });
        }));
    }
    // ── Environments ────────────────────────────────────────────────────────────
    fastify.get("/:projectId/environments", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const envs = await service.listEnvironments(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: envs });
    }));
    fastify.post("/:projectId/environments", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const body = CreateEnvironmentBodySchema.parse(request.body);
        const env = await service.createEnvironment(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.code(201).send({ success: true, data: env });
    }));
    fastify.get("/:projectId/environments/:environment", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, environment } = EnvironmentParamsSchema.parse(request.params);
        const env = await service.getEnvironment(orgId, projectId, environment, authenticatedUser(request).id);
        return reply.send({ success: true, data: env });
    }));
    fastify.patch("/:projectId/environments/:environment", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, environment } = EnvironmentParamsSchema.parse(request.params);
        const body = UpdateEnvironmentBodySchema.parse(request.body);
        const env = await service.updateEnvironment(orgId, projectId, environment, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({ success: true, data: env });
    }));
    fastify.delete("/:projectId/environments/:environment", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, environment } = EnvironmentParamsSchema.parse(request.params);
        await service.deleteEnvironment(orgId, projectId, environment, authenticatedUser(request).id, requestMeta(request));
        return reply.code(204).send();
    }));
    // ── API keys ─────────────────────────────────────────────────────────────
    fastify.get("/:projectId/api-keys", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const query = ListApiKeysQuerySchema.parse(request.query ?? {});
        const result = await service.listApiKeys(orgId, projectId, authenticatedUser(request).id, query);
        return reply.send({
            success: true,
            data: result.keys,
            meta: { total: result.total, limit: result.limit, offset: result.offset },
        });
    }));
    fastify.post("/:projectId/api-keys", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const body = CreateApiKeyBodySchema.parse(request.body);
        // The full key is returned exactly once. It is cached (LRU, 30-min TTL)
        // for ingestion resolution; only the hash + prefix are persisted.
        const result = await service.createApiKey(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.code(201).send({
            success: true,
            data: result,
            warning: "Store this key securely. It will only be shown once.",
        });
    }));
    // Bulk operations are registered before the parameterized :apiKeyId routes so
    // "bulk-rotate"/"bulk-revoke" are never captured as an apiKeyId.
    fastify.post("/:projectId/api-keys/bulk-rotate", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const body = BulkRotateBodySchema.parse(request.body ?? {});
        const result = await service.bulkRotateKeys(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({ success: true, data: result });
    }));
    fastify.post("/:projectId/api-keys/bulk-revoke", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const body = BulkRevokeBodySchema.parse(request.body ?? {});
        const result = await service.bulkRevokeKeys(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:projectId/api-keys/:apiKeyId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(request.params);
        const apiKey = await service.getApiKey(orgId, projectId, apiKeyId, authenticatedUser(request).id);
        return reply.send({ success: true, data: apiKey });
    }));
    fastify.patch("/:projectId/api-keys/:apiKeyId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(request.params);
        const body = UpdateApiKeyBodySchema.parse(request.body);
        const apiKey = await service.updateApiKey(orgId, projectId, apiKeyId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({ success: true, data: apiKey });
    }));
    fastify.delete("/:projectId/api-keys/:apiKeyId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(request.params);
        const body = RevokeApiKeyBodySchema.parse(request.body ?? {});
        await service.deleteApiKey(orgId, projectId, apiKeyId, authenticatedUser(request).id, requestMeta(request), body.revokedReason ?? null);
        return reply.code(204).send();
    }));
    fastify.post("/:projectId/api-keys/:apiKeyId/rotate", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(request.params);
        const body = RotateApiKeyBodySchema.parse(request.body ?? {});
        const result = await service.rotateApiKey(orgId, projectId, apiKeyId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({
            success: true,
            data: result,
            warning: "Store this rotated key securely. It will only be shown once.",
        });
    }));
    fastify.post("/:projectId/api-keys/:apiKeyId/regenerate", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(request.params);
        const result = await service.regenerateApiKey(orgId, projectId, apiKeyId, authenticatedUser(request).id, requestMeta(request));
        return reply.send({
            success: true,
            data: result,
            warning: "The previous key was revoked immediately. Store this new key securely.",
        });
    }));
    fastify.post("/:projectId/api-keys/:apiKeyId/enable", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(request.params);
        const apiKey = await service.enableApiKey(orgId, projectId, apiKeyId, authenticatedUser(request).id, requestMeta(request));
        return reply.send({ success: true, data: apiKey });
    }));
    fastify.post("/:projectId/api-keys/:apiKeyId/disable", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(request.params);
        const apiKey = await service.disableApiKey(orgId, projectId, apiKeyId, authenticatedUser(request).id, requestMeta(request));
        return reply.send({ success: true, data: apiKey });
    }));
    fastify.get("/:projectId/api-keys/:apiKeyId/usage", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, apiKeyId } = ApiKeyParamsSchema.parse(request.params);
        const usage = await service.getApiKeyUsage(orgId, projectId, apiKeyId, authenticatedUser(request).id);
        return reply.send({ success: true, data: usage });
    }));
}
//# sourceMappingURL=routes.js.map
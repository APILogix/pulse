import { authenticate } from "../../../shared/middleware/auth.js";
import { ListSdkConfigsQuerySchema, ResolveSdkConfigQuerySchema, UpdateSdkConfigSchema, } from "../../organization/sdk-config.types.js";
import { ApiKeyParamsSchema, BulkRevokeBodySchema, BulkRotateBodySchema, CreateApiKeyBodySchema, CreateEnvironmentBodySchema, CreateProjectBodySchema, EnvironmentParamsSchema, ListApiKeysQuerySchema, ListProjectActivityQuerySchema, ListProjectsQuerySchema, OrgIdParamsSchema, ProjectParamsSchema, ProjectSdkConfigParamsSchema, RevokeApiKeyBodySchema, RotateApiKeyBodySchema, UpdateApiKeyBodySchema, UpdateEnvironmentBodySchema, UpdateProjectBodySchema, UpdateProjectSettingsBodySchema, } from "../types.js";
import { handleProjectError, ProjectError } from "../shared/utils.js";
import { requestMeta, organizationRequestMeta, authenticatedUser, withErrorHandling } from "../shared/route-utils.js";
export async function projectApiKeyRoutes(fastify) {
    const service = fastify.projects.service;
    const sdkConfigService = fastify.organization.sdkConfigService;
    // ── Project CRUD ──────────────────────────────────────────────────────────
    // ── Project Settings & Overview ─────────────────────────────────────────────
    // ── Environments ────────────────────────────────────────────────────────────
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
//# sourceMappingURL=api-key.routes.js.map
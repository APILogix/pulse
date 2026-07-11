import { authenticate } from "../../../shared/middleware/auth.js";
import { ListSdkConfigsQuerySchema, ResolveSdkConfigQuerySchema, UpdateSdkConfigSchema, } from "../../organization/sdk-config.types.js";
import { ApiKeyParamsSchema, BulkRevokeBodySchema, BulkRotateBodySchema, CreateApiKeyBodySchema, CreateEnvironmentBodySchema, CreateProjectBodySchema, EnvironmentParamsSchema, ListApiKeysQuerySchema, ListProjectActivityQuerySchema, ListProjectsQuerySchema, OrgIdParamsSchema, ProjectParamsSchema, ProjectSdkConfigParamsSchema, RevokeApiKeyBodySchema, RotateApiKeyBodySchema, UpdateApiKeyBodySchema, UpdateEnvironmentBodySchema, UpdateProjectBodySchema, UpdateProjectSettingsBodySchema, } from "../types.js";
import { handleProjectError, ProjectError } from "../shared/utils.js";
import { requestMeta, organizationRequestMeta, authenticatedUser, withErrorHandling } from "../shared/route-utils.js";
export async function projectEnvironmentRoutes(fastify) {
    const service = fastify.projects.service;
    const sdkConfigService = fastify.organization.sdkConfigService;
    // ── Project CRUD ──────────────────────────────────────────────────────────
    // ── Project Settings & Overview ─────────────────────────────────────────────
    // ── Environments ────────────────────────────────────────────────────────────
    fastify.get("/:projectId/sdk-configs", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const userId = authenticatedUser(request).id;
        await service.getProject(orgId, projectId, userId);
        const query = ListSdkConfigsQuerySchema.parse(request.query ?? {});
        const filters = { projectId };
        if (query.environment !== undefined)
            filters.environment = query.environment;
        if (query.configKey !== undefined)
            filters.configKey = query.configKey;
        if (query.includeInactive !== undefined)
            filters.includeInactive = query.includeInactive;
        const result = await sdkConfigService.listConfigs(orgId, userId, filters);
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:projectId/sdk-configs/resolve", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const userId = authenticatedUser(request).id;
        await service.getProject(orgId, projectId, userId);
        const query = ResolveSdkConfigQuerySchema.parse(request.query ?? {});
        const scopedQuery = {
            projectId,
            environment: query.environment,
        };
        if (query.platform !== undefined)
            scopedQuery.platform = query.platform;
        const result = await sdkConfigService.resolveForSdk(orgId, userId, scopedQuery);
        return reply.send({ success: true, data: result });
    }));
    fastify.get("/:projectId/sdk-configs/:configId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, configId } = ProjectSdkConfigParamsSchema.parse(request.params);
        const userId = authenticatedUser(request).id;
        await service.getProject(orgId, projectId, userId);
        const config = await sdkConfigService.getConfig(orgId, userId, configId);
        if (config.projectId !== projectId) {
            throw new ProjectError("SDK_CONFIG_NOT_FOUND", "SDK config not found for this project", 404);
        }
        return reply.send({ success: true, data: config });
    }));
    fastify.patch("/:projectId/sdk-configs/:configId", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, configId } = ProjectSdkConfigParamsSchema.parse(request.params);
        const userId = authenticatedUser(request).id;
        await service.getProject(orgId, projectId, userId);
        const body = UpdateSdkConfigSchema.parse(request.body);
        const update = {};
        if (body.configValue !== undefined)
            update.configValue = body.configValue;
        if (body.environment !== undefined)
            update.environment = body.environment;
        if (body.schemaVersion !== undefined)
            update.schemaVersion = body.schemaVersion;
        if (body.targetSdkVersions !== undefined)
            update.targetSdkVersions = body.targetSdkVersions;
        if (body.targetPlatforms !== undefined)
            update.targetPlatforms = body.targetPlatforms;
        if (body.rolloutPercentage !== undefined)
            update.rolloutPercentage = body.rolloutPercentage;
        if (body.isActive !== undefined)
            update.isActive = body.isActive;
        if (body.changeSummary !== undefined)
            update.changeSummary = body.changeSummary;
        const config = await sdkConfigService.updateProjectConfig(organizationRequestMeta(request), orgId, projectId, configId, update);
        return reply.send({ success: true, data: config });
    }));
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
    // Bulk operations are registered before the parameterized :apiKeyId routes so
    // "bulk-rotate"/"bulk-revoke" are never captured as an apiKeyId.
}
//# sourceMappingURL=environment.routes.js.map
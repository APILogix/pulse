import { authenticate } from "../../../shared/middleware/auth.js";
import { ListSdkConfigsQuerySchema, ResolveSdkConfigQuerySchema, UpdateSdkConfigSchema, } from "../../organization/sdk-config.types.js";
import { ApiKeyParamsSchema, BulkRevokeBodySchema, BulkRotateBodySchema, CreateApiKeyBodySchema, CreateEnvironmentBodySchema, CreateProjectBodySchema, EnvironmentParamsSchema, ListApiKeysQuerySchema, ListProjectActivityQuerySchema, ListProjectsQuerySchema, OrgIdParamsSchema, ProjectParamsSchema, ProjectSdkConfigParamsSchema, RevokeApiKeyBodySchema, RotateApiKeyBodySchema, UpdateApiKeyBodySchema, UpdateEnvironmentBodySchema, UpdateProjectBodySchema, UpdateProjectSettingsBodySchema, } from "../types.js";
import { handleProjectError, ProjectError } from "../shared/utils.js";
import { requestMeta, organizationRequestMeta, authenticatedUser, withErrorHandling } from "../shared/route-utils.js";
export async function projectSettingsRoutes(fastify) {
    const service = fastify.projects.service;
    const sdkConfigService = fastify.organization.sdkConfigService;
    // ── Project CRUD ──────────────────────────────────────────────────────────
    // ── Project Settings & Overview ─────────────────────────────────────────────
    fastify.get("/:projectId/settings", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const settings = await service.getProjectSettings(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data: settings });
    }));
    fastify.patch("/:projectId/settings", { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const body = UpdateProjectSettingsBodySchema.parse(request.body);
        const settings = await service.updateProjectSettings(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
        return reply.send({ success: true, data: settings });
    }));
    // ── Environments ────────────────────────────────────────────────────────────
    // ── API keys ─────────────────────────────────────────────────────────────
    // Bulk operations are registered before the parameterized :apiKeyId routes so
    // "bulk-rotate"/"bulk-revoke" are never captured as an apiKeyId.
}
//# sourceMappingURL=settings.routes.js.map